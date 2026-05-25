import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import database from '../database';
import {
  apiError,
  createRecordBodySchema,
  isValidRecordImagePath,
  normalizeOptionalString,
  requireRole,
  updateRecordBodySchema,
  validateContent,
  validateDuration,
  validateLocation,
  validatePracticeDate,
  validateTitle,
  parseDuration,
  validationHook
} from '../http';
import { authMiddleware, type AppBindings } from '../plugins/auth';
import type { UpdateRecordInput } from '../models';
import { MAX_RECORD_IMAGES } from '../models';

const recordIdParamSchema = z.object({
  id: z.string().regex(/^[1-9]\d*$/)
});

function buildRecordPayload(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const practiceDate = typeof body.practice_date === 'string' ? body.practice_date.trim() : '';
  const location = body.location === undefined ? undefined : normalizeOptionalString(body.location);
  const duration = body.duration === undefined ? undefined : parseDuration(body.duration);
  const imagePaths = Array.isArray(body.image_paths) ? body.image_paths.filter((item): item is string => typeof item === 'string') : undefined;
  const coverImagePath = body.cover_image_path === undefined ? undefined : normalizeOptionalString(body.cover_image_path);

  return {
    title,
    content,
    practiceDate,
    location,
    duration,
    imagePaths,
    coverImagePath
  };
}

function validateRecordImages(imagePaths: string[] | undefined, coverImagePath: string | null | undefined) {
  if (!imagePaths) {
    return null;
  }

  if (imagePaths.length > MAX_RECORD_IMAGES) {
    return `每条记录最多上传 ${MAX_RECORD_IMAGES} 张图片。`;
  }

  if (new Set(imagePaths).size !== imagePaths.length) {
    return '图片不能重复。';
  }

  if (imagePaths.some((imagePath) => !isValidRecordImagePath(imagePath))) {
    return '图片路径无效。';
  }

  if (coverImagePath && !imagePaths.includes(coverImagePath)) {
    return '封面图必须从已上传图片中选择。';
  }

  return null;
}

export const studentRoutes = new Hono<AppBindings>()
  .use('/students/me/*', authMiddleware)
  .use('/students/me/*', async (c, next) => {
    const authFailure = requireRole(c, ['student']);

    if (authFailure) {
      return authFailure;
    }

    await next();
  })
  .get('/students/me/records', (c) => {
    const user = c.get('user')!;

    return c.json({
      records: database.getRecordsByStudent(user.id),
      statistics: database.getStudentStatistics(user.id)
    });
  })
  .post('/students/me/records', zValidator('json', createRecordBodySchema, validationHook), (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const payload = buildRecordPayload(body as Record<string, unknown>);
    const titleError = validateTitle(payload.title);
    const contentError = validateContent(payload.content);
    const dateError = validatePracticeDate(payload.practiceDate);
    const durationError = validateDuration(payload.duration ?? Number.NaN);
    const locationError = validateLocation(payload.location ?? null);

    if (titleError) return apiError(c, 400, titleError);
    if (contentError) return apiError(c, 400, contentError);
    if (dateError) return apiError(c, 400, dateError);
    if (durationError) return apiError(c, 400, durationError);
    if (locationError) return apiError(c, 400, locationError);

    const imagePaths = payload.imagePaths ?? [];
    const imageError = validateRecordImages(imagePaths, payload.coverImagePath ?? null);
    if (imageError) return apiError(c, 400, imageError);

    if (database.countStudentRecordsToday(user.id) >= database.MAX_DAILY_RECORDS) {
      return apiError(c, 429, `每天最多创建 ${database.MAX_DAILY_RECORDS} 条实践记录。`);
    }

    let record;

    try {
      record = database.createRecord({
        student_id: user.id,
        title: payload.title,
        content: payload.content,
        practice_date: payload.practiceDate,
        location: payload.location ?? null,
        duration: payload.duration!,
        image_paths: imagePaths,
        cover_image_path: payload.coverImagePath ?? imagePaths[0] ?? null
      });
    } catch (error) {
      return apiError(c, 400, error instanceof Error ? error.message : '图片处理失败。');
    }

    return c.json({
      message: '记录创建成功。',
      recordId: record.id
    });
  })
  .put('/students/me/records/:id', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', updateRecordBodySchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const record = database.getRecordById(id);

    if (!record || record.student_id !== user.id) {
      return apiError(c, 404, '记录不存在。');
    }

    if (record.status !== 'pending' && record.status !== 'rejected') {
      return apiError(c, 403, '只能修改待审核或已驳回的记录。');
    }

    const payload = buildRecordPayload(body as Record<string, unknown>);
    const updates: UpdateRecordInput = {};

    if (body.title !== undefined) {
      const error = validateTitle(payload.title);
      if (error) return apiError(c, 400, error);
      updates.title = payload.title;
    }

    if (body.content !== undefined) {
      const error = validateContent(payload.content);
      if (error) return apiError(c, 400, error);
      updates.content = payload.content;
    }

    if (body.practice_date !== undefined) {
      const error = validatePracticeDate(payload.practiceDate);
      if (error) return apiError(c, 400, error);
      updates.practice_date = payload.practiceDate;
    }

    if (body.location !== undefined) {
      const error = validateLocation(payload.location ?? null);
      if (error) return apiError(c, 400, error);
      updates.location = payload.location ?? null;
    }

    if (body.duration !== undefined) {
      const error = validateDuration(payload.duration ?? Number.NaN);
      if (error) return apiError(c, 400, error);
      updates.duration = payload.duration!;
    }

    if (payload.imagePaths !== undefined || payload.coverImagePath !== undefined) {
      const imagePaths = payload.imagePaths ?? record.image_paths;
      const coverImagePath = payload.coverImagePath !== undefined ? payload.coverImagePath : record.cover_image_path;
      const imageError = validateRecordImages(imagePaths, coverImagePath);
      if (imageError) return apiError(c, 400, imageError);

      updates.image_paths = imagePaths;
      updates.cover_image_path = coverImagePath ?? imagePaths[0] ?? null;
    }

    if (record.status === 'rejected') {
      updates.status = 'pending';
      updates.teacher_comment = null;
    }

    try {
      database.updateRecord(record.id, updates);
    } catch (error) {
      return apiError(c, 400, error instanceof Error ? error.message : '图片处理失败。');
    }

    return c.json({ message: '记录更新成功。' });
  })
  .delete('/students/me/records/:id', zValidator('param', recordIdParamSchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const record = database.getRecordById(id);

    if (!record || record.student_id !== user.id) {
      return apiError(c, 404, '记录不存在。');
    }

    if (record.status !== 'pending') {
      return apiError(c, 403, '只能删除待审核的记录。');
    }

    database.deleteRecord(record.id, record.image_paths);
    return c.json({ message: '记录删除成功。' });
  })
  .get('/students/me/notifications', (c) => {
    const user = c.get('user')!;

    return c.json({
      notifications: database.getNotificationsByStudent(user.id),
      unreadCount: database.getUnreadNotificationCount(user.id)
    });
  })
  .post('/students/me/notifications/read-status', (c) => {
    const user = c.get('user')!;
    database.markNotificationsAsRead(user.id);
    return c.json({ message: '通知已标记为已读。' });
  });
