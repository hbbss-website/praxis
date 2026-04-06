import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';

import { clearLoginFailures, getRemainingLockoutMs, recordLoginFailure } from '../auth/login-attempts';
import { hashPassword, isLowCostPasswordHash, verifyPassword } from '../auth/password';
import database from '../database';
import {
  apiError,
  loginBodySchema,
  passwordBodySchema,
  profileBodySchema,
  requireAuthenticatedUser,
  validateName,
  validatePassword,
  validationHook
} from '../http';
import { authMiddleware, signAccessToken, type AppBindings } from '../plugins/auth';

const dummyPasswordHash = await hashPassword('not-the-real-password');

function resolveClientKey(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
}

export const authRoutes = new Hono<AppBindings>()
  .use('*', authMiddleware)
  .post('/login', zValidator('json', loginBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const uid = body.uid.trim();
    const password = body.password;
    const clientKey = resolveClientKey(c.req.raw);

    if (!uid || !password) {
      return apiError(c, 400, 'UID 和密码不能为空。');
    }

    const remainingMs = getRemainingLockoutMs(clientKey);

    if (remainingMs > 0) {
      c.header('cache-control', 'no-store');
      return apiError(c, 429, `登录失败次数过多，请在 ${Math.ceil(remainingMs / 1000)} 秒后重试。`);
    }

    const user = database.findUserByUid(uid);

    if (!user) {
      await verifyPassword(password, dummyPasswordHash);
      recordLoginFailure(clientKey);
      c.header('cache-control', 'no-store');
      return apiError(c, 401, 'UID 或密码错误。');
    }

    const matched = await verifyPassword(password, user.password);

    if (!matched) {
      recordLoginFailure(clientKey);
      c.header('cache-control', 'no-store');
      return apiError(c, 401, 'UID 或密码错误。');
    }

    clearLoginFailures(clientKey);
    c.header('cache-control', 'no-store');
    const passwordSetupRequired = isLowCostPasswordHash(user.password);

    const authUser = {
      id: user.id,
      uid: user.uid,
      role: user.role,
      name: user.name,
      password_setup_required: passwordSetupRequired
    };

    return c.json({
      token: await signAccessToken(authUser),
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

    const passwordError = validatePassword(body.new_password);

    if (passwordError) {
      return apiError(c, 400, passwordError);
    }

    const matched = await verifyPassword(body.current_password, userRecord.password);

    if (!matched) {
      return apiError(c, 401, '当前密码错误。');
    }

    database.updateUserPassword(userRecord.id, await hashPassword(body.new_password));
    return c.json({ message: '密码修改成功。' });
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

    const matched = await verifyPassword(body.current_password, userRecord.password);

    if (!matched) {
      return apiError(c, 401, '当前密码错误。');
    }

    database.updateUserName(userRecord.id, body.name.trim());
    return c.json({ message: '姓名修改成功。' });
  });
