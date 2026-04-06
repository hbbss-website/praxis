import { createMiddleware } from 'hono/factory';
import { SignJWT, jwtVerify } from 'jose';

import { jwtAudience, jwtIssuer, jwtSecret, tokenLifetimeSeconds } from '../auth/config';
import { isLowCostPasswordHash } from '../auth/password';
import database from '../database';
import type { AuthTokenPayload, PublicUser } from '../models';

export interface AppBindings {
  Variables: {
    authError: string | null;
    user: PublicUser | null;
  };
}

const jwtKey = new TextEncoder().encode(jwtSecret);

function isPasswordSetupAllowedRequest(path: string, method: string) {
  if (method === 'OPTIONS') {
    return true;
  }

  if (path === '/api/auth/me') {
    return true;
  }

  return path === '/api/auth/password' && method === 'PUT';
}

function readBearerToken(authorization?: string | null) {
  if (!authorization) {
    return {
      token: null,
      error: '缺少认证令牌。'
    } as const;
  }

  if (!authorization.startsWith('Bearer ')) {
    return {
      token: null,
      error: '认证令牌无效。'
    } as const;
  }

  return {
    token: authorization.slice('Bearer '.length),
    error: null
  } as const;
}

export async function signAccessToken(user: PublicUser) {
  return await new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(jwtIssuer)
    .setAudience(jwtAudience)
    .setExpirationTime(`${tokenLifetimeSeconds}s`)
    .sign(jwtKey);
}

export const authMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const { token, error } = readBearerToken(c.req.header('authorization'));

  if (!token) {
    c.set('authError', error);
    c.set('user', null);
    await next();
    return;
  }

  try {
    const verified = await jwtVerify<AuthTokenPayload>(token, jwtKey, {
      issuer: jwtIssuer,
      audience: jwtAudience
    });
    const currentUser = database.findUserById(verified.payload.id);

    if (!currentUser || currentUser.uid !== verified.payload.uid || currentUser.role !== verified.payload.role) {
      c.set('authError', '认证用户不存在或已失效。');
      c.set('user', null);
      await next();
      return;
    }

    const passwordSetupRequired = isLowCostPasswordHash(currentUser.password);

    c.set('authError', null);
    c.set('user', {
      id: currentUser.id,
      uid: currentUser.uid,
      role: currentUser.role,
      name: currentUser.name,
      password_setup_required: passwordSetupRequired
    });

    if (passwordSetupRequired && !isPasswordSetupAllowedRequest(c.req.path, c.req.method)) {
      return c.json({ error: '请设置密码。' }, 403);
    }
  } catch {
    c.set('authError', '认证令牌无效或已过期。');
    c.set('user', null);
  }

  await next();
});
