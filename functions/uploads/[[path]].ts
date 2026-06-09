import type { Env } from '../../backend/src/cf/env';
import { jwtVerify } from 'jose';
import { getCFConfig } from '../../backend/src/cf/config';
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

  const authHeader = request.headers.get('authorization');
  const cookieHeader = request.headers.get('cookie');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = cookieHeader ? parseCookieToken(cookieHeader) : null;
  const token = bearerToken ?? cookieToken;

  if (!token) return new Response('Unauthorized', { status: 401 });

  try {
    await jwtVerify<AuthTokenPayload>(token, jwtKey, {
      issuer: cfg.jwt_issuer,
      audience: ['admin', 'teacher', 'student', 'unauthorized']
    });
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const key = imagePath.replace(/^\//, '');
  const obj = await env.UPLOADS.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });

  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return new Response(obj.body, {
    headers: {
      'content-type': mimeTypes[ext] ?? 'application/octet-stream',
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
