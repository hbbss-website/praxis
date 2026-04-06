import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { hashPassword } from '../auth/password';
import database from '../database';
import {
  apiError,
  batchResetPasswordBodySchema,
  batchReviewBodySchema,
  buildReviewNotificationMessage,
  isValidUploadPath,
  normalizeOptionalString,
  normalizeRecordFilters,
  parseDuration,
  recordQuerySchema,
  requireRole,
  reviewRecordBodySchema,
  updateRecordBodySchema,
  updateUserBodySchema,
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

const recordIdParamSchema = z.object({
  id: z.string().regex(/^[1-9]\d*$/)
});

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

function parseRecordFilters(query: Record<string, unknown>): RecordFilters {
  return normalizeRecordFilters({
    student_id: typeof query.student_id === 'string' ? Number(query.student_id) : null,
    teacher_id: typeof query.teacher_id === 'string' ? Number(query.teacher_id) : null,
    status: typeof query.status === 'string' ? query.status as RecordFilters['status'] : null,
    practice_after: typeof query.practice_after === 'string' && query.practice_after ? query.practice_after : null,
    practice_before: typeof query.practice_before === 'string' && query.practice_before ? query.practice_before : null,
    created_after: typeof query.created_after === 'string' && query.created_after ? query.created_after : null,
    created_before: typeof query.created_before === 'string' && query.created_before ? query.created_before : null,
    updated_after: typeof query.updated_after === 'string' && query.updated_after ? query.updated_after : null,
    updated_before: typeof query.updated_before === 'string' && query.updated_before ? query.updated_before : null
  });
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
      teacher_comment: comment,
      updated_by_uid: user.uid
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
        database.deleteRecord(record.id);
        database.createNotification(record.student_id, 'deleted', `你的实践记录 "${record.title}" 已被删除。`);
      } else {
        database.updateRecord(record.id, {
          status: body.action,
          teacher_comment: null,
          updated_by_uid: user.uid
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

    const updates: UpdateRecordInput = {
      updated_by_uid: user.uid
    };

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

    if (body.image_path !== undefined) {
      const value = normalizeOptionalString(body.image_path);

      if (value && !isValidUploadPath(value)) {
        return apiError(c, 400, '图片路径无效。');
      }

      updates.image_path = value;
    }

    database.updateRecord(record.id, updates);
    return c.json({ message: '记录更新成功。' });
  })
  .delete('/teacher/records/:id', zValidator('param', recordIdParamSchema, validationHook), (c) => {
    const id = Number(c.req.valid('param').id);
    const user = c.get('user')!;
    const record = database.getTeacherRecordById(id, getVisibleStudentIds(user.id, user.role));

    if (!record) {
      return apiError(c, 404, '记录不存在。');
    }

    database.deleteRecord(record.id);
    database.createNotification(record.student_id, 'deleted', `你的实践记录 "${record.title}" 已被删除。`);
    return c.json({ message: '记录删除成功。' });
  })
  .get('/teacher/students', (c) => {
    const user = c.get('user')!;

    return c.json({
      students: user.role === 'admin'
        ? database.getAllStudents()
        : database.getTeacherStudents(user.id)
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

    return c.json({ message: '学生信息更新成功。' });
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
      users
    });
  })
  .get('/teacher/statistics', (c) => {
    const user = c.get('user')!;
    return c.json({
      statistics: database.getStatistics(getVisibleStudentIds(user.id, user.role))
    });
  });
