import { Hono } from 'hono';
import { cors } from 'hono/cors';
import fs from 'node:fs';
import path from 'node:path';

import { apiError } from './http';
import type { AppBindings } from './plugins/auth';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { studentRoutes } from './routes/students';
import { teacherRoutes } from './routes/teachers';
import { uploadRoutes } from './routes/upload';

const frontendDir = path.resolve(process.cwd(), 'frontend/dist');
const frontendIndexPath = path.join(frontendDir, 'index.html');
const uploadDir = path.resolve(process.cwd(), 'backend/uploads');

fs.mkdirSync(uploadDir, { recursive: true });

const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const mimeByExtension: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function resolveSafeFile(baseDir: string, requestPath: string) {
  const safePath = path.normalize(requestPath).replace(/^[/\\]+/, '').replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(baseDir, safePath);

  if (!filePath.startsWith(baseDir)) {
    return null;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return null;
  }

  return filePath;
}

function fileResponse(filePath: string) {
  return new Response(fs.readFileSync(filePath), {
    headers: {
      'content-type': mimeByExtension[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    }
  });
}

function resolveFrontendIndex() {
  return fs.existsSync(frontendIndexPath) ? frontendIndexPath : null;
}

export const api = new Hono<AppBindings>()
  .use('*', cors({
    origin: (origin) => {
      if (!origin || origin === 'null' || allowedOrigins.length === 0) {
        return origin ?? '*';
      }

      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  }))
  .route('/auth', authRoutes)
  .route('/admin', adminRoutes)
  .route('/', studentRoutes)
  .route('/', teacherRoutes)
  .route('/', uploadRoutes)
  .notFound((c) => apiError(c, 404, '资源不存在。'))
  .onError((error, c) => {
    console.error(error);
    return apiError(c, 500, error instanceof Error && error.message ? error.message : '服务器内部错误。');
  });

export type Api = typeof api;

export const app = new Hono<AppBindings>()
  .route('/api', api)
  .get('/health', (c) => c.json({ ok: true }))
  .get('/uploads/*', (c) => {
    const filePath = resolveSafeFile(uploadDir, c.req.path.replace(/^\/uploads\//, ''));

    if (!filePath) {
      return apiError(c, 404, '资源不存在。');
    }

    return fileResponse(filePath);
  })
  .get('/assets/*', (c) => {
    const filePath = resolveSafeFile(frontendDir, c.req.path.replace(/^\//, ''));

    if (!filePath) {
      return new Response('资源不存在。', { status: 404 });
    }

    return fileResponse(filePath);
  })
  .get('/', () => {
    const filePath = resolveFrontendIndex();
    return filePath ? fileResponse(filePath) : new Response('前端尚未构建，请先运行 pnpm build:frontend。');
  })
  .all('*', (c) => {
    if (c.req.path.startsWith('/api') || c.req.path.startsWith('/uploads')) {
      return apiError(c, 404, '资源不存在。');
    }

    const assetPath = resolveSafeFile(frontendDir, c.req.path.slice(1));

    if (assetPath) {
      return fileResponse(assetPath);
    }

    const indexPath = resolveFrontendIndex();

    if (!indexPath) {
      return new Response('前端尚未构建，请先运行 pnpm build:frontend。', { status: 404 });
    }

    return fileResponse(indexPath);
  });

export type App = typeof app;
