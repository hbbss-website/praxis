import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { hashPassword } from '../auth/password';
import { decryptEnvelope, EnvelopeDecryptError } from '../auth/password-key-manager';
import { createUserCredentialsCsv } from '../csv/user-import';
import { formatCsv } from '../csv/export';
import database from '../database';
import {
  apiError,
  batchResetPasswordBodySchema,
  batchUpdateStudentClassBodySchema,
  batchReviewBodySchema,
  buildReviewNotificationMessage,
  classIdsBodySchema,
  createTaskBodySchema,
  isValidRecordImagePath,
  isValidUploadPath,
  normalizeOptionalString,
  normalizeRecordFilters,
  parseDateTimeInput,
  parseDuration,
  recordQuerySchema,
  requireRole,
  reviewRecordBodySchema,
  updateTaskBodySchema,
  updateRecordBodySchema,
  updateUserBodySchema,
  userSearchQuerySchema,
  validateComment,
  validateContent,
  validateDuration,
  validateEnglishName,
  validateLocation,
  validateName,
  validatePassword,
  validatePracticeDate,
  validateRecordFilters,
  validateTitle,
  validateTaskDescription,
  validateTaskTitle,
  validationHook
} from '../http';
import { authMiddleware, type AppBindings } from '../plugins/auth';
import type { RecordFilters, UpdateRecordInput, UserRole } from '../models';
import { MAX_RECORD_IMAGES } from '../models';
import { startOfTodayIso } from '../time';

const recordIdParamSchema = z.object({
  id: z.string().regex(/^[1-9]\d*$/)
});

function parseIdList(value?: string) {
  if (!value) {
    return undefined;
  }

  return value.split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

function getVisibleStudentIds(userId: number, role: UserRole) {
  if (role === 'admin') {
    return undefined;
  }

  return new Set(database.getTeacherStudentIds(userId));
}

function getVisibleClassIds(userId: number, role: UserRole) {
  if (role === 'admin') {
    return undefined;
  }

  return new Set(database.getTeacherClassIds(userId));
}

function canManageStudent(studentId: number, userId: number, role: UserRole) {
  if (role === 'admin') {
    return true;
  }

  return database.getTeacherStudentIds(userId).includes(studentId);
}

function canManageClass(classId: number | null, userId: number, role: UserRole) {
  if (!classId) {
    return role === 'admin';
  }

  if (role === 'admin') {
    return true;
  }

  return database.getTeacherClassIds(userId).includes(classId);
}

function canManageClasses(classIds: number[], userId: number, role: UserRole) {
  if (classIds.length === 0) {
    return false;
  }

  if (role === 'admin') {
    return classIds.every((classId) => Boolean(database.findClassById(classId)));
  }

  const visibleClassIds = new Set(database.getTeacherClassIds(userId));
  return classIds.every((classId) => visibleClassIds.has(classId));
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
    created_after: typeof query.created_after === 'string' && query.created_after ? query.created_after : null,
    created_before: typeof query.created_before === 'string' && query.created_before ? query.created_before : null
  });
}

function buildTaskPayload(body: {
  title?: string;
  description?: string | null;
  start_at?: string;
  end_at?: string;
  min_words?: number;
  min_images?: number;
  max_records_per_student?: number;
  score_enabled?: boolean;
  class_ids?: number[];
}) {
  const title = body.title?.trim();
  const description = body.description === undefined ? undefined : normalizeOptionalString(body.description);
  const startAt = body.start_at === undefined ? undefined : parseDateTimeInput(body.start_at);
  const endAt = body.end_at === undefined ? undefined : parseDateTimeInput(body.end_at);

  return {
    title,
    description,
    start_at: startAt,
    end_at: endAt,
    min_words: body.min_words,
    min_images: body.min_images,
    max_records_per_student: body.max_records_per_student,
    score_enabled: body.score_enabled,
    class_ids: body.class_ids
  };
}

function validateTaskPayload(payload: ReturnType<typeof buildTaskPayload>, current?: { start_at: string; end_at: string }) {
  if (payload.title !== undefined) {
    const error = validateTaskTitle(payload.title);
    if (error) return error;
  }

  if (payload.description !== undefined) {
    const error = validateTaskDescription(payload.description);
    if (error) return error;
  }

  const startAt = payload.start_at ?? current?.start_at;
  const endAt = payload.end_at ?? current?.end_at;

  if (!startAt) {
    return '开始时间无效。';
  }

  if (!endAt) {
    return '截止时间无效。';
  }

  if (startAt > endAt) {
    return '开始时间不能晚于截止时间。';
  }

  if (payload.end_at !== undefined && endAt < startOfTodayIso()) {
    return '截止时间不能早于今天。';
  }

  return null;
}

function validateRecordImages(imagePaths: string[], coverImagePath: string | null) {
  if (imagePaths.length > MAX_RECORD_IMAGES) {
    return `每条记录最多上传 ${MAX_RECORD_IMAGES} 张图片。`;
  }

  if (new Set(imagePaths).size !== imagePaths.length) {
    return '图片不能重复。';
  }

  if (imagePaths.some((imagePath) => !isValidRecordImagePath(imagePath) && !isValidUploadPath(imagePath))) {
    return '图片路径无效。';
  }

  if (coverImagePath && !imagePaths.includes(coverImagePath)) {
    return '封面图必须从已上传图片中选择。';
  }

  return null;
}

function validateReviewScore({
  status,
  score,
  scoreEnabled
}: {
  status: 'approved' | 'pending' | 'rejected';
  score: number | undefined;
  scoreEnabled: boolean;
}) {
  if (!scoreEnabled) {
    return score === undefined ? null : '该任务未启用打分。';
  }

  if (status !== 'approved') {
    return null;
  }

  if (score === undefined || !Number.isInteger(score) || score < 0 || score > 100) {
    return '分数必须是 0 到 100 的整数。';
  }

  return null;
}

export const teacherRoutes = new Hono<AppBindings>()
  .use('/teacher/*', authMiddleware)
  .use('/teacher/*', async (c, next) => {
    const authFailure = requireRole(c, ['teacher', 'admin']);

    if (authFailure) {
      return authFailure;
    }

    await next();
  })
  .get('/teacher/tasks', (c) => {
    const user = c.get('user')!;

    return c.json({
      tasks: database.getManageableTasks(getVisibleClassIds(user.id, user.role))
    });
  })
  .post('/teacher/tasks', zValidator('json', createTaskBodySchema, validationHook), (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const payload = buildTaskPayload(body);
    const error = validateTaskPayload(payload);

    if (error) {
      return apiError(c, 400, error);
    }

    if (!canManageClasses(body.class_ids, user.id, user.role)) {
      return apiError(c, 403, '无权选择部分班级。');
    }

    const task = database.createTask({
      title: payload.title!,
      description: payload.description ?? null,
      start_at: payload.start_at!,
      end_at: payload.end_at!,
      min_words: body.min_words,
      min_images: body.min_images,
      max_records_per_student: body.max_records_per_student,
      score_enabled: body.score_enabled,
      class_ids: body.class_ids,
      created_by_id: user.id
    });

    return c.json({
      message: '任务创建成功。',
      task
    });
  })
  .get('/teacher/tasks/:id', zValidator('param', recordIdParamSchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const task = database.getManageableTaskById(id, getVisibleClassIds(user.id, user.role));

    if (!task) {
      return apiError(c, 404, '任务不存在。');
    }

    return c.json({ task });
  })
  .put('/teacher/tasks/:id', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', updateTaskBodySchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const task = database.getManageableTaskById(id, getVisibleClassIds(user.id, user.role));

    if (!task) {
      return apiError(c, 404, '任务不存在。');
    }

    if (body.class_ids && !canManageClasses(body.class_ids, user.id, user.role)) {
      return apiError(c, 403, '无权选择部分班级。');
    }

    const payload = buildTaskPayload(body);
    const error = validateTaskPayload(payload, task);

    if (error) {
      return apiError(c, 400, error);
    }

    const updated = database.updateTask(id, {
      ...(payload.title === undefined ? {} : { title: payload.title }),
      ...(payload.description === undefined ? {} : { description: payload.description }),
      ...(payload.start_at === undefined || payload.start_at === null ? {} : { start_at: payload.start_at }),
      ...(payload.end_at === undefined || payload.end_at === null ? {} : { end_at: payload.end_at }),
      ...(payload.min_words === undefined ? {} : { min_words: payload.min_words }),
      ...(payload.min_images === undefined ? {} : { min_images: payload.min_images }),
      ...(payload.max_records_per_student === undefined ? {} : { max_records_per_student: payload.max_records_per_student }),
      ...(payload.class_ids === undefined ? {} : { class_ids: payload.class_ids })
    });

    return c.json({
      message: '任务更新成功。',
      task: updated
    });
  })
  .delete('/teacher/tasks/:id', zValidator('param', recordIdParamSchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const task = database.getManageableTaskById(id, getVisibleClassIds(user.id, user.role));

    if (!task) {
      return apiError(c, 404, '任务不存在。');
    }

    if (user.role !== 'admin') {
      const visibleClassIds = new Set(database.getTeacherClassIds(user.id));
      if (!task.classes.every((item) => visibleClassIds.has(item.id))) {
        return apiError(c, 403, '只能删除完全属于自己管理范围的任务。');
      }
    }

    database.deleteTask(id);
    return c.json({ message: '任务已删除。' });
  })
  .get('/teacher/tasks/:id/classes/:classId/record-count', zValidator('param', z.object({
    id: z.string().regex(/^[1-9]\d*$/),
    classId: z.string().regex(/^[1-9]\d*$/)
  }), validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const classId = Number(c.req.valid('param').classId);
    const user = c.get('user')!;
    const task = database.getManageableTaskById(id, getVisibleClassIds(user.id, user.role));

    if (!task || !task.classes.some((item) => item.id === classId)) {
      return apiError(c, 404, '任务班级不存在。');
    }

    if (!canManageClass(classId, user.id, user.role)) {
      return apiError(c, 403, '无权管理该班级。');
    }

    return c.json({
      count: database.countTaskClassRecords(id, classId)
    });
  })
  .delete('/teacher/tasks/:id/classes/:classId', zValidator('param', z.object({
    id: z.string().regex(/^[1-9]\d*$/),
    classId: z.string().regex(/^[1-9]\d*$/)
  }), validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const classId = Number(c.req.valid('param').classId);
    const user = c.get('user')!;
    const task = database.getManageableTaskById(id, getVisibleClassIds(user.id, user.role));

    if (!task || !task.classes.some((item) => item.id === classId)) {
      return apiError(c, 404, '任务班级不存在。');
    }

    if (!canManageClass(classId, user.id, user.role)) {
      return apiError(c, 403, '无权管理该班级。');
    }

    const deletedCount = database.removeTaskClass(id, classId);
    return c.json({
      message: '班级已从任务中移除。',
      deletedCount
    });
  })
  .post('/teacher/tasks/:id/export', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', classIdsBodySchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const task = database.getManageableTaskById(id, getVisibleClassIds(user.id, user.role));

    if (!task) {
      return apiError(c, 404, '任务不存在。');
    }

    if (!canManageClasses(body.class_ids, user.id, user.role)) {
      return apiError(c, 403, '无权导出部分班级。');
    }

    const visibleStudentIds = getVisibleStudentIds(user.id, user.role);
    const records = database.getRecordsForExport({ task_id: id, class_ids: body.class_ids }, visibleStudentIds);
    const csv = formatCsv([
      ['任务名称', '班级', '学生姓名', '学生 UID', '记录标题', '实践日期', '时长', '地点', '状态', '分数', '教师评语', '提交时间', '正文', '图片数量'],
      ...records.map((record) => [
        task.title,
        record.class_label,
        record.student_name,
        record.student_uid,
        record.title,
        record.practice_date,
        record.duration,
        record.location,
        record.status,
        record.score ?? '',
        record.teacher_comment,
        record.created_at,
        record.content,
        record.image_count
      ])
    ]);

    return c.text(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="task-${id}-records.csv"`
    });
  })
  .get('/teacher/overview', zValidator('query', z.object({ class_id: z.string().regex(/^[1-9]\d*$/).optional() }), (result, c) => {
    if (!result.success) return apiError(c, 400, '请求参数无效。');
  }), (c) => {
    const user = c.get('user')!;
    const classId = c.req.valid('query').class_id ? Number(c.req.valid('query').class_id) : null;

    if (classId && !canManageClass(classId, user.id, user.role)) {
      return apiError(c, 403, '无权查看该班级。');
    }

    return c.json({
      overview: database.getOverview(getVisibleClassIds(user.id, user.role), classId)
    });
  })
  .get('/teacher/records', zValidator('query', recordQuerySchema, validationHook), (c) => {
    const query = c.req.valid('query');
    const user = c.get('user')!;
    const filterError = validateRecordFilters(query as Record<string, unknown>);

    if (filterError) {
      return apiError(c, 400, filterError);
    }

    return c.json({
      records: database.getAllRecords(
        parseRecordFilters(query as Record<string, unknown>),
        getVisibleStudentIds(user.id, user.role),
        query.sort ?? 'created_at_desc'
      )
    });
  })
  .get('/teacher/records/:id', zValidator('param', recordIdParamSchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const record = database.getTeacherRecordById(id, getVisibleStudentIds(user.id, user.role));

    if (!record) {
      return apiError(c, 404, '记录不存在。');
    }

    return c.json({ record });
  })
  .get('/teacher/classes', (c) => {
    const user = c.get('user')!;

    return c.json({
      classes: user.role === 'admin' ? database.getClasses() : database.getTeacherClasses(user.id)
    });
  })
  .put('/teacher/records/:id/review', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', reviewRecordBodySchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const record = database.getTeacherRecordById(id, getVisibleStudentIds(user.id, user.role));
    const task = record?.task_id ? database.getManageableTaskById(record.task_id, getVisibleClassIds(user.id, user.role)) : null;

    if (!record) {
      return apiError(c, 404, '记录不存在。');
    }

    const scoreError = validateReviewScore({ status: body.status, score: body.score, scoreEnabled: Boolean(task?.score_enabled) });

    if (scoreError) {
      return apiError(c, 400, scoreError);
    }

    const comment = normalizeOptionalString(body.comment);
    const commentError = validateComment(comment);

    if (commentError) {
      return apiError(c, 400, commentError);
    }

    const updated = database.updateRecord(record.id, {
      status: body.status,
      teacher_comment: comment,
      score: body.status === 'approved' ? body.score ?? null : null
    });

    if (!updated) {
      return apiError(c, 404, '记录不存在。');
    }

    database.createNotification(
      updated.student_id,
      body.status === 'pending' ? 'other' : body.status,
      buildReviewNotificationMessage(updated.title, body.status)
    );

    return c.json({ message: '审核结果保存成功。' });
  })
  .post('/teacher/record-reviews/batch', zValidator('json', batchReviewBodySchema, validationHook), (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const visibleStudentIds = getVisibleStudentIds(user.id, user.role);
    let successCount = 0;

    for (const id of body.ids) {
      const record = database.getTeacherRecordById(id, visibleStudentIds);

      if (!record) {
        continue;
      }

      if (body.action === 'deleted') {
        database.deleteRecord(record.id, record.image_paths);
        database.createNotification(record.student_id, 'deleted', `你的实践记录 "${record.title}" 已被删除。`);
      } else {
        const task = record.task_id ? database.getManageableTaskById(record.task_id, getVisibleClassIds(user.id, user.role)) : null;

        if (body.action === 'approved' && task?.score_enabled) {
          return apiError(c, 400, '启用打分的任务不能批量通过。');
        }

        database.updateRecord(record.id, {
          status: body.action,
          teacher_comment: null,
          score: null
        });
        database.createNotification(
          record.student_id,
          body.action === 'pending' ? 'other' : body.action,
          buildReviewNotificationMessage(record.title, body.action)
        );
      }

      successCount += 1;
    }

    return c.json({ message: `成功处理 ${successCount} 条记录。` });
  })
  .put('/teacher/records/:id', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', updateRecordBodySchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const record = database.getTeacherRecordById(id, getVisibleStudentIds(user.id, user.role));

    if (!record) {
      return apiError(c, 404, '记录不存在。');
    }

    const updates: UpdateRecordInput = {};

    if (body.title !== undefined) {
      const value = body.title.trim();
      const error = validateTitle(value);
      if (error) return apiError(c, 400, error);
      updates.title = value;
    }

    if (body.content !== undefined) {
      const value = body.content.trim();
      const error = validateContent(value);
      if (error) return apiError(c, 400, error);
      updates.content = value;
    }

    if (body.practice_date !== undefined) {
      const value = body.practice_date.trim();
      const error = validatePracticeDate(value);
      if (error) return apiError(c, 400, error);
      updates.practice_date = value;
    }

    if (body.location !== undefined) {
      const value = normalizeOptionalString(body.location);
      const error = validateLocation(value);
      if (error) return apiError(c, 400, error);
      updates.location = value;
    }

    if (body.duration !== undefined) {
      const value = parseDuration(body.duration);
      const error = validateDuration(value);
      if (error) return apiError(c, 400, error);
      updates.duration = value;
    }

    if (body.image_paths !== undefined || body.cover_image_path !== undefined) {
      const imagePaths = Array.isArray(body.image_paths) ? body.image_paths : record.image_paths;
      const coverImagePath = body.cover_image_path !== undefined ? normalizeOptionalString(body.cover_image_path) : record.cover_image_path;
      const imageError = validateRecordImages(imagePaths, coverImagePath);
      if (imageError) return apiError(c, 400, imageError);

      updates.image_paths = imagePaths;
      updates.cover_image_path = coverImagePath ?? imagePaths[0] ?? null;
    }

    try {
      database.updateRecord(record.id, updates);
    } catch (error) {
      return apiError(c, 400, error instanceof Error ? error.message : '图片处理失败。');
    }

    return c.json({ message: '记录更新成功。' });
  })
  .delete('/teacher/records/:id', zValidator('param', recordIdParamSchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const record = database.getTeacherRecordById(id, getVisibleStudentIds(user.id, user.role));

    if (!record) {
      return apiError(c, 404, '记录不存在。');
    }

    database.deleteRecord(record.id, record.image_paths);
    database.createNotification(record.student_id, 'deleted', `你的实践记录 "${record.title}" 已被删除。`);
    return c.json({ message: '记录删除成功。' });
  })
  .get('/teacher/students', (c) => {
    const user = c.get('user')!;

    return c.json({
      students: user.role === 'admin'
        ? database.searchStudents('')
        : database.searchStudents('', getVisibleStudentIds(user.id, user.role))
    });
  })
  .get('/teacher/students/search', zValidator('query', userSearchQuerySchema, validationHook), (c) => {
    const user = c.get('user')!;
    const query = c.req.valid('query');
    const classIds = parseIdList(query.class_ids);

    return c.json({
      students: database.searchStudents(query.q?.trim() ?? '', getVisibleStudentIds(user.id, user.role), classIds)
    });
  })
  .get('/teacher/students/:id/records', zValidator('param', recordIdParamSchema, validationHook), (c) => {
    const studentId = Number(c.req.valid('param').id);
    const user = c.get('user')!;

    if (!canManageStudent(studentId, user.id, user.role)) {
      return apiError(c, 403, '无权查看该学生。');
    }

    return c.json({
      records: database.getRecordsByStudent(studentId)
    });
  })
  .put('/teacher/students/:id', zValidator('param', recordIdParamSchema, validationHook), zValidator('json', updateUserBodySchema, validationHook), async (c) => {
    const studentId = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const student = database.findUserById(studentId);

    if (!student || student.role !== 'student') {
      return apiError(c, 404, '学生不存在。');
    }

    if (!canManageStudent(studentId, user.id, user.role)) {
      return apiError(c, 403, '无权管理该学生。');
    }

    if (body.name !== undefined) {
      const error = validateName(body.name);
      if (error) return apiError(c, 400, error);
      const englishNameError = validateEnglishName(body.english_name);
      if (englishNameError) return apiError(c, 400, englishNameError);
      database.updateUserName(studentId, body.name.trim(), body.english_name?.trim() || null);
    } else if (body.english_name !== undefined) {
      const englishNameError = validateEnglishName(body.english_name);
      if (englishNameError) return apiError(c, 400, englishNameError);
      database.updateUserName(studentId, student.name, body.english_name?.trim() || null);
    }

    if (body.password !== undefined && body.password !== '') {
      let password: string;

      try {
        password = decryptEnvelope(body.password);
      } catch (error) {
        if (error instanceof EnvelopeDecryptError) {
          return apiError(c, 400, error.message);
        }

        throw error;
      }

      const error = validatePassword(password);
      if (error) return apiError(c, 400, error);
      database.updateUserPassword(studentId, await hashPassword(password));
    }

    if (body.class_id !== undefined) {
      if (!canManageClass(body.class_id, user.id, user.role)) {
        return apiError(c, 403, '无权分配到该班级。');
      }

      database.setStudentsClass([studentId], body.class_id);
    }

    return c.json({ message: '学生信息更新成功。' });
  })
  .patch('/teacher/students/class', zValidator('json', batchUpdateStudentClassBodySchema, validationHook), (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const ids = user.role === 'admin'
      ? body.ids
      : body.ids.filter((id: number) => canManageStudent(id, user.id, user.role));

    if (ids.length === 0) {
      return apiError(c, 400, '请选择至少一个可管理的学生。');
    }

    if (!canManageClass(body.class_id, user.id, user.role)) {
      return apiError(c, 403, '无权分配到该班级。');
    }

    const invalidStudentIds = ids.filter((id: number) => {
      const student = database.findUserById(id);
      return !student || student.role !== 'student';
    });

    if (invalidStudentIds.length > 0) {
      return apiError(c, 400, '列表中存在无效学生。');
    }

    database.setStudentsClass(ids, body.class_id);
    return c.json({ message: '班级已更新。' });
  })
  .patch('/teacher/students/password-reset', zValidator('json', batchResetPasswordBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const ids = user.role === 'admin'
      ? body.ids
      : body.ids.filter((id: number) => canManageStudent(id, user.id, user.role));

    if (ids.length === 0) {
      return apiError(c, 400, '请选择至少一个可管理的学生。');
    }

    const users = await database.resetUserPasswords(ids);

    return c.json({
      message: `成功重置 ${users.length} 个学生的密码。`,
      users,
      credentialsCsv: await createUserCredentialsCsv(users)
    });
  })
  .get('/teacher/statistics', (c) => {
    const user = c.get('user')!;
    return c.json({
      statistics: database.getStatistics(getVisibleStudentIds(user.id, user.role))
    });
  });
