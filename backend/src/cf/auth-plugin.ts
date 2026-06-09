import { createMiddleware } from 'hono/factory';
import { setCookie, getCookie } from 'hono/cookie';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from './env';
import type { CFDatabase } from './database';
import { getCFConfig, parseDurationSeconds } from './config';
import { isLowCostPasswordHash } from './password';
import type { AuthTokenPayload, PublicUser, UserRole } from '../models';

export interface CFAppBindings {
  Bindings: Env;
  Variables: {
    authError: string | null;
    user: PublicUser | null;
    db: CFDatabase;
  };
}

type TokenAudience = UserRole | 'unauthorized';
const tokenAudiences: TokenAudience[] = ['admin', 'teacher', 'student', 'unauthorized'];
const cookieName = 'auth_token';

function getTokenAudience(user: PublicUser): TokenAudience {
  return user.password_setup_required ? 'unauthorized' : user.role;
}

function tokenAudienceMatchesUser(audience: string | string[] | undefined, user: PublicUser) {
  const expected = getTokenAudience(user);
  return audience === expected || (Array.isArray(audience) && audience.length === 1 && audience[0] === expected);
}

function isPasswordSetupAllowedRequest(path: string, method: string) {
  if (method === 'OPTIONS') return true;
  if (path === '/api/auth/me') return true;
  return path === '/api/auth/password' && method === 'PUT';
}

export async function signAccessToken(user: PublicUser, env: Env) {
  const cfg = getCFConfig(env);
  const jwtKey = new TextEncoder().encode(cfg.jwt_secret);
  const lifetime = parseDurationSeconds(cfg.jwt_expires_in, 8 * 60 * 60);
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(cfg.jwt_issuer)
    .setAudience(getTokenAudience(user))
    .setExpirationTime(`${lifetime}s`)
    .sign(jwtKey);
}

export function setAuthCookie(c: Parameters<typeof setCookie>[0], token: string, env: Env) {
  const cfg = getCFConfig(env);
  const lifetime = parseDurationSeconds(cfg.jwt_expires_in, 8 * 60 * 60);
  setCookie(c, cookieName, token, {
    httpOnly: true,
    secure: cfg.is_production,
    sameSite: 'Lax',
    path: '/',
    maxAge: lifetime
  });
}

export function clearAuthCookie(c: Parameters<typeof setCookie>[0]) {
  setCookie(c, cookieName, '', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 0 });
}

export const authMiddleware = createMiddleware<CFAppBindings>(async (c, next) => {
  const authorization = c.req.header('authorization');
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  const cookieToken = getCookie(c, cookieName) ?? null;
  const token = bearerToken ?? cookieToken;

  if (!token) {
    c.set('authError', bearerToken === null && cookieToken === null ? '缺少认证令牌。' : '认证令牌无效。');
    c.set('user', null);
    await next();
    return;
  }

  try {
    const cfg = getCFConfig(c.env);
    const jwtKey = new TextEncoder().encode(cfg.jwt_secret);
    const verified = await jwtVerify<AuthTokenPayload>(token, jwtKey, {
      issuer: cfg.jwt_issuer,
      audience: tokenAudiences
    });
    const database = c.var.db;
    const currentUser = await database.findUserById(verified.payload.id);

    if (!currentUser || currentUser.uid !== verified.payload.uid || currentUser.role !== verified.payload.role) {
      c.set('authError', '认证用户不存在或已失效。');
      c.set('user', null);
      await next();
      return;
    }

    const passwordSetupRequired = isLowCostPasswordHash(currentUser.password);
    const authUser: PublicUser = {
      id: currentUser.id, uid: currentUser.uid, role: currentUser.role,
      name: currentUser.name, english_name: currentUser.english_name,
      password_setup_required: passwordSetupRequired
    };

    c.set('authError', null);
    c.set('user', authUser);

    if (!tokenAudienceMatchesUser(verified.payload.aud, authUser)) {
      if (passwordSetupRequired && verified.payload.aud === 'unauthorized' && isPasswordSetupAllowedRequest(c.req.path, c.req.method)) {
        await next();
        return;
      }
      c.set('authError', '认证令牌已失效，请重新登录。');
      c.set('user', null);
      await next();
      return;
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
