import { createMiddleware } from 'hono/factory';
import { setCookie, getCookie } from 'hono/cookie';
import { SignJWT, jwtVerify } from 'jose';

import { jwtIssuer, jwtSecret, tokenLifetimeSeconds } from '../auth/config';
import { isLowCostPasswordHash } from '../auth/password';
import database from '../database';
import type { AuthTokenPayload, PublicUser, UserRole } from '../models';
import { appConfig } from '../config';

export interface AppBindings {
  Variables: {
    authError: string | null;
    user: PublicUser | null;
  };
}

const jwtKey = new TextEncoder().encode(jwtSecret);
type TokenAudience = UserRole | 'unauthorized';

const tokenAudiences: TokenAudience[] = ['admin', 'teacher', 'student', 'unauthorized'];
const cookieName = 'auth_token';
const isProduction = appConfig.is_production;

function getTokenAudience(user: PublicUser): TokenAudience {
  return user.password_setup_required ? 'unauthorized' : user.role;
}

function tokenAudienceMatchesUser(audience: string | string[] | undefined, user: PublicUser) {
  const expectedAudience = getTokenAudience(user);
  return audience === expectedAudience || (Array.isArray(audience) && audience.length === 1 && audience[0] === expectedAudience);
}

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
    .setAudience(getTokenAudience(user))
    .setExpirationTime(`${tokenLifetimeSeconds}s`)
    .sign(jwtKey);
}

export function setAuthCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: tokenLifetimeSeconds
  });
}

export function clearAuthCookie(c: Parameters<typeof setCookie>[0]) {
  setCookie(c, cookieName, '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0
  });
}

export const authMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const headerResult = readBearerToken(c.req.header('authorization'));
  const cookieTokenValue = getCookie(c, cookieName);
  const token = headerResult.token ?? cookieTokenValue ?? null;
  const error = token ? null : (headerResult.error ?? '缺少认证令牌。');

  if (!token) {
    c.set('authError', error);
    c.set('user', null);
    await next();
    return;
  }

  try {
    const verified = await jwtVerify<AuthTokenPayload>(token, jwtKey, {
      issuer: jwtIssuer,
      audience: tokenAudiences
    });
    const currentUser = database.findUserById(verified.payload.id);

    if (!currentUser || currentUser.uid !== verified.payload.uid || currentUser.role !== verified.payload.role) {
      c.set('authError', '认证用户不存在或已失效。');
      c.set('user', null);
      await next();
      return;
    }

    const passwordSetupRequired = isLowCostPasswordHash(currentUser.password);
    const authUser = {
      id: currentUser.id,
      uid: currentUser.uid,
      role: currentUser.role,
      name: currentUser.name,
      password_setup_required: passwordSetupRequired
    };

    c.set('authError', null);
    c.set('user', authUser);

    if (!tokenAudienceMatchesUser(verified.payload.aud, authUser)) {
      if (passwordSetupRequired && verified.payload.aud === 'unauthorized' && isPasswordSetupAllowedRequest(c.req.path, c.req.method)) {
        await next();
        return;
      }

      c.set('authError', '认证令牌权限范围无效。');
      c.set('user', null);
      return c.json({ error: '认证令牌权限范围无效。' }, 403);
    }

    if (passwordSetupRequired && !isPasswordSetupAllowedRequest(c.req.path, c.req.method)) {
      return c.json({ error: '请设置密码。' }, 403);
    }
  } catch {
    c.set('authError', '认证令牌无效或已过期。');
    c.set('user', null);
  }

  await next();
});
