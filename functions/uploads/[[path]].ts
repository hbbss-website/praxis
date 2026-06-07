import type { Env } from '../../backend/src/cf/env';
import { getCookie } from 'hono/cookie';
import { jwtVerify } from 'jose';
import { getCFConfig, parseDurationSeconds } from '../../backend/src/cf/config';
import { createD1DB } from '../../backend/src/cf/db';
import { canAccessUpload } from '../../backend/src/cf/repository/uploads';
import type { AuthTokenPayload } from '../../backend/src/models';

const mimeTypes: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const imagePath = url.pathname;

  const cfg = getCFConfig(env);
  const jwtKey = new TextEncoder().encode(cfg.jwt_secret);
  const tokenAudiences = ['admin', 'teacher', 'student', 'unauthorized'];

  const authHeader = request.headers.get('authorization');
  const cookieHeader = request.headers.get('cookie');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = cookieHeader ? parseCookieToken(cookieHeader) : null;
  const token = bearerToken ?? cookieToken;

  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  let userId: number, userRole: string;

  try {
    const verified = await jwtVerify<AuthTokenPayload>(token, jwtKey, {
      issuer: cfg.jwt_issuer,
      audience: tokenAudiences
    });
    userId = verified.payload.id;
    userRole = verified.payload.role;
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = createD1DB(env.DB);
  const hasAccess = await canAccessUpload(db, env.UPLOADS, imagePath, userId, userRole);

  if (!hasAccess) {
    return new Response('Not Found', { status: 404 });
  }

  const key = imagePath.replace(/^\//, '');
  const obj = await env.UPLOADS.get(key);

  if (!obj) {
    return new Response('Not Found', { status: 404 });
  }

  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const contentType = mimeTypes[ext] ?? 'application/octet-stream';

  return new Response(obj.body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'private, max-age=3600',
    }
  });
};

function parseCookieToken(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name?.trim() === 'auth_token') return rest.join('=').trim();
  }
  return null;
}
