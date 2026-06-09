import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { hashPassword } from '../auth/password';
import { decryptEnvelope } from '../auth/password-key-manager';
import { createUserCredentialsCsv, parseUserImportCsvBuffer, type CsvUserImportEntry } from '../csv/user-import';
import database from '../database';
import {
  apiError,
  batchDeleteUsersBodySchema,
  batchResetPasswordBodySchema,
  batchUpdateStudentClassBodySchema,
  requireRole,
  roleQuerySchema,
  updateUserBodySchema,
  userSearchQuerySchema,
  userRoleSchema,
  validateEnglishName,
  validateName,
  validatePassword,
  validationHook
} from '../http';
import { authMiddleware, type AppBindings } from '../plugins/auth';

const createUserBodySchema = z.object({
  name: z.string(),
  english_name: z.string().nullable().optional(),
  role: userRoleSchema,
  class_id: z.number().int().positive().nullable().optional()
});

const batchCreateUsersBodySchema = z.object({
  entries: z.array(createUserBodySchema).min(1)
});

const classTeachersBodySchema = z.object({
  teacher_ids: z.array(z.number().int().positive()).min(1)
});

const classStudentsBodySchema = z.object({
  student_ids: z.array(z.number().int().positive()).min(1)
});

const createClassBodySchema = z.object({
  name: z.string()
});

const classStudentsQuerySchema = userSearchQuerySchema.extend({
  scope: z.enum(['all']).optional()
});

const maxImportCsvSize = 50 * 1024 * 1024;

const classIdParamSchema = z.object({
  classId: z.string().regex(/^[1-9]\d*$/)
});

function resolveClassId(role: 'admin' | 'teacher' | 'student', classId: number | null | undefined) {
  if (!classId) {
    return null;
  }

  if (role === 'admin') {
    throw new Error('管理员不能分配班级。');
  }

  const targetClass = database.findClassById(classId);

  if (!targetClass) {
    throw new Error('指定的班级不存在。');
  }

  return targetClass.id;
}

async function readImportFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new Error('请上传 .csv 文件。');
  }

  if (file.size > maxImportCsvSize) {
    throw new Error('CSV 文件大小不能超过 50 MiB。');
  }

  return parseUserImportCsvBuffer(new Uint8Array(await file.arrayBuffer()), { columnCount: 4 });
}

function validateImportEntries(entries: CsvUserImportEntry[]) {
  return entries.map((entry) => {
    const nameError = validateName(entry.name);
    const englishNameError = validateEnglishName(entry.englishName);
    const className = entry.className?.trim() || null;

    if (nameError) {
      throw new Error(`第 ${entry.lineNumber} 行错误：${nameError}`);
    }

    if (englishNameError) {
      throw new Error(`第 ${entry.lineNumber} 行错误：${englishNameError}`);
    }

    if (entry.role === 'admin' && className) {
      throw new Error(`第 ${entry.lineNumber} 行错误：管理员不能填写班级。`);
    }

    const targetClass = className ? database.findClassByName(className) : null;

    if ((entry.role === 'student' || entry.role === 'teacher') && className && !targetClass) {
      throw new Error(`第 ${entry.lineNumber} 行错误：班级不存在或错误。`);
    }

    return {
      lineNumber: entry.lineNumber,
      name: entry.name.trim(),
      englishName: entry.englishName?.trim() || null,
      role: entry.role,
      classId: targetClass?.id ?? null,
      class_name: className
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
    const englishNameError = validateEnglishName(body.english_name);

    if (nameError) {
      return apiError(c, 400, nameError);
    }

    if (englishNameError) {
      return apiError(c, 400, englishNameError);
    }

    try {
      const classId = resolveClassId(body.role, body.class_id);
      const user = await database.createUser(body.name.trim(), body.role, body.english_name?.trim() || null);

      if (classId && user.role === 'student') {
        database.assignStudentsToClass(classId, [user.id]);
      } else if (classId && user.role === 'teacher') {
        database.assignTeachersToClass(classId, [user.id]);
      }

      return c.json({
        message: '用户创建成功。',
        user,
        credentialsCsv: await createUserCredentialsCsv([user])
      });
    } catch (error) {
      return apiError(c, 400, error instanceof Error ? error.message : '班级信息无效。');
    }
  })
  .post('/users/batch', zValidator('json', batchCreateUsersBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const normalized: Array<{ name: string; englishName: string | null; role: 'admin' | 'teacher' | 'student'; classId: number | null }> = [];

    for (let index = 0; index < body.entries.length; index += 1) {
      const entry = body.entries[index]!;
      const nameError = validateName(entry.name);
      const englishNameError = validateEnglishName(entry.english_name);

      if (nameError) {
        return apiError(c, 400, `第 ${index + 1} 行错误：${nameError}`);
      }

      if (englishNameError) {
        return apiError(c, 400, `第 ${index + 1} 行错误：${englishNameError}`);
      }

      try {
        normalized.push({
          name: entry.name.trim(),
          englishName: entry.english_name?.trim() || null,
          role: entry.role,
          classId: resolveClassId(entry.role, entry.class_id)
        });
      } catch (error) {
        return apiError(c, 400, `第 ${index + 1} 行错误：${error instanceof Error ? error.message : '班级信息无效。'}`);
      }
    }

    const users = await database.createUsers(normalized);

    return c.json({
      message: `成功创建 ${users.length} 个用户。`,
      users,
      credentialsCsv: await createUserCredentialsCsv(users)
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
        entries: entries.map(({ classId: _classId, englishName, ...entry }) => ({ ...entry, english_name: englishName }))
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
      const entries = validateImportEntries(parsed.entries).map(({ class_name: _className, ...entry }) => entry);
      const users = await database.createUsers(entries);

      return c.json({
        message: `成功导入 ${users.length} 个用户。`,
        encoding: parsed.encoding,
        users,
        credentialsCsv: await createUserCredentialsCsv(users)
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
  .get('/users/search', zValidator('query', userSearchQuerySchema.extend({ role: userRoleSchema }), validationHook), (c) => {
    const { role, ...query } = c.req.valid('query');

    return c.json({
      users: database.searchUsersByRole(role, query.q?.trim() ?? '')
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
      const englishNameError = validateEnglishName(body.english_name);

      if (error) {
        return apiError(c, 400, error);
      }

      if (englishNameError) {
        return apiError(c, 400, englishNameError);
      }

      database.updateUserName(user.id, body.name.trim(), body.english_name?.trim() || null);
    } else if (body.english_name !== undefined) {
      const englishNameError = validateEnglishName(body.english_name);

      if (englishNameError) {
        return apiError(c, 400, englishNameError);
      }

      database.updateUserName(user.id, user.name, body.english_name?.trim() || null);
    }

    if (body.password !== undefined && body.password !== '') {
      let password: string;
      try {
        password = decryptEnvelope(body.password);
      } catch {
        password = body.password;
      }

      const error = validatePassword(password);

      if (error) {
        return apiError(c, 400, error);
      }

      database.updateUserPassword(user.id, await hashPassword(password));
    }

    if (body.class_id !== undefined) {
      if (user.role !== 'student') {
        return apiError(c, 400, '只有学生可以修改班级。');
      }

      if (body.class_id && !database.findClassById(body.class_id)) {
        return apiError(c, 404, '班级不存在。');
      }

      database.setStudentsClass([user.id], body.class_id);
    }

    return c.json({ message: '用户信息更新成功。' });
  })
  .patch('/students/class', zValidator('json', batchUpdateStudentClassBodySchema, validationHook), (c) => {
    const body = c.req.valid('json');

    if (body.class_id && !database.findClassById(body.class_id)) {
      return apiError(c, 404, '班级不存在。');
    }

    const invalidStudentIds = body.ids.filter((id: number) => {
      const student = database.findUserById(id);
      return !student || student.role !== 'student';
    });

    if (invalidStudentIds.length > 0) {
      return apiError(c, 400, '列表中存在无效学生。');
    }

    database.setStudentsClass(body.ids, body.class_id);
    return c.json({ message: '班级已更新。' });
  })
  .patch('/users/password-reset', zValidator('json', batchResetPasswordBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const users = await database.resetUserPasswords(body.ids);

    return c.json({
      message: `成功重置 ${users.length} 个用户的密码。`,
      users,
      credentialsCsv: await createUserCredentialsCsv(users)
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
  .get('/classes', (c) => {
    return c.json({
      classes: database.getClasses(),
      assignments: database.getAllClassAssignments(),
      teachers: database.getUsersByRole('teacher')
    });
  })
  .post('/classes', zValidator('json', createClassBodySchema, validationHook), (c) => {
    const body = c.req.valid('json');
    const nameError = validateName(body.name);

    if (nameError) {
      return apiError(c, 400, nameError);
    }

    return c.json({
      message: '班级创建成功。',
      class: database.createClass(body.name.trim())
    });
  })
  .put('/classes/:classId', zValidator('param', classIdParamSchema, validationHook), zValidator('json', createClassBodySchema, validationHook), (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    const nameError = validateName(body.name);

    if (nameError) {
      return apiError(c, 400, nameError);
    }

    if (!database.updateClassName(classId, body.name.trim())) {
      return apiError(c, 404, '班级不存在。');
    }

    return c.json({ message: '班级信息已保存。' });
  })
  .get('/classes/students', zValidator('query', classStudentsQuerySchema, validationHook), (c) => {
    const query = c.req.valid('query');

    if (query.scope === 'all') {
      return c.json({
        students: database.getAssignedStudents()
      });
    }

    const classId = query.class_id ? Number(query.class_id) : null;

    if (classId && !database.findClassById(classId)) {
      return apiError(c, 404, '班级不存在。');
    }

    return c.json({
      students: database.searchStudentsForClassAssignment(query.q?.trim() ?? '', classId)
    });
  })
  .put('/classes/:classId/teachers', zValidator('param', classIdParamSchema, validationHook), zValidator('json', classTeachersBodySchema, validationHook), (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    const targetClass = database.findClassById(classId);

    if (!targetClass) {
      return apiError(c, 404, '班级不存在。');
    }

    const invalidTeacherIds = body.teacher_ids.filter((id: number) => {
      const teacher = database.findUserById(id);
      return !teacher || teacher.role !== 'teacher';
    });

    if (invalidTeacherIds.length > 0) {
      return apiError(c, 400, '分配列表中存在无效教师。');
    }

    database.assignTeachersToClass(classId, body.teacher_ids);
    return c.json({ message: '分配关系更新成功。' });
  })
  .delete('/classes/:classId/teachers', zValidator('param', classIdParamSchema, validationHook), zValidator('json', classTeachersBodySchema, validationHook), (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    const targetClass = database.findClassById(classId);

    if (!targetClass) {
      return apiError(c, 404, '班级不存在。');
    }

    const invalidTeacherIds = body.teacher_ids.filter((id: number) => {
      const teacher = database.findUserById(id);
      return !teacher || teacher.role !== 'teacher';
    });

    if (invalidTeacherIds.length > 0) {
      return apiError(c, 400, '分配列表中存在无效教师。');
    }

    database.removeTeachersFromClass(classId, body.teacher_ids);
    return c.json({ message: '分配关系更新成功。' });
  })
  .put('/classes/:classId/students', zValidator('param', classIdParamSchema, validationHook), zValidator('json', classStudentsBodySchema, validationHook), (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    const targetClass = database.findClassById(classId);

    if (!targetClass) {
      return apiError(c, 404, '班级不存在。');
    }

    const invalidStudentIds = body.student_ids.filter((id: number) => {
      const student = database.findUserById(id);
      return !student || student.role !== 'student';
    });

    if (invalidStudentIds.length > 0) {
      return apiError(c, 400, '分配列表中存在无效学生。');
    }

    database.assignStudentsToClass(classId, body.student_ids);
    return c.json({ message: '分配关系更新成功。' });
  })
  .delete('/classes/:classId/students', zValidator('param', classIdParamSchema, validationHook), zValidator('json', classStudentsBodySchema, validationHook), (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    const targetClass = database.findClassById(classId);

    if (!targetClass) {
      return apiError(c, 404, '班级不存在。');
    }

    const invalidStudentIds = body.student_ids.filter((id: number) => {
      const student = database.findUserById(id);
      return !student || student.role !== 'student';
    });

    if (invalidStudentIds.length > 0) {
      return apiError(c, 400, '分配列表中存在无效学生。');
    }

    database.removeStudentsFromClass(classId, body.student_ids);
    return c.json({ message: '分配关系更新成功。' });
  });
