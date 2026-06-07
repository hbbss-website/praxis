import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { CFAppBindings } from '../auth-plugin';
import { authMiddleware } from '../auth-plugin';
import { apiError, createRecordBodySchema, isValidRecordImagePath, normalizeOptionalString, requireRole, updateRecordBodySchema, validateContent, validateDuration, validateLocation, validatePracticeDate, validateTitle, parseDuration, validationHook } from '../../http';
import type { UpdateRecordInput } from '../../models';
import { MAX_RECORD_IMAGES } from '../../models';

const recordIdParamSchema = z.object({ id: z.string().regex(/^[1-9]\d*$/) });

function buildRecordPayload(body: Record<string, unknown>) {
  return {
    title: typeof body.title === 'string' ? body.title.trim() : '',
    content: typeof body.content === 'string' ? body.content.trim() : '',
    practiceDate: typeof body.practice_date === 'string' ? body.practice_date.trim() : '',
    location: body.location === undefined ? undefined : normalizeOptionalString(body.location),
    duration: body.duration === undefined ? undefined : parseDuration(body.duration),
    imagePaths: Array.isArray(body.image_paths) ? body.image_paths.filter((i): i is string => typeof i === 'string') : undefined,
    coverImagePath: body.cover_image_path === undefined ? undefined : normalizeOptionalString(body.cover_image_path)
  };
}

function validateRecordImages(imagePaths: string[] | undefined, coverImagePath: string | null | undefined) {
  if (!imagePaths) return null;
  if (imagePaths.length > MAX_RECORD_IMAGES) return `每条记录最多上传 ${MAX_RECORD_IMAGES} 张图片。`;
  if (new Set(imagePaths).size !== imagePaths.length) return '图片不能重复。';
  if (imagePaths.some((p) => !isValidRecordImagePath(p))) return '图片路径无效。';
  if (coverImagePath && !imagePaths.includes(coverImagePath)) return '封面图必须从已上传图片中选择。';
  return null;
}

function validateTaskRecordConstraints(task: any, content: string, imagePaths: string[]) {
  const now = new Date().toISOString();
  if (now < task.start_at) return '任务尚未开始。';
  if (now > task.end_at) return '任务已结束。';
  const wordCount = (content.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0) + (content.match(/[㐀-鿿]/g)?.length ?? 0);
  if (wordCount < task.min_words) return `实践内容不能少于 ${task.min_words} 字。`;
  if (imagePaths.length < task.min_images) return `至少需要上传 ${task.min_images} 张图片。`;
  return null;
}

export const cfStudentRoutes = new Hono<CFAppBindings>()
  .use('/students/me/*', authMiddleware)
  .use('/students/me/*', async (c, next) => {
    const f = requireRole(c, ['student']);
    if (f) return f;
    await next();
  })
  .get('/students/me/tasks', async (c) => {
    const user = c.get('user')!;
    return c.json({ tasks: await c.var.db.getStudentTasks(user.id) });
  })
  .get('/students/me/tasks/:id', zValidator('param', recordIdParamSchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const task = await c.var.db.getStudentTaskById(id, user.id);
    if (!task) return apiError(c, 404, '任务不存在。');
    return c.json({ task, records: await c.var.db.getRecordsByStudentTask(user.id, id) });
  })
  .get('/students/me/records', async (c) => {
    const user = c.get('user')!;
    return c.json({ records: await c.var.db.getRecordsByStudent(user.id), statistics: await c.var.db.getStudentStatistics(user.id) });
  })
  .post('/students/me/records', zValidator('json', createRecordBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const taskId = body.task_id;
    if (!taskId) return apiError(c, 400, '缺少任务。');
    const task = await c.var.db.getStudentTaskById(taskId, user.id);
    if (!task) return apiError(c, 404, '任务不存在。');
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
    const taskError = validateTaskRecordConstraints(task, payload.content, imagePaths);
    if (taskError) return apiError(c, 400, taskError);
    if (await c.var.db.countStudentTaskRecords(user.id, task.id) >= task.max_records_per_student) return apiError(c, 400, `每个学生最多提交 ${task.max_records_per_student} 条记录。`);
    if (await c.var.db.countStudentRecordsToday(user.id) >= c.var.db.MAX_DAILY_RECORDS) return apiError(c, 429, `每天最多创建 ${c.var.db.MAX_DAILY_RECORDS} 条实践记录。`);
    let record;
    try {
      record = await c.var.db.createRecord({ student_id: user.id, task_id: task.id, title: payload.title, content: payload.content, practice_date: payload.practiceDate, location: payload.location ?? null, duration: payload.duration!, image_paths: imagePaths, cover_image_path: payload.coverImagePath ?? imagePaths[0] ?? null });
    } catch (error) { return apiError(c, 400, error instanceof Error ? error.message : '图片处理失败。'); }
    return c.json({ message: '记录创建成功。', recordId: record.id });
  })
  .put('/students/me/records/:id', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', updateRecordBodySchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const record = await c.var.db.getRecordById(id);
    if (!record || record.student_id !== user.id) return apiError(c, 404, '记录不存在。');
    if (!record.task_id) return apiError(c, 400, '记录未关联任务。');
    const task = await c.var.db.getStudentTaskById(record.task_id, user.id);
    if (!task) return apiError(c, 404, '任务不存在。');
    if (record.status !== 'pending' && record.status !== 'rejected') return apiError(c, 403, '只能修改待审核或已驳回的记录。');
    const payload = buildRecordPayload(body as Record<string, unknown>);
    const updates: UpdateRecordInput = {};
    if (body.title !== undefined) { const e = validateTitle(payload.title); if (e) return apiError(c, 400, e); updates.title = payload.title; }
    if (body.content !== undefined) { const e = validateContent(payload.content); if (e) return apiError(c, 400, e); updates.content = payload.content; }
    if (body.practice_date !== undefined) { const e = validatePracticeDate(payload.practiceDate); if (e) return apiError(c, 400, e); updates.practice_date = payload.practiceDate; }
    if (body.location !== undefined) { const e = validateLocation(payload.location ?? null); if (e) return apiError(c, 400, e); updates.location = payload.location ?? null; }
    if (body.duration !== undefined) { const e = validateDuration(payload.duration ?? Number.NaN); if (e) return apiError(c, 400, e); updates.duration = payload.duration!; }
    if (payload.imagePaths !== undefined || payload.coverImagePath !== undefined) {
      const imgs = payload.imagePaths ?? record.image_paths;
      const cover = payload.coverImagePath !== undefined ? payload.coverImagePath : record.cover_image_path;
      const imageError = validateRecordImages(imgs, cover);
      if (imageError) return apiError(c, 400, imageError);
      updates.image_paths = imgs; updates.cover_image_path = cover ?? imgs[0] ?? null;
    }
    const nextContent = updates.content ?? record.content;
    const nextImages = updates.image_paths ?? record.image_paths;
    const taskError = validateTaskRecordConstraints(task, nextContent, nextImages);
    if (taskError) return apiError(c, 400, taskError);
    if (record.status === 'rejected') { updates.status = 'pending'; updates.teacher_comment = null; updates.score = null; }
    try { await c.var.db.updateRecord(record.id, updates); }
    catch (error) { return apiError(c, 400, error instanceof Error ? error.message : '图片处理失败。'); }
    return c.json({ message: '记录更新成功。' });
  })
  .delete('/students/me/records/:id', zValidator('param', recordIdParamSchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const record = await c.var.db.getRecordById(id);
    if (!record || record.student_id !== user.id) return apiError(c, 404, '记录不存在。');
    if (record.status !== 'pending') return apiError(c, 403, '只能删除待审核的记录。');
    await c.var.db.deleteRecord(record.id, record.image_paths);
    return c.json({ message: '记录删除成功。' });
  })
  .get('/students/me/notifications', async (c) => {
    const user = c.get('user')!;
    return c.json({ notifications: await c.var.db.getNotificationsByStudent(user.id), unreadCount: await c.var.db.getUnreadNotificationCount(user.id) });
  })
  .post('/students/me/notifications/read-status', async (c) => {
    const user = c.get('user')!;
    await c.var.db.markNotificationsAsRead(user.id);
    return c.json({ message: '通知已标记为已读。' });
  });
