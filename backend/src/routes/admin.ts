import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { hashPassword } from '../auth/password';
import { parseUserImportCsvBuffer, type CsvUserImportEntry } from '../csv/user-import';
import database from '../database';
import {
  apiError,
  batchDeleteUsersBodySchema,
  batchResetPasswordBodySchema,
  requireRole,
  roleQuerySchema,
  updateUserBodySchema,
  userRoleSchema,
  validateName,
  validatePassword,
  validationHook
} from '../http';
import { authMiddleware, type AppBindings } from '../plugins/auth';

const createUserBodySchema = z.object({
  name: z.string(),
  role: userRoleSchema,
  teacher_uid: z.string().optional()
});

const batchCreateUsersBodySchema = z.object({
  entries: z.array(createUserBodySchema).min(1)
});

const teacherStudentsBodySchema = z.object({
  student_ids: z.array(z.number().int().positive()).min(1)
});

const teacherIdParamSchema = z.object({
  teacherId: z.string().regex(/^[1-9]\d*$/)
});

function resolveTeacherId(role: 'admin' | 'teacher' | 'student', teacherUid: string) {
  if (!teacherUid) {
    return null;
  }

  if (role !== 'student') {
    throw new Error('非学生不能分配管理老师。');
  }

  const teacher = database.findUserByUid(teacherUid);

  if (!teacher || teacher.role !== 'teacher') {
    throw new Error(`指定的教师 UID ${teacherUid} 无效或不存在。`);
  }

  return teacher.id;
}

function buildTeacherIdMap(teacherUids: string[]) {
  return new Map(
    database.findTeachersByUids([...new Set(teacherUids.filter(Boolean))]).map((teacher) => [teacher.uid, teacher.id])
  );
}

async function readImportFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new Error('请上传 .csv 文件。');
  }

  return parseUserImportCsvBuffer(new Uint8Array(await file.arrayBuffer()), { columnCount: 3 });
}

function validateImportEntries(entries: CsvUserImportEntry[]) {
  const teacherIdMap = buildTeacherIdMap(entries.map((entry) => entry.teacher_uid.trim()));

  return entries.map((entry) => {
    const nameError = validateName(entry.name);

    if (nameError) {
      throw new Error(`第 ${entry.lineNumber} 行错误：${nameError}`);
    }

    const teacherUid = entry.teacher_uid.trim();
    let teacherId: number | null = null;

    if (teacherUid) {
      if (entry.role !== 'student') {
        throw new Error(`第 ${entry.lineNumber} 行错误：非学生不能分配管理老师。`);
      }

      const matchedTeacherId = teacherIdMap.get(teacherUid);

      if (!matchedTeacherId) {
        throw new Error(`第 ${entry.lineNumber} 行错误：指定的教师 UID ${teacherUid} 无效或不存在。`);
      }

      teacherId = matchedTeacherId;
    }

    return {
      lineNumber: entry.lineNumber,
      name: entry.name.trim(),
      role: entry.role,
      teacher_uid: teacherUid,
      teacherId
    };
  });
}

async function parseCsvBody(c: Context<AppBindings>) {
  const formData = await c.req.raw.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return null;
  }

  return file;
}

export const adminRoutes = new Hono<AppBindings>()
  .use('*', authMiddleware)
  .use('*', async (c, next) => {
    const authFailure = requireRole(c, ['admin']);

    if (authFailure) {
      return authFailure;
    }

    await next();
  })
  .post('/users', zValidator('json', createUserBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const nameError = validateName(body.name);

    if (nameError) {
      return apiError(c, 400, nameError);
    }

    try {
      const teacherId = resolveTeacherId(body.role, body.teacher_uid?.trim() ?? '');
      const user = await database.createUser(body.name.trim(), body.role);

      if (teacherId && user.role === 'student') {
        database.assignStudentsToTeacher(teacherId, [user.id]);
      }

      return c.json({
        message: '用户创建成功。',
        user
      });
    } catch (error) {
      return apiError(c, 400, error instanceof Error ? error.message : '教师信息无效。');
    }
  })
  .post('/users/batch', zValidator('json', batchCreateUsersBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const normalized: Array<{ name: string; role: 'admin' | 'teacher' | 'student'; teacherId: number | null }> = [];
    const teacherIdMap = buildTeacherIdMap(body.entries.map((entry) => entry.teacher_uid?.trim() ?? ''));

    for (let index = 0; index < body.entries.length; index += 1) {
      const entry = body.entries[index]!;
      const nameError = validateName(entry.name);

      if (nameError) {
        return apiError(c, 400, `第 ${index + 1} 行错误：${nameError}`);
      }

      try {
        const teacherUid = entry.teacher_uid?.trim() ?? '';
        let teacherId: number | null = null;

        if (teacherUid) {
          if (entry.role !== 'student') {
            throw new Error('非学生不能分配管理老师。');
          }

          teacherId = teacherIdMap.get(teacherUid) ?? null;

          if (!teacherId) {
            throw new Error(`指定的教师 UID ${teacherUid} 无效或不存在。`);
          }
        }

        normalized.push({
          name: entry.name.trim(),
          role: entry.role,
          teacherId
        });
      } catch (error) {
        return apiError(c, 400, `第 ${index + 1} 行错误：${error instanceof Error ? error.message : '教师信息无效。'}`);
      }
    }

    const users = await database.createUsers(normalized);

    return c.json({
      message: `成功创建 ${users.length} 个用户。`,
      users
    });
  })
  .post('/users/import/preview', async (c) => {
    try {
      const file = await parseCsvBody(c);

      if (!file) {
        return apiError(c, 400, '缺少 CSV 文件。');
      }

      const parsed = await readImportFile(file);
      const entries = validateImportEntries(parsed.entries);

      return c.json({
        message: `成功识别 ${parsed.totalCount} 条导入记录。`,
        encoding: parsed.encoding,
        totalCount: parsed.totalCount,
        studentCount: parsed.studentCount,
        entries: entries.map(({ teacherId: _teacherId, ...entry }) => entry)
      });
    } catch (error) {
      return apiError(c, 400, error instanceof Error ? error.message : 'CSV 文件无效。');
    }
  })
  .post('/users/import', async (c) => {
    try {
      const file = await parseCsvBody(c);

      if (!file) {
        return apiError(c, 400, '缺少 CSV 文件。');
      }

      const parsed = await readImportFile(file);
      const entries = validateImportEntries(parsed.entries);
      const users = await database.createUsers(entries);

      return c.json({
        message: `成功导入 ${users.length} 个用户。`,
        encoding: parsed.encoding,
        users
      });
    } catch (error) {
      return apiError(c, 400, error instanceof Error ? error.message : 'CSV 导入失败。');
    }
  })
  .get('/users', zValidator('query', roleQuerySchema, validationHook), (c) => {
    const query = c.req.valid('query');
    return c.json({
      users: database.getUsersByRole(query.role)
    });
  })
  .put('/users/:id', zValidator('param', z.object({ id: z.string().regex(/^[1-9]\d*$/) }), validationHook), zValidator('json', updateUserBodySchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = database.findUserById(id);

    if (!user) {
      return apiError(c, 404, '用户不存在。');
    }

    if (body.name !== undefined) {
      const error = validateName(body.name);

      if (error) {
        return apiError(c, 400, error);
      }

      database.updateUserName(user.id, body.name.trim());
    }

    if (body.password !== undefined && body.password !== '') {
      const error = validatePassword(body.password);

      if (error) {
        return apiError(c, 400, error);
      }

      database.updateUserPassword(user.id, await hashPassword(body.password));
    }

    return c.json({ message: '用户信息更新成功。' });
  })
  .patch('/users/password-reset', zValidator('json', batchResetPasswordBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const users = await database.resetUserPasswords(body.ids);

    return c.json({
      message: `成功重置 ${users.length} 个用户的密码。`,
      users
    });
  })
  .delete('/users', zValidator('json', batchDeleteUsersBodySchema, validationHook), (c) => {
    const body = c.req.valid('json');
    const currentUser = c.get('user')!;

    if (body.ids.includes(currentUser.id)) {
      return apiError(c, 400, '不能删除自己的账号。');
    }

    let successCount = 0;

    for (const id of body.ids) {
      if (database.deleteUser(id)) {
        successCount += 1;
      }
    }

    return c.json({ message: `成功删除 ${successCount} 个用户。` });
  })
  .delete('/users/:id', zValidator('param', z.object({ id: z.string().regex(/^[1-9]\d*$/) }), validationHook), (c) => {
    const id = Number(c.req.valid('param').id);

    if (id === c.get('user')!.id) {
      return apiError(c, 400, '不能删除自己的账号。');
    }

    if (!database.deleteUser(id)) {
      return apiError(c, 404, '用户不存在。');
    }

    return c.json({ message: '用户删除成功。' });
  })
  .get('/teacher-student-assignments', (c) => {
    return c.json({
      assignments: database.getAllAssignments(),
      teachers: database.getUsersByRole('teacher'),
      students: database.getAllStudents()
    });
  })
  .put('/teachers/:teacherId/students', zValidator('param', teacherIdParamSchema, validationHook), zValidator('json', teacherStudentsBodySchema, validationHook), (c) => {
    const teacherId = Number(c.req.valid('param').teacherId);
    const body = c.req.valid('json');
    const teacher = database.findUserById(teacherId);

    if (!teacher || teacher.role !== 'teacher') {
      return apiError(c, 404, '教师不存在。');
    }

    const invalidStudentIds = body.student_ids.filter((id: number) => {
      const student = database.findUserById(id);
      return !student || student.role !== 'student';
    });

    if (invalidStudentIds.length > 0) {
      return apiError(c, 400, '分配列表中存在无效学生。');
    }

    database.assignStudentsToTeacher(teacherId, body.student_ids);
    return c.json({ message: '分配关系更新成功。' });
  })
  .delete('/teachers/:teacherId/students', zValidator('param', teacherIdParamSchema, validationHook), zValidator('json', teacherStudentsBodySchema, validationHook), (c) => {
    const teacherId = Number(c.req.valid('param').teacherId);
    const body = c.req.valid('json');
    const teacher = database.findUserById(teacherId);

    if (!teacher || teacher.role !== 'teacher') {
      return apiError(c, 404, '教师不存在。');
    }

    const invalidStudentIds = body.student_ids.filter((id: number) => {
      const student = database.findUserById(id);
      return !student || student.role !== 'student';
    });

    if (invalidStudentIds.length > 0) {
      return apiError(c, 400, '分配列表中存在无效学生。');
    }

    database.removeStudentsFromTeacher(teacherId, body.student_ids);
    return c.json({ message: '分配关系更新成功。' });
  });
