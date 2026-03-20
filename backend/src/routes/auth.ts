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
  const uid = typeof request.body.uid === 'string' ? request.body.uid.trim() : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  const ipAddress = request.ip || request.socket.remoteAddress || 'unknown';

  if (!uid || !password) {
    response.status(400).json({ error: 'UID 和密码不能为空。' });
    return;
  }

  try {
    const remainingMs = getRemainingLockoutMs(ipAddress);
    if (remainingMs > 0) {
      response.setHeader('Cache-Control', 'no-store');
      response.status(429).json({
        error: `登录失败次数过多，请在 ${Math.ceil(remainingMs / 1000)} 秒后重试。`
      });
      return;
    }

    const user = database.findUserByUid(uid);

    if (!user) {
      await bcrypt.compare(password, dummyPasswordHash);
      recordLoginFailure(ipAddress);
      response.setHeader('Cache-Control', 'no-store');
      response.status(401).json({ error: 'UID 或密码错误。' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      recordLoginFailure(ipAddress);
      response.setHeader('Cache-Control', 'no-store');
      response.status(401).json({ error: 'UID 或密码错误。' });
      return;
    }

    clearLoginFailures(ipAddress);

    const authUser: AuthTokenPayload = { id: user.id, uid: user.uid, role: user.role, name: user.name };
    const token = jwt.sign(authUser, jwtSecret, {
      expiresIn: tokenLifetime,
      issuer: jwtIssuer,
      audience: jwtAudience,
      subject: String(user.id)
    });

    response.setHeader('Cache-Control', 'no-store');
    response.json({ token, user: authUser });
  } catch (error) {
    console.error('登录失败。', error);
    response.status(500).json({ error: '登录处理失败。' });
  }
});

router.get('/me', authMiddleware, (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ user: request.user });
});

router.put('/password', authMiddleware, async (request, response) => {
  const currentPassword = typeof request.body.current_password === 'string' ? request.body.current_password : '';
  const newPassword = typeof request.body.new_password === 'string' ? request.body.new_password : '';

  if (!currentPassword || !newPassword) {
    response.status(400).json({ error: '当前密码和新密码不能为空。' });
    return;
  }

  if (newPassword.length < 8) {
    response.status(400).json({ error: '新密码至少需要 8 位。' });
    return;
  }

  try {
    const user = database.findUserById(request.user!.id);
    if (!user) { response.status(404).json({ error: '用户不存在。' }); return; }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) { response.status(401).json({ error: '当前密码错误。' }); return; }

    const hashed = bcrypt.hashSync(newPassword, 10);
    database.updateUserPassword(user.id, hashed);
    response.json({ message: '密码修改成功。' });
  } catch (error) {
    console.error('修改密码失败。', error);
    response.status(500).json({ error: '修改密码失败。' });
  }
});

router.put('/profile', authMiddleware, async (request, response) => {
  if (request.user!.role === 'student') {
    response.status(403).json({ error: '学生不能修改姓名。' });
    return;
  }

  const currentPassword = typeof request.body.current_password === 'string' ? request.body.current_password : '';
  const newName = typeof request.body.name === 'string' ? request.body.name.trim() : '';

  if (!currentPassword || !newName) {
    response.status(400).json({ error: '当前密码和新姓名不能为空。' });
    return;
  }

  try {
    const user = database.findUserById(request.user!.id);
    if (!user) { response.status(404).json({ error: '用户不存在。' }); return; }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) { response.status(401).json({ error: '当前密码错误。' }); return; }

    database.updateUserName(user.id, newName);
    response.json({ message: '姓名修改成功。' });
  } catch (error) {
    console.error('修改姓名失败。', error);
    response.status(500).json({ error: '修改姓名失败。' });
  }
});

export default router;
