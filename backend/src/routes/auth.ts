import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getConnInfo } from '@hono/node-server/conninfo';
import { randomBytes } from 'node:crypto';

import { clearLoginFailures, getRemainingLockoutMs, recordLoginFailure } from '../auth/login-attempts';
import { trustProxy } from '../auth/config';
import { hashPassword, isLowCostPasswordHash, verifyPassword } from '../auth/password';
import { decryptEnvelope, getPublicKey } from '../auth/password-key-manager';
import database from '../database';
import {
  apiError,
  classSearchQuerySchema,
  loginSelectionBodySchema,
  loginBodySchema,
  passwordBodySchema,
  profileBodySchema,
  requireAuthenticatedUser,
  staffLoginBodySchema,
  studentNameLoginBodySchema,
  studentUidLoginBodySchema,
  toPublicUser,
  validateName,
  validatePassword,
  validationHook
} from '../http';
import type { User } from '../models';
import { authMiddleware, signAccessToken, setAuthCookie, clearAuthCookie, type AppBindings } from '../plugins/auth';

const dummyPasswordHash = await hashPassword('not-the-real-password');
const loginChallenges = new Map<string, { userIds: Set<number>; expiresAt: number }>();
const loginChallengeTtlMs = 5 * 60 * 1000;

function resolveDirectClientAddress(c: Parameters<typeof getConnInfo>[0]) {
  try {
    return getConnInfo(c).remote.address?.trim() || null;
  } catch {
    return null;
  }
}

function resolveForwardedClientAddress(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')?.trim()
    ?? null;
}

function resolveClientAddress(c: Parameters<typeof getConnInfo>[0]) {
  const directAddress = resolveDirectClientAddress(c);

  if (!trustProxy) {
    return directAddress ?? 'unknown';
  }

  return resolveForwardedClientAddress(c.req.raw) ?? directAddress ?? 'unknown';
}

function buildUidAttemptKey(uid: string, clientAddress: string) {
  return `uid:${uid}@${clientAddress}`;
}

function buildNetworkAttemptKey(clientAddress: string) {
  return `net:${clientAddress}`;
}

function buildLoginAttemptKey(kind: string, identifier: string, clientAddress: string) {
  return `${kind}:${identifier}@${clientAddress}`;
}

function decryptLoginPassword(field: string) {
  try {
    return decryptEnvelope(field);
  } catch {
    return field;
  }
}

function toLoginCandidate(user: User) {
  return {
    uid: user.uid,
    role: user.role,
    name: user.name,
    english_name: user.english_name
  };
}

function toAuthUser(user: User) {
  return {
    id: user.id,
    uid: user.uid,
    role: user.role,
    name: user.name,
    english_name: user.english_name,
    password_setup_required: isLowCostPasswordHash(user.password)
  };
}

async function finishLogin(user: User, c: Context<AppBindings>) {
  const authUser = toAuthUser(user);
  const token = await signAccessToken(authUser);
  setAuthCookie(c, token);
  c.header('cache-control', 'no-store');
  return c.json({ token, user: authUser });
}

function createLoginChallenge(users: User[]) {
  const challenge = randomBytes(32).toString('base64url');
  loginChallenges.set(challenge, {
    userIds: new Set(users.map((user) => user.id)),
    expiresAt: Date.now() + loginChallengeTtlMs
  });
  return challenge;
}

function cleanupLoginChallenges() {
  const now = Date.now();
  for (const [challenge, value] of loginChallenges) {
    if (value.expiresAt <= now) {
      loginChallenges.delete(challenge);
    }
  }
}

async function resolveLogin(c: Context<AppBindings>, kind: string, identifier: string, candidates: User[], passwordEnvelope: string) {
  const password = decryptLoginPassword(passwordEnvelope);

  if (!password) {
    return apiError(c, 400, '密码不能为空。');
  }

  const clientAddress = resolveClientAddress(c);
  const attemptKey = buildLoginAttemptKey(kind, identifier, clientAddress);
  const remainingMs = getRemainingLockoutMs(attemptKey);

  if (remainingMs > 0) {
    c.header('cache-control', 'no-store');
    return apiError(c, 429, `登录失败次数过多，请在 ${Math.ceil(remainingMs / 1000)} 秒后重试。`);
  }

  if (candidates.length === 0) {
    await verifyPassword(password, dummyPasswordHash);
    recordLoginFailure(attemptKey);
    c.header('cache-control', 'no-store');
    return apiError(c, 401, '账号或密码错误。');
  }

  const matched: User[] = [];

  for (const user of candidates) {
    if (await verifyPassword(password, user.password)) {
      matched.push(user);
    }
  }

  if (matched.length === 0) {
    recordLoginFailure(attemptKey);
    c.header('cache-control', 'no-store');
    return apiError(c, 401, '账号或密码错误。');
  }

  clearLoginFailures(attemptKey);

  if (matched.length === 1) {
    return await finishLogin(matched[0]!, c);
  }

  c.header('cache-control', 'no-store');
  return c.json({
    challenge: createLoginChallenge(matched),
    candidates: matched.map(toLoginCandidate)
  });
}

export const authRoutes = new Hono<AppBindings>()
  .use('*', authMiddleware)
  .get('/public-key', (c) => {
    c.header('cache-control', 'no-store');
    return c.json(getPublicKey());
  })
  .get('/classes/search', zValidator('query', classSearchQuerySchema, validationHook), (c) => {
    const query = c.req.valid('query');
    return c.json({ classes: database.searchClasses(query.q?.trim() ?? '') });
  })
  .post('/login/student-uid', zValidator('json', studentUidLoginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const user = database.findStudentByUid(body.uid);
    return await resolveLogin(c, 'student-uid', String(body.uid), user ? [user] : [], body.password);
  })
  .post('/login/student-name', zValidator('json', studentNameLoginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const targetClass = database.findClassById(body.class_id);

    if (!targetClass) {
      return apiError(c, 404, '班级不存在。');
    }

    return await resolveLogin(
      c,
      'student-name',
      `${body.class_id}:${body.name.trim()}`,
      database.findStudentsByClassAndName(body.class_id, body.name.trim()),
      body.password
    );
  })
  .post('/login/staff', zValidator('json', staffLoginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    return await resolveLogin(c, 'staff', body.identifier.trim(), database.findStaffByIdentifier(body.identifier), body.password);
  })
  .post('/login/select', zValidator('json', loginSelectionBodySchema, validationHook), async (c) => {
    cleanupLoginChallenges();
    const body = c.req.valid('json');
    const challenge = loginChallenges.get(body.challenge);

    if (!challenge || !challenge.userIds.has(body.uid)) {
      c.header('cache-control', 'no-store');
      return apiError(c, 401, '登录选择已失效，请重新登录。');
    }

    loginChallenges.delete(body.challenge);
    const user = database.findUserByUid(body.uid);

    if (!user) {
      c.header('cache-control', 'no-store');
      return apiError(c, 401, '登录选择已失效，请重新登录。');
    }

    return await finishLogin(user, c);
  })
  .post('/login', zValidator('json', loginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const uid = Number(body.uid.trim());
    const clientAddress = resolveClientAddress(c);
    const uidAttemptKey = buildUidAttemptKey(String(uid), clientAddress);
    const networkAttemptKey = buildNetworkAttemptKey(clientAddress);

    let password: string;
    try {
      password = decryptEnvelope(body.password);
    } catch {
      password = body.password;
    }

    if (!Number.isInteger(uid) || uid <= 0 || !password) {
      return apiError(c, 400, 'UID 和密码不能为空。');
    }

    const user = database.findUserByUid(uid);

    if (!user) {
      const remainingMs = getRemainingLockoutMs(networkAttemptKey);

      if (remainingMs > 0) {
        c.header('cache-control', 'no-store');
        return apiError(c, 429, `登录失败次数过多，请在 ${Math.ceil(remainingMs / 1000)} 秒后重试。`);
      }

      await verifyPassword(password, dummyPasswordHash);
      recordLoginFailure(networkAttemptKey);
      c.header('cache-control', 'no-store');
      return apiError(c, 401, 'UID 或密码错误。');
    }

    const remainingMs = getRemainingLockoutMs(uidAttemptKey);

    if (remainingMs > 0) {
      c.header('cache-control', 'no-store');
      return apiError(c, 429, `登录失败次数过多，请在 ${Math.ceil(remainingMs / 1000)} 秒后重试。`);
    }

    const matched = await verifyPassword(password, user.password);

    if (!matched) {
      recordLoginFailure(uidAttemptKey);
      c.header('cache-control', 'no-store');
      return apiError(c, 401, 'UID 或密码错误。');
    }

    clearLoginFailures(uidAttemptKey);
    c.header('cache-control', 'no-store');
    const passwordSetupRequired = isLowCostPasswordHash(user.password);

    const authUser = {
      id: user.id,
      uid: user.uid,
      role: user.role,
      name: user.name,
      english_name: user.english_name,
      password_setup_required: passwordSetupRequired
    };

    const token = await signAccessToken(authUser);
    setAuthCookie(c, token);
    return c.json({
      token,
      user: authUser
    });
  })
  .get('/me', (c) => {
    const authFailure = requireAuthenticatedUser(c);

    if (authFailure) {
      return authFailure;
    }

    c.header('cache-control', 'no-store');
    return c.json({ user: c.get('user')! });
  })
  .put('/password', zValidator('json', passwordBodySchema, validationHook), async (c) => {
    const authFailure = requireAuthenticatedUser(c);

    if (authFailure) {
      return authFailure;
    }

    const body = c.req.valid('json');
    const currentUser = c.get('user')!;
    const userRecord = database.findUserById(currentUser.id);

    if (!userRecord) {
      return apiError(c, 404, '用户不存在。');
    }

    let currentPassword: string;
    let newPassword: string;

    try { currentPassword = decryptEnvelope(body.current_password); } catch { currentPassword = body.current_password; }
    try { newPassword = decryptEnvelope(body.new_password); } catch { newPassword = body.new_password; }

    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      return apiError(c, 400, passwordError);
    }

    const matched = await verifyPassword(currentPassword, userRecord.password);

    if (!matched) {
      return apiError(c, 401, '当前密码错误。');
    }

    database.updateUserPassword(userRecord.id, await hashPassword(newPassword));
    const authUser = {
      ...currentUser,
      password_setup_required: false
    };
    const token = await signAccessToken(authUser);
    setAuthCookie(c, token);

    return c.json({
      message: '密码修改成功。',
      token,
      user: authUser
    });
  })
  .put('/profile', zValidator('json', profileBodySchema, validationHook), async (c) => {
    const authFailure = requireAuthenticatedUser(c);

    if (authFailure) {
      return authFailure;
    }

    const body = c.req.valid('json');
    const currentUser = c.get('user')!;

    if (currentUser.role === 'student') {
      return apiError(c, 403, '学生不能修改姓名。');
    }

    const nameError = validateName(body.name);

    if (nameError) {
      return apiError(c, 400, nameError);
    }

    const userRecord = database.findUserById(currentUser.id);

    if (!userRecord) {
      return apiError(c, 404, '用户不存在。');
    }

    let currentPassword: string;
    try { currentPassword = decryptEnvelope(body.current_password); } catch { currentPassword = body.current_password; }

    const matched = await verifyPassword(currentPassword, userRecord.password);

    if (!matched) {
      return apiError(c, 401, '当前密码错误。');
    }

    const name = body.name.trim();
    database.updateUserName(userRecord.id, name);

    return c.json({
      message: '姓名修改成功。',
      user: toPublicUser({
        ...currentUser,
        name
      })
    });
  })
  .post('/logout', (c) => {
    clearAuthCookie(c);
    return c.json({ message: '已退出登录。' });
  });
