import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { CFAppBindings } from '../auth-plugin';
import { authMiddleware } from '../auth-plugin';
import { hashPassword } from '../password';
import { decryptEnvelope, EnvelopeDecryptError } from '../password-key-manager';
import { getCFConfig } from '../config';
import { createUserCredentialsCsv } from '../../csv/user-import';
import { formatCsv } from '../../csv/export';
import {
  apiError, batchResetPasswordBodySchema, batchUpdateStudentClassBodySchema, batchReviewBodySchema,
  buildReviewNotificationMessage, classIdsBodySchema, createTaskBodySchema, isValidRecordImagePath,
  isValidUploadPath, normalizeOptionalString, normalizeRecordFilters, parseDateTimeInput, parseDuration,
  recordQuerySchema, requireRole, reviewRecordBodySchema, updateTaskBodySchema, updateRecordBodySchema,
  updateUserBodySchema, userSearchQuerySchema, validateComment, validateContent, validateDuration,
  validateEnglishName, validateLocation, validateName, validatePassword, validatePracticeDate,
  validateRecordFilters, validateTitle, validateTaskDescription, validateTaskTitle, validationHook
} from '../../http';
import type { RecordFilters, UpdateRecordInput, UserRole } from '../../models';
import { MAX_RECORD_IMAGES } from '../../models';
import { formatUtcDateTimeMinute, startOfUtcTodayIso } from '../../time';

const recordIdParamSchema = z.object({ id: z.string().regex(/^[1-9]\d*$/) });

function parseIdList(value?: string) {
  if (!value) return undefined;
  return value.split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

function parseRecordFilters(query: Record<string, unknown>): RecordFilters {
  return normalizeRecordFilters({
    task_id: typeof query.task_id === 'string' ? Number(query.task_id) : null,
    student_id: typeof query.student_id === 'string' ? Number(query.student_id) : null,
    student_ids: typeof query.student_ids === 'string' && query.student_ids ? query.student_ids.split(',').map(Number) : null,
    class_id: typeof query.class_id === 'string' ? Number(query.class_id) : null,
    class_ids: typeof query.class_ids === 'string' && query.class_ids ? query.class_ids.split(',').map(Number) : null,
    status: typeof query.status === 'string' ? query.status as RecordFilters['status'] : null,
    practice_after: typeof query.practice_after === 'string' && query.practice_after ? query.practice_after : null,
    practice_before: typeof query.practice_before === 'string' && query.practice_before ? query.practice_before : null,
    created_after: typeof query.created_after === 'string' && query.created_after ? parseDateTimeInput(query.created_after) : null,
    created_before: typeof query.created_before === 'string' && query.created_before ? parseDateTimeInput(query.created_before) : null
  });
}

function buildTaskPayload(body: any) {
  return {
    title: body.title?.trim(),
    description: body.description === undefined ? undefined : normalizeOptionalString(body.description),
    start_at: body.start_at === undefined ? undefined : parseDateTimeInput(body.start_at),
    end_at: body.end_at === undefined ? undefined : parseDateTimeInput(body.end_at),
    min_words: body.min_words, min_images: body.min_images,
    max_records_per_student: body.max_records_per_student,
    score_enabled: body.score_enabled, class_ids: body.class_ids
  };
}

function validateTaskPayload(payload: any, current?: { start_at: string; end_at: string }) {
  if (payload.title !== undefined) { const e = validateTaskTitle(payload.title); if (e) return e; }
  if (payload.description !== undefined) { const e = validateTaskDescription(payload.description); if (e) return e; }
  const startAt = payload.start_at ?? current?.start_at;
  const endAt = payload.end_at ?? current?.end_at;
  if (!startAt) return '开始时间无效。';
  if (!endAt) return '截止时间无效。';
  if (startAt > endAt) return '开始时间不能晚于截止时间。';
  if (payload.end_at !== undefined && endAt < startOfUtcTodayIso()) return '截止时间不能早于今天。';
  return null;
}

function validateRecordImages(imagePaths: string[], coverImagePath: string | null) {
  if (imagePaths.length > MAX_RECORD_IMAGES) return `每条记录最多上传 ${MAX_RECORD_IMAGES} 张图片。`;
  if (new Set(imagePaths).size !== imagePaths.length) return '图片不能重复。';
  if (imagePaths.some((p) => !isValidRecordImagePath(p) && !isValidUploadPath(p))) return '图片路径无效。';
  if (coverImagePath && !imagePaths.includes(coverImagePath)) return '封面图必须从已上传图片中选择。';
  return null;
}

function validateReviewScore({ status, score, scoreEnabled }: { status: string; score: number | undefined; scoreEnabled: boolean }) {
  if (!scoreEnabled) return score === undefined ? null : '该任务未启用打分。';
  if (status !== 'approved') return null;
  if (score === undefined || !Number.isInteger(score) || score < 0 || score > 100) return '分数必须是 0 到 100 的整数。';
  return null;
}

export const cfTeacherRoutes = new Hono<CFAppBindings>()
  .use('/teacher/*', authMiddleware)
  .use('/teacher/*', async (c, next) => {
    const f = requireRole(c, ['teacher', 'admin']);
    if (f) return f;
    await next();
  })
  .get('/teacher/tasks', async (c) => {
    const user = c.get('user')!;
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    return c.json({ tasks: await c.var.db.getManageableTasks(visibleClassIds) });
  })
  .post('/teacher/tasks', zValidator('json', createTaskBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const payload = buildTaskPayload(body);
    const error = validateTaskPayload(payload);
    if (error) return apiError(c, 400, error);
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    const canManageClasses = !visibleClassIds ? body.class_ids.every((id: number) => Boolean(id)) : body.class_ids.every((id: number) => visibleClassIds.has(id));
    if (!canManageClasses) return apiError(c, 403, '无权选择部分班级。');
    const task = await c.var.db.createTask({ title: payload.title!, description: payload.description ?? null, start_at: payload.start_at!, end_at: payload.end_at!, min_words: body.min_words, min_images: body.min_images, max_records_per_student: body.max_records_per_student, score_enabled: body.score_enabled, class_ids: body.class_ids, created_by_id: user.id });
    return c.json({ message: '任务创建成功。', task });
  })
  .get('/teacher/tasks/:id', zValidator('param', recordIdParamSchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    const task = await c.var.db.getManageableTaskById(id, visibleClassIds);
    if (!task) return apiError(c, 404, '任务不存在。');
    return c.json({ task });
  })
  .put('/teacher/tasks/:id', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', updateTaskBodySchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    const task = await c.var.db.getManageableTaskById(id, visibleClassIds);
    if (!task) return apiError(c, 404, '任务不存在。');
    if (body.class_ids) {
      const canManage = !visibleClassIds ? true : body.class_ids.every((cid: number) => visibleClassIds.has(cid));
      if (!canManage) return apiError(c, 403, '无权选择部分班级。');
    }
    const payload = buildTaskPayload(body);
    const error = validateTaskPayload(payload, task);
    if (error) return apiError(c, 400, error);
    const updated = await c.var.db.updateTask(id, {
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.start_at ? { start_at: payload.start_at } : {}),
      ...(payload.end_at ? { end_at: payload.end_at } : {}),
      ...(payload.min_words !== undefined ? { min_words: payload.min_words } : {}),
      ...(payload.min_images !== undefined ? { min_images: payload.min_images } : {}),
      ...(payload.max_records_per_student !== undefined ? { max_records_per_student: payload.max_records_per_student } : {}),
      ...(payload.class_ids !== undefined ? { class_ids: payload.class_ids } : {})
    });
    return c.json({ message: '任务更新成功。', task: updated });
  })
  .delete('/teacher/tasks/:id', zValidator('param', recordIdParamSchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    const task = await c.var.db.getManageableTaskById(id, visibleClassIds);
    if (!task) return apiError(c, 404, '任务不存在。');
    if (user.role !== 'admin') {
      const myClassIds = await c.var.db.getTeacherClassIds(user.id);
      const mySet = new Set(myClassIds);
      if (!task.classes.every((item: any) => mySet.has(item.id))) return apiError(c, 403, '只能删除完全属于自己管理范围的任务。');
    }
    await c.var.db.deleteTask(id);
    return c.json({ message: '任务已删除。' });
  })
  .get('/teacher/tasks/:id/classes/:classId/record-count', zValidator('param', z.object({ id: z.string().regex(/^[1-9]\d*$/), classId: z.string().regex(/^[1-9]\d*$/) }), validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const classId = Number(c.req.valid('param').classId);
    const user = c.get('user')!;
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    const task = await c.var.db.getManageableTaskById(id, visibleClassIds);
    if (!task || !task.classes.some((item: any) => item.id === classId)) return apiError(c, 404, '任务班级不存在。');
    if (user.role !== 'admin' && visibleClassIds && !visibleClassIds.has(classId)) return apiError(c, 403, '无权管理该班级。');
    return c.json({ count: await c.var.db.countTaskClassRecords(id, classId) });
  })
  .delete('/teacher/tasks/:id/classes/:classId', zValidator('param', z.object({ id: z.string().regex(/^[1-9]\d*$/), classId: z.string().regex(/^[1-9]\d*$/) }), validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const classId = Number(c.req.valid('param').classId);
    const user = c.get('user')!;
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    const task = await c.var.db.getManageableTaskById(id, visibleClassIds);
    if (!task || !task.classes.some((item: any) => item.id === classId)) return apiError(c, 404, '任务班级不存在。');
    if (user.role !== 'admin' && visibleClassIds && !visibleClassIds.has(classId)) return apiError(c, 403, '无权管理该班级。');
    const deletedCount = await c.var.db.removeTaskClass(id, classId);
    return c.json({ message: '班级已从任务中移除。', deletedCount });
  })
  .post('/teacher/tasks/:id/export', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', classIdsBodySchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    const task = await c.var.db.getManageableTaskById(id, visibleClassIds);
    if (!task) return apiError(c, 404, '任务不存在。');
    const canManage = !visibleClassIds ? true : body.class_ids.every((cid: number) => visibleClassIds.has(cid));
    if (!canManage) return apiError(c, 403, '无权导出部分班级。');
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    const records = await c.var.db.getRecordsForExport({ task_id: id, class_ids: body.class_ids }, visibleStudentIds);
    const csv = formatCsv([
      ['任务名称', '班级', '学生姓名', '学生 UID', '记录标题', '实践日期', '时长', '地点', '状态', '分数', '教师评语', '提交时间', '正文', '图片数量'],
      ...records.map((r) => [task.title, r.class_label, r.student_name, r.student_uid, r.title, r.practice_date, r.duration, r.location, r.status, r.score ?? '', r.teacher_comment, formatUtcDateTimeMinute(r.created_at), r.content, r.image_count])
    ]);
    return c.text(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="task-${id}-records.csv"` });
  })
  .get('/teacher/overview', zValidator('query', z.object({ class_id: z.string().regex(/^[1-9]\d*$/).optional() }), (r, c) => { if (!r.success) return apiError(c, 400, '请求参数无效。'); }), async (c) => {
    const user = c.get('user')!;
    const classId = c.req.valid('query').class_id ? Number(c.req.valid('query').class_id) : null;
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    if (classId && visibleClassIds && !visibleClassIds.has(classId)) return apiError(c, 403, '无权查看该班级。');
    return c.json({ overview: await c.var.db.getOverview(visibleClassIds, classId) });
  })
  .get('/teacher/records', zValidator('query', recordQuerySchema, validationHook), async (c) => {
    const query = c.req.valid('query');
    const user = c.get('user')!;
    const filterError = validateRecordFilters(query as Record<string, unknown>);
    if (filterError) return apiError(c, 400, filterError);
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    return c.json({ records: await c.var.db.getAllRecords(parseRecordFilters(query as Record<string, unknown>), visibleStudentIds, query.sort ?? 'created_at_desc') });
  })
  .get('/teacher/records/:id', zValidator('param', recordIdParamSchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    const record = await c.var.db.getTeacherRecordById(id, visibleStudentIds);
    if (!record) return apiError(c, 404, '记录不存在。');
    return c.json({ record });
  })
  .get('/teacher/classes', async (c) => {
    const user = c.get('user')!;
    return c.json({ classes: user.role === 'admin' ? await c.var.db.getClasses() : await c.var.db.getTeacherClasses(user.id) });
  })
  .put('/teacher/records/:id/review', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', reviewRecordBodySchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    const record = await c.var.db.getTeacherRecordById(id, visibleStudentIds);
    if (!record) return apiError(c, 404, '记录不存在。');
    const task = record.task_id ? await c.var.db.getManageableTaskById(record.task_id, visibleClassIds) : null;
    const scoreError = validateReviewScore({ status: body.status, score: body.score, scoreEnabled: Boolean(task?.score_enabled) });
    if (scoreError) return apiError(c, 400, scoreError);
    const comment = normalizeOptionalString(body.comment);
    const commentError = validateComment(comment);
    if (commentError) return apiError(c, 400, commentError);
    const updated = await c.var.db.updateRecord(record.id, { status: body.status, teacher_comment: comment, score: body.status === 'approved' ? body.score ?? null : null });
    if (!updated) return apiError(c, 404, '记录不存在。');
    await c.var.db.createNotification(updated.student_id, body.status === 'pending' ? 'other' : body.status, buildReviewNotificationMessage(updated.title, body.status));
    return c.json({ message: '审核结果保存成功。' });
  })
  .post('/teacher/record-reviews/batch', zValidator('json', batchReviewBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    const visibleClassIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherClassIds(user.id));
    let count = 0;
    for (const id of body.ids) {
      const record = await c.var.db.getTeacherRecordById(id, visibleStudentIds);
      if (!record) continue;
      if (body.action === 'deleted') {
        await c.var.db.deleteRecord(record.id, record.image_paths);
        await c.var.db.createNotification(record.student_id, 'deleted', `你的实践记录 "${record.title}" 已被删除。`);
      } else {
        const task = record.task_id ? await c.var.db.getManageableTaskById(record.task_id, visibleClassIds) : null;
        if (body.action === 'approved' && task?.score_enabled) return apiError(c, 400, '启用打分的任务不能批量通过。');
        await c.var.db.updateRecord(record.id, { status: body.action, teacher_comment: null, score: null });
        await c.var.db.createNotification(record.student_id, body.action === 'pending' ? 'other' : body.action, buildReviewNotificationMessage(record.title, body.action));
      }
      count++;
    }
    return c.json({ message: `成功处理 ${count} 条记录。` });
  })
  .put('/teacher/records/:id', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', updateRecordBodySchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    const record = await c.var.db.getTeacherRecordById(id, visibleStudentIds);
    if (!record) return apiError(c, 404, '记录不存在。');
    const updates: UpdateRecordInput = {};
    if (body.title !== undefined) { const v = body.title.trim(); const e = validateTitle(v); if (e) return apiError(c, 400, e); updates.title = v; }
    if (body.content !== undefined) { const v = body.content.trim(); const e = validateContent(v); if (e) return apiError(c, 400, e); updates.content = v; }
    if (body.practice_date !== undefined) { const v = body.practice_date.trim(); const e = validatePracticeDate(v); if (e) return apiError(c, 400, e); updates.practice_date = v; }
    if (body.location !== undefined) { const v = normalizeOptionalString(body.location); const e = validateLocation(v); if (e) return apiError(c, 400, e); updates.location = v; }
    if (body.duration !== undefined) { const v = parseDuration(body.duration); const e = validateDuration(v); if (e) return apiError(c, 400, e); updates.duration = v; }
    if (body.image_paths !== undefined || body.cover_image_path !== undefined) {
      const imgs = Array.isArray(body.image_paths) ? body.image_paths : record.image_paths;
      const cover = body.cover_image_path !== undefined ? normalizeOptionalString(body.cover_image_path) : record.cover_image_path;
      const imageError = validateRecordImages(imgs, cover);
      if (imageError) return apiError(c, 400, imageError);
      updates.image_paths = imgs; updates.cover_image_path = cover ?? imgs[0] ?? null;
    }
    try { await c.var.db.updateRecord(record.id, updates); }
    catch (error) { return apiError(c, 400, error instanceof Error ? error.message : '图片处理失败。'); }
    return c.json({ message: '记录更新成功。' });
  })
  .delete('/teacher/records/:id', zValidator('param', recordIdParamSchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    const record = await c.var.db.getTeacherRecordById(id, visibleStudentIds);
    if (!record) return apiError(c, 404, '记录不存在。');
    await c.var.db.deleteRecord(record.id, record.image_paths);
    await c.var.db.createNotification(record.student_id, 'deleted', `你的实践记录 "${record.title}" 已被删除。`);
    return c.json({ message: '记录删除成功。' });
  })
  .get('/teacher/students', async (c) => {
    const user = c.get('user')!;
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    return c.json({ students: await c.var.db.searchStudents('', visibleStudentIds) });
  })
  .get('/teacher/students/search', zValidator('query', userSearchQuerySchema, validationHook), async (c) => {
    const user = c.get('user')!;
    const query = c.req.valid('query');
    const classIds = parseIdList(query.class_ids);
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    return c.json({ students: await c.var.db.searchStudents(query.q?.trim() ?? '', visibleStudentIds, classIds) });
  })
  .get('/teacher/students/:id/records', zValidator('param', recordIdParamSchema, validationHook), async (c) => {
    const studentId = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const canManage = user.role === 'admin' || (await c.var.db.getTeacherStudentIds(user.id)).includes(studentId);
    if (!canManage) return apiError(c, 403, '无权查看该学生。');
    return c.json({ records: await c.var.db.getRecordsByStudent(studentId) });
  })
  .put('/teacher/students/:id', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', updateUserBodySchema, validationHook), async (c) => {
    const studentId = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const student = await c.var.db.findUserById(studentId);
    if (!student || student.role !== 'student') return apiError(c, 404, '学生不存在。');
    const canManage = user.role === 'admin' || (await c.var.db.getTeacherStudentIds(user.id)).includes(studentId);
    if (!canManage) return apiError(c, 403, '无权管理该学生。');
    if (body.name !== undefined) {
      const e = validateName(body.name); if (e) return apiError(c, 400, e);
      const ee = validateEnglishName(body.english_name); if (ee) return apiError(c, 400, ee);
      await c.var.db.updateUserName(studentId, body.name.trim(), body.english_name?.trim() || null);
    } else if (body.english_name !== undefined) {
      const ee = validateEnglishName(body.english_name); if (ee) return apiError(c, 400, ee);
      await c.var.db.updateUserName(studentId, student.name, body.english_name?.trim() || null);
    }
    if (body.password !== undefined && body.password !== '') {
      let password: string;
      try { password = await decryptEnvelope(body.password, getCFConfig(c.env).jwt_secret); }
      catch (error) { if (error instanceof EnvelopeDecryptError) return apiError(c, 400, error.message); throw error; }
      const e = validatePassword(password); if (e) return apiError(c, 400, e);
      await c.var.db.updateUserPassword(studentId, await hashPassword(password));
    }
    if (body.class_id !== undefined) {
      const myClassIds = new Set(await c.var.db.getTeacherClassIds(user.id));
      if (user.role !== 'admin' && body.class_id && !myClassIds.has(body.class_id)) return apiError(c, 403, '无权分配到该班级。');
      await c.var.db.setStudentsClass([studentId], body.class_id);
    }
    return c.json({ message: '学生信息更新成功。' });
  })
  .patch('/teacher/students/class', zValidator('json', batchUpdateStudentClassBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const myStudentIds = user.role === 'admin' ? null : new Set(await c.var.db.getTeacherStudentIds(user.id));
    const ids = myStudentIds ? body.ids.filter((id: number) => myStudentIds.has(id)) : body.ids;
    if (!ids.length) return apiError(c, 400, '请选择至少一个可管理的学生。');
    const myClassIds = user.role === 'admin' ? null : new Set(await c.var.db.getTeacherClassIds(user.id));
    if (body.class_id && myClassIds && !myClassIds.has(body.class_id)) return apiError(c, 403, '无权分配到该班级。');
    for (const id of ids) { const s = await c.var.db.findUserById(id); if (!s || s.role !== 'student') return apiError(c, 400, '列表中存在无效学生。'); }
    await c.var.db.setStudentsClass(ids, body.class_id);
    return c.json({ message: '班级已更新。' });
  })
  .patch('/teacher/students/password-reset', zValidator('json', batchResetPasswordBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const myStudentIds = user.role === 'admin' ? null : new Set(await c.var.db.getTeacherStudentIds(user.id));
    const ids = myStudentIds ? body.ids.filter((id: number) => myStudentIds.has(id)) : body.ids;
    if (!ids.length) return apiError(c, 400, '请选择至少一个可管理的学生。');
    const users = await c.var.db.resetUserPasswords(ids);
    return c.json({ message: `成功重置 ${users.length} 个学生的密码。`, users, credentialsCsv: await createUserCredentialsCsv(users) });
  })
  .get('/teacher/statistics', async (c) => {
    const user = c.get('user')!;
    const visibleStudentIds = user.role === 'admin' ? undefined : new Set(await c.var.db.getTeacherStudentIds(user.id));
    return c.json({ statistics: await c.var.db.getStatistics(visibleStudentIds) });
  });
