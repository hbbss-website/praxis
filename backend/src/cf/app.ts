import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import type { CFAppBindings } from './auth-plugin';
import { CFDatabase } from './database';
import { getCFConfig } from './config';
import { apiError } from '../http';
import { cfAuthRoutes } from './routes/auth';
import { cfAdminRoutes } from './routes/admin';
import { cfStudentRoutes } from './routes/students';
import { cfTeacherRoutes } from './routes/teachers';
import { cfUploadRoutes } from './routes/upload';
import { createD1DB } from './db';
import { cleanupExpiredTempUploads } from './repository/uploads';

// basePath('/api') mirrors the Node app's `.route('/api', api)`. The Pages
// function forwards the full `/api/...` request path, and the frontend calls
// `/api/...`, so routes must live under /api (defined here as /config, /auth, …).
// Workers have no startup hook, so the default admin is seeded lazily on the
// first request handled by each isolate. db.init() is idempotent (no-op once a
// user exists). If it throws (e.g. schema not migrated yet) we leave the flag
// unset so a later request retries once the D1 migrations have been applied.
let adminSeeded = false;

export const cfApi = new Hono<CFAppBindings>()
  .basePath('/api')
  .use('*', async (c, next) => {
    const db = new CFDatabase(c.env);
    c.set('db', db);
    c.set('user', null);
    c.set('authError', null);
    if (!adminSeeded) {
      try {
        await db.init();
        adminSeeded = true;
      } catch (error) {
        console.error('默认管理员初始化失败（数据库可能尚未迁移）：', error);
      }
    }
    await next();
  })
  .use('*', cors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  }))
  .get('/config', (c) => {
    const cfg = getCFConfig(c.env);
    return c.json({
      site_name: cfg.site_name,
      icp_beian: cfg.icp_beian,
      upload_image_max_size_bytes: cfg.upload_image_max_size_bytes,
      is_production: cfg.is_production,
      server_timestamp: Date.now()
    });
  })
  .route('/auth', cfAuthRoutes)
  .route('/admin', cfAdminRoutes)
  .route('/', cfStudentRoutes)
  .route('/', cfTeacherRoutes)
  .route('/', cfUploadRoutes)
  .notFound((c) => apiError(c, 404, '资源不存在。'))
  .onError((error, c) => {
    console.error(error);
    return apiError(c, 500, '服务器内部错误。');
  });

export async function handleScheduled(env: Env) {
  const db = createD1DB(env.DB);
  await cleanupExpiredTempUploads(db, env.UPLOADS);
}
