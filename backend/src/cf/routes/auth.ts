import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomBytes } from 'node:crypto';
import type { CFAppBindings } from '../auth-plugin';
import { authMiddleware, signAccessToken, setAuthCookie, clearAuthCookie } from '../auth-plugin';
import { hashPassword, isLowCostPasswordHash, verifyPassword } from '../password';
import { decryptEnvelope, EnvelopeDecryptError, getPublicKey } from '../password-key-manager';
import { clearLoginFailures, getRemainingLockoutMs, recordLoginFailure } from '../login-attempts';
import { createD1DB } from '../db';
import type { User } from '../../models';
import {
  apiError, classSearchQuerySchema, loginSelectionBodySchema, loginBodySchema,
  passwordBodySchema, profileBodySchema, requireAuthenticatedUser,
  staffLoginBodySchema, studentNameLoginBodySchema, studentUidLoginBodySchema,
  toPublicUser, validateName, validatePassword, validationHook
} from '../../http';
import { getCFConfig } from '../config';

const dummyPasswordHash = await hashPassword('not-the-real-password');
const loginChallenges = new Map<string, { userIds: Set<number>; expiresAt: number }>();
const loginChallengeTtlMs = 5 * 60 * 1000;

function resolveClientAddress(c: Context<CFAppBindings>) {
  return c.req.header('cf-connecting-ip')
    ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? c.req.header('x-real-ip')?.trim()
    ?? 'unknown';
}

function buildLoginAttemptKey(kind: string, identifier: string, clientAddress: string) {
  return `${kind}:${identifier}@${clientAddress}`;
}

function toLoginCandidate(user: User) {
  return { uid: user.uid, role: user.role, name: user.name, english_name: user.english_name };
}

function toAuthUser(user: User) {
  return {
    id: user.id, uid: user.uid, role: user.role, name: user.name,
    english_name: user.english_name,
    password_setup_required: isLowCostPasswordHash(user.password)
  };
}

async function finishLogin(user: User, c: Context<CFAppBindings>) {
  const authUser = toAuthUser(user);
  const token = await signAccessToken(authUser, c.env);
  setAuthCookie(c, token, c.env);
  c.header('cache-control', 'no-store');
  return c.json({ token, user: authUser });
}

function createLoginChallenge(users: User[]) {
  const challenge = randomBytes(32).toString('base64url');
  loginChallenges.set(challenge, { userIds: new Set(users.map((u) => u.id)), expiresAt: Date.now() + loginChallengeTtlMs });
  return challenge;
}

function cleanupLoginChallenges() {
  const now = Date.now();
  for (const [k, v] of loginChallenges) if (v.expiresAt <= now) loginChallenges.delete(k);
}

async function resolveLogin(c: Context<CFAppBindings>, kind: string, identifier: string, candidates: User[], passwordEnvelope: string) {
  let password: string;
  try {
    password = decryptEnvelope(passwordEnvelope);
  } catch (error) {
    if (error instanceof EnvelopeDecryptError) {
      c.header('cache-control', 'no-store');
      return apiError(c, 400, error.message);
    }
    throw error;
  }

  if (!password) return apiError(c, 400, '密码不能为空。');
  const clientAddress = resolveClientAddress(c);
  const attemptKey = buildLoginAttemptKey(kind, identifier, clientAddress);
  const db = createD1DB(c.env.DB);
  const cfg = getCFConfig(c.env);
  const remainingMs = await getRemainingLockoutMs(db, cfg.login_lockout_ms, attemptKey);

  if (remainingMs > 0) {
    c.header('cache-control', 'no-store');
    return apiError(c, 429, `登录失败次数过多，请在 ${Math.ceil(remainingMs / 1000)} 秒后重试。`);
  }

  if (candidates.length === 0) {
    await verifyPassword(password, dummyPasswordHash);
    await recordLoginFailure(db, cfg.login_max_attempts, cfg.login_lockout_ms, attemptKey);
    c.header('cache-control', 'no-store');
    return apiError(c, 401, '账号或密码错误。');
  }

  const matched: User[] = [];
  for (const user of candidates) {
    if (await verifyPassword(password, user.password)) matched.push(user);
  }

  if (matched.length === 0) {
    await recordLoginFailure(db, cfg.login_max_attempts, cfg.login_lockout_ms, attemptKey);
    c.header('cache-control', 'no-store');
    return apiError(c, 401, '账号或密码错误。');
  }

  await clearLoginFailures(db, attemptKey);

  if (matched.length === 1) return finishLogin(matched[0]!, c);

  c.header('cache-control', 'no-store');
  return c.json({ challenge: createLoginChallenge(matched), candidates: matched.map(toLoginCandidate) });
}

export const cfAuthRoutes = new Hono<CFAppBindings>()
  .use('*', authMiddleware)
  .get('/public-key', (c) => {
    c.header('cache-control', 'no-store');
    return c.json(getPublicKey());
  })
  .get('/classes/search', zValidator('query', classSearchQuerySchema, validationHook), async (c) => {
    const query = c.req.valid('query');
    return c.json({ classes: await c.var.db.searchClasses(query.q?.trim() ?? '') });
  })
  .post('/login/student-uid', zValidator('json', studentUidLoginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const user = await c.var.db.findStudentByUid(body.uid);
    return resolveLogin(c, 'student-uid', String(body.uid), user ? [user] : [], body.password);
  })
  .post('/login/student-name', zValidator('json', studentNameLoginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const targetClass = await c.var.db.findClassById(body.class_id);
    if (!targetClass) return apiError(c, 404, '班级不存在。');
    return resolveLogin(c, 'student-name', `${body.class_id}:${body.name.trim()}`,
      await c.var.db.findStudentsByClassAndName(body.class_id, body.name.trim()), body.password);
  })
  .post('/login/staff', zValidator('json', staffLoginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    return resolveLogin(c, 'staff', body.identifier.trim(), await c.var.db.findStaffByIdentifier(body.identifier), body.password);
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
    const user = await c.var.db.findUserByUid(body.uid);
    if (!user) {
      c.header('cache-control', 'no-store');
      return apiError(c, 401, '登录选择已失效，请重新登录。');
    }
    return finishLogin(user, c);
  })
  .post('/login', zValidator('json', loginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const uid = Number(body.uid.trim());
    const clientAddress = resolveClientAddress(c);
    const uidKey = `uid:${uid}@${clientAddress}`;
    const netKey = `net:${clientAddress}`;
    const db = createD1DB(c.env.DB);
    const cfg = getCFConfig(c.env);

    let password: string;
    try {
      password = decryptEnvelope(body.password);
    } catch (error) {
      if (error instanceof EnvelopeDecryptError) {
        c.header('cache-control', 'no-store');
        return apiError(c, 400, error.message);
      }
      throw error;
    }

    if (!Number.isInteger(uid) || uid <= 0 || !password) return apiError(c, 400, 'UID 和密码不能为空。');
    const user = await c.var.db.findUserByUid(uid);

    if (!user) {
      const remaining = await getRemainingLockoutMs(db, cfg.login_lockout_ms, netKey);
      if (remaining > 0) {
        c.header('cache-control', 'no-store');
        return apiError(c, 429, `登录失败次数过多，请在 ${Math.ceil(remaining / 1000)} 秒后重试。`);
      }
      await verifyPassword(password, dummyPasswordHash);
      await recordLoginFailure(db, cfg.login_max_attempts, cfg.login_lockout_ms, netKey);
      c.header('cache-control', 'no-store');
      return apiError(c, 401, 'UID 或密码错误。');
    }

    const remaining = await getRemainingLockoutMs(db, cfg.login_lockout_ms, uidKey);
    if (remaining > 0) {
      c.header('cache-control', 'no-store');
      return apiError(c, 429, `登录失败次数过多，请在 ${Math.ceil(remaining / 1000)} 秒后重试。`);
    }

    const matched = await verifyPassword(password, user.password);
    if (!matched) {
      await recordLoginFailure(db, cfg.login_max_attempts, cfg.login_lockout_ms, uidKey);
      c.header('cache-control', 'no-store');
      return apiError(c, 401, 'UID 或密码错误。');
    }

    await clearLoginFailures(db, uidKey);
    c.header('cache-control', 'no-store');
    const passwordSetupRequired = isLowCostPasswordHash(user.password);
    const authUser = { id: user.id, uid: user.uid, role: user.role, name: user.name, english_name: user.english_name, password_setup_required: passwordSetupRequired };
    const token = await signAccessToken(authUser, c.env);
    setAuthCookie(c, token, c.env);
    return c.json({ token, user: authUser });
  })
  .get('/me', (c) => {
    const authFailure = requireAuthenticatedUser(c);
    if (authFailure) return authFailure;
    c.header('cache-control', 'no-store');
    return c.json({ user: c.get('user')! });
  })
  .put('/password', zValidator('json', passwordBodySchema, validationHook), async (c) => {
    const authFailure = requireAuthenticatedUser(c);
    if (authFailure) return authFailure;
    const body = c.req.valid('json');
    const currentUser = c.get('user')!;
    const userRecord = await c.var.db.findUserById(currentUser.id);
    if (!userRecord) return apiError(c, 404, '用户不存在。');

    let currentPassword: string, newPassword: string;
    try {
      currentPassword = decryptEnvelope(body.current_password);
      newPassword = decryptEnvelope(body.new_password);
    } catch (error) {
      if (error instanceof EnvelopeDecryptError) return apiError(c, 400, error.message);
      throw error;
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) return apiError(c, 400, passwordError);
    const matched = await verifyPassword(currentPassword, userRecord.password);
    if (!matched) return apiError(c, 401, '当前密码错误。');

    await c.var.db.updateUserPassword(userRecord.id, await hashPassword(newPassword));
    const authUser = { ...currentUser, password_setup_required: false };
    const token = await signAccessToken(authUser, c.env);
    setAuthCookie(c, token, c.env);
    return c.json({ message: '密码修改成功。', token, user: authUser });
  })
  .put('/profile', zValidator('json', profileBodySchema, validationHook), async (c) => {
    const authFailure = requireAuthenticatedUser(c);
    if (authFailure) return authFailure;
    const body = c.req.valid('json');
    const currentUser = c.get('user')!;
    if (currentUser.role === 'student') return apiError(c, 403, '学生不能修改姓名。');
    const nameError = validateName(body.name);
    if (nameError) return apiError(c, 400, nameError);
    const userRecord = await c.var.db.findUserById(currentUser.id);
    if (!userRecord) return apiError(c, 404, '用户不存在。');
    let currentPassword: string;
    try { currentPassword = decryptEnvelope(body.current_password); }
    catch (error) { if (error instanceof EnvelopeDecryptError) return apiError(c, 400, error.message); throw error; }
    const matched = await verifyPassword(currentPassword, userRecord.password);
    if (!matched) return apiError(c, 401, '当前密码错误。');
    const name = body.name.trim();
    await c.var.db.updateUserName(userRecord.id, name);
    return c.json({ message: '姓名修改成功。', user: toPublicUser({ ...currentUser, name }) });
  })
  .post('/logout', (c) => {
    clearAuthCookie(c);
    return c.json({ message: '已退出登录。' });
  });
