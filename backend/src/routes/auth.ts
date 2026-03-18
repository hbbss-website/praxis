import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';

import database from '../database';
import { clearLoginFailures, getRemainingLockoutMs, recordLoginFailure } from '../auth/login-attempts';
import { jwtAudience, jwtIssuer, jwtSecret, tokenLifetime } from '../auth/config';
import { authMiddleware } from '../middleware/auth';
import type { AuthTokenPayload } from '../models';

const router = Router();
const dummyPasswordHash = bcrypt.hashSync('not-the-real-password', 10);

router.post('/login', async (request, response) => {
  const username = typeof request.body.username === 'string' ? request.body.username.trim() : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  const ipAddress = request.ip || request.socket.remoteAddress || 'unknown';
  const attemptKey = ipAddress;

  if (!username || !password) {
    response.status(400).json({ error: '用户名和密码不能为空。' });
    return;
  }

  try {
    const remainingLockoutMs = getRemainingLockoutMs(attemptKey);

    if (remainingLockoutMs > 0) {
      response.setHeader('Cache-Control', 'no-store');
      response.status(429).json({
        error: `登录失败次数过多，请在 ${Math.ceil(remainingLockoutMs / 1000)} 秒后重试。`
      });
      return;
    }

    const user = database.findUserByUsername(username);

    if (!user) {
      await bcrypt.compare(password, dummyPasswordHash);
      recordLoginFailure(attemptKey);
      response.setHeader('Cache-Control', 'no-store');
      response.status(401).json({ error: '用户名或密码错误。' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      recordLoginFailure(attemptKey);
      response.setHeader('Cache-Control', 'no-store');
      response.status(401).json({ error: '用户名或密码错误。' });
      return;
    }

    clearLoginFailures(attemptKey);

    const authUser: AuthTokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name
    };

    const token = jwt.sign(authUser, jwtSecret, {
      expiresIn: tokenLifetime,
      issuer: jwtIssuer,
      audience: jwtAudience,
      subject: String(user.id)
    });

    response.setHeader('Cache-Control', 'no-store');
    response.json({
      token,
      user: authUser
    });
  } catch (error) {
    console.error('登录失败。', error);
    response.status(500).json({ error: '登录处理失败。' });
  }
});

router.get('/me', authMiddleware, (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ user: request.user });
});

export default router;
