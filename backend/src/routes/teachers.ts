import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { hashPassword } from '../auth/password';
import { createUserCredentialsCsv } from '../csv/user-import';
import database from '../database';
import {
  apiError,
  batchResetPasswordBodySchema,
  batchUpdateStudentClassBodySchema,
  batchReviewBodySchema,
  buildReviewNotificationMessage,
  isValidRecordImagePath,
  isValidUploadPath,
  normalizeOptionalString,
  normalizeRecordFilters,
  parseDuration,
  recordQuerySchema,
  requireRole,
  reviewRecordBodySchema,
  updateRecordBodySchema,
  updateUserBodySchema,
  userSearchQuerySchema,
  validateComment,
  validateContent,
  validateDuration,
  validateLocation,
  validateName,
  validatePassword,
  validatePracticeDate,
  validateRecordFilters,
  validateTitle,
  validationHook
} from '../http';
import { authMiddleware, type AppBindings } from '../plugins/auth';
import type { RecordFilters, UpdateRecordInput, UserRole } from '../models';
import { MAX_RECORD_IMAGES } from '../models';

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

function parseRecordFilters(query: Record<string, unknown>): RecordFilters {
  return normalizeRecordFilters({
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

export const teacherRoutes = new Hono<AppBindings>()
  .use('/teacher/*', authMiddleware)
  .use('/teacher/*', async (c, next) => {
    const authFailure = requireRole(c, ['teacher', 'admin']);

    if (authFailure) {
      return authFailure;
    }

    await next();
  })
  .get('/teacher/records', zValidator('query', recordQuerySchema, validationHook), (c) => {
    const query = c.req.valid('query');
    const user = c.get('user')!;
    const filterError = validateRecordFilters(query as Record<string, unknown>);

    if (filterError) {
      return apiError(c, 400, filterError);
    }

    return c.json({
      records: database.getAllRecords(parseRecordFilters(query as Record<string, unknown>), getVisibleStudentIds(user.id, user.role))
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

    if (!record) {
      return apiError(c, 404, '记录不存在。');
    }

    const comment = normalizeOptionalString(body.comment);
    const commentError = validateComment(comment);

    if (commentError) {
      return apiError(c, 400, commentError);
    }

    const updated = database.updateRecord(record.id, {
      status: body.status,
      teacher_comment: comment
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
        database.updateRecord(record.id, {
          status: body.action,
          teacher_comment: null
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
      database.updateUserName(studentId, body.name.trim());
    }

    if (body.password !== undefined && body.password !== '') {
      const error = validatePassword(body.password);
      if (error) return apiError(c, 400, error);
      database.updateUserPassword(studentId, await hashPassword(body.password));
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
