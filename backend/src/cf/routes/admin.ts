import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { CFAppBindings } from '../auth-plugin';
import { authMiddleware } from '../auth-plugin';
import { hashPassword } from '../password';
import { decryptEnvelope } from '../password-key-manager';
import { getCFConfig } from '../config';
import { createUserCredentialsCsv, parseUserImportCsvBuffer, type CsvUserImportEntry } from '../../csv/user-import';
import {
  apiError, batchDeleteUsersBodySchema, batchResetPasswordBodySchema, batchUpdateStudentClassBodySchema,
  requireRole, roleQuerySchema, updateUserBodySchema, userSearchQuerySchema, userRoleSchema,
  validateEnglishName, validateName, validatePassword, validationHook
} from '../../http';

const createUserBodySchema = z.object({
  name: z.string(), english_name: z.string().nullable().optional(),
  role: userRoleSchema, class_id: z.number().int().positive().nullable().optional()
});
const batchCreateUsersBodySchema = z.object({ entries: z.array(createUserBodySchema).min(1) });
const classTeachersBodySchema = z.object({ teacher_ids: z.array(z.number().int().positive()).min(1) });
const classStudentsBodySchema = z.object({ student_ids: z.array(z.number().int().positive()).min(1) });
const createClassBodySchema = z.object({ name: z.string() });
const classStudentsQuerySchema = userSearchQuerySchema.extend({ scope: z.enum(['all']).optional() });
const classIdParamSchema = z.object({ classId: z.string().regex(/^[1-9]\d*$/) });

async function resolveClassId(c: Context<CFAppBindings>, role: 'admin' | 'teacher' | 'student', classId: number | null | undefined) {
  if (!classId) return null;
  if (role === 'admin') throw new Error('管理员不能分配班级。');
  const targetClass = await c.var.db.findClassById(classId);
  if (!targetClass) throw new Error('指定的班级不存在。');
  return targetClass.id;
}

async function readImportFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('请上传 .csv 文件。');
  if (file.size > 50 * 1024 * 1024) throw new Error('CSV 文件大小不能超过 50 MiB。');
  return parseUserImportCsvBuffer(new Uint8Array(await file.arrayBuffer()), { columnCount: 4 });
}

async function validateImportEntries(c: Context<CFAppBindings>, entries: CsvUserImportEntry[]) {
  const result = [];
  for (const entry of entries) {
    const nameError = validateName(entry.name);
    const englishNameError = validateEnglishName(entry.englishName);
    const className = entry.className?.trim() || null;
    if (nameError) throw new Error(`第 ${entry.lineNumber} 行错误：${nameError}`);
    if (englishNameError) throw new Error(`第 ${entry.lineNumber} 行错误：${englishNameError}`);
    if (entry.role === 'admin' && className) throw new Error(`第 ${entry.lineNumber} 行错误：管理员不能填写班级。`);
    const targetClass = className ? await c.var.db.findClassByName(className) : null;
    if ((entry.role === 'student' || entry.role === 'teacher') && className && !targetClass) throw new Error(`第 ${entry.lineNumber} 行错误：班级不存在或错误。`);
    result.push({ lineNumber: entry.lineNumber, name: entry.name.trim(), englishName: entry.englishName?.trim() || null, role: entry.role, classId: targetClass?.id ?? null, class_name: className });
  }
  return result;
}

export const cfAdminRoutes = new Hono<CFAppBindings>()
  .use('*', authMiddleware)
  .use('*', async (c, next) => {
    const f = requireRole(c, ['admin']);
    if (f) return f;
    await next();
  })
  .post('/users', zValidator('json', createUserBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const nameError = validateName(body.name);
    const englishNameError = validateEnglishName(body.english_name);
    if (nameError) return apiError(c, 400, nameError);
    if (englishNameError) return apiError(c, 400, englishNameError);
    try {
      const classId = await resolveClassId(c, body.role, body.class_id);
      const user = await c.var.db.createUser(body.name.trim(), body.role, body.english_name?.trim() || null);
      if (classId && user.role === 'student') await c.var.db.assignStudentsToClass(classId, [user.id]);
      else if (classId && user.role === 'teacher') await c.var.db.assignTeachersToClass(classId, [user.id]);
      return c.json({ message: '用户创建成功。', user, credentialsCsv: await createUserCredentialsCsv([user]) });
    } catch (error) { return apiError(c, 400, error instanceof Error ? error.message : '班级信息无效。'); }
  })
  .post('/users/batch', zValidator('json', batchCreateUsersBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const normalized: any[] = [];
    for (let i = 0; i < body.entries.length; i++) {
      const entry = body.entries[i]!;
      const nameError = validateName(entry.name);
      const englishNameError = validateEnglishName(entry.english_name);
      if (nameError) return apiError(c, 400, `第 ${i + 1} 行错误：${nameError}`);
      if (englishNameError) return apiError(c, 400, `第 ${i + 1} 行错误：${englishNameError}`);
      try {
        normalized.push({ name: entry.name.trim(), englishName: entry.english_name?.trim() || null, role: entry.role, classId: await resolveClassId(c, entry.role, entry.class_id) });
      } catch (error) { return apiError(c, 400, `第 ${i + 1} 行错误：${error instanceof Error ? error.message : '班级信息无效。'}`); }
    }
    const users = await c.var.db.createUsers(normalized);
    return c.json({ message: `成功创建 ${users.length} 个用户。`, users, credentialsCsv: await createUserCredentialsCsv(users) });
  })
  .post('/users/import/preview', async (c) => {
    try {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) return apiError(c, 400, '缺少 CSV 文件。');
      const parsed = await readImportFile(file);
      const entries = await validateImportEntries(c, parsed.entries);
      return c.json({ message: `成功识别 ${parsed.totalCount} 条导入记录。`, encoding: parsed.encoding, totalCount: parsed.totalCount, studentCount: parsed.studentCount, entries: entries.map(({ classId: _, englishName, ...e }) => ({ ...e, english_name: englishName })) });
    } catch (error) { return apiError(c, 400, error instanceof Error ? error.message : 'CSV 文件无效。'); }
  })
  .post('/users/import', async (c) => {
    try {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) return apiError(c, 400, '缺少 CSV 文件。');
      const parsed = await readImportFile(file);
      const entries = (await validateImportEntries(c, parsed.entries)).map(({ class_name: _, ...e }) => e);
      const users = await c.var.db.createUsers(entries);
      return c.json({ message: `成功导入 ${users.length} 个用户。`, encoding: parsed.encoding, users, credentialsCsv: await createUserCredentialsCsv(users) });
    } catch (error) { return apiError(c, 400, error instanceof Error ? error.message : 'CSV 导入失败。'); }
  })
  .get('/users', zValidator('query', roleQuerySchema, validationHook), async (c) => {
    const query = c.req.valid('query');
    return c.json({ users: await c.var.db.getUsersByRole(query.role) });
  })
  .get('/users/search', zValidator('query', userSearchQuerySchema.extend({ role: userRoleSchema }), validationHook), async (c) => {
    const { role, ...query } = c.req.valid('query');
    return c.json({ users: await c.var.db.searchUsersByRole(role, query.q?.trim() ?? '') });
  })
  .put('/users/:id', zValidator('param', z.object({ id: z.string().regex(/^[1-9]\d*$/) }), validationHook), zValidator('json', updateUserBodySchema, validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    const body = c.req.valid('json');
    const user = await c.var.db.findUserById(id);
    if (!user) return apiError(c, 404, '用户不存在。');
    if (body.name !== undefined) {
      const e = validateName(body.name), ee = validateEnglishName(body.english_name);
      if (e) return apiError(c, 400, e);
      if (ee) return apiError(c, 400, ee);
      await c.var.db.updateUserName(user.id, body.name.trim(), body.english_name?.trim() || null);
    } else if (body.english_name !== undefined) {
      const ee = validateEnglishName(body.english_name);
      if (ee) return apiError(c, 400, ee);
      await c.var.db.updateUserName(user.id, user.name, body.english_name?.trim() || null);
    }
    if (body.password !== undefined && body.password !== '') {
      let password: string;
      try { password = await decryptEnvelope(body.password, getCFConfig(c.env).jwt_secret); }
      catch { password = body.password; }
      const e = validatePassword(password);
      if (e) return apiError(c, 400, e);
      await c.var.db.updateUserPassword(user.id, await hashPassword(password));
    }
    if (body.class_id !== undefined) {
      if (user.role !== 'student') return apiError(c, 400, '只有学生可以修改班级。');
      if (body.class_id && !await c.var.db.findClassById(body.class_id)) return apiError(c, 404, '班级不存在。');
      await c.var.db.setStudentsClass([user.id], body.class_id);
    }
    return c.json({ message: '用户信息更新成功。' });
  })
  .patch('/students/class', zValidator('json', batchUpdateStudentClassBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    if (body.class_id && !await c.var.db.findClassById(body.class_id)) return apiError(c, 404, '班级不存在。');
    for (const id of body.ids) {
      const s = await c.var.db.findUserById(id);
      if (!s || s.role !== 'student') return apiError(c, 400, '列表中存在无效学生。');
    }
    await c.var.db.setStudentsClass(body.ids, body.class_id);
    return c.json({ message: '班级已更新。' });
  })
  .patch('/users/password-reset', zValidator('json', batchResetPasswordBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const users = await c.var.db.resetUserPasswords(body.ids);
    return c.json({ message: `成功重置 ${users.length} 个用户的密码。`, users, credentialsCsv: await createUserCredentialsCsv(users) });
  })
  .delete('/users', zValidator('json', batchDeleteUsersBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const currentUser = c.get('user')!;
    if (body.ids.includes(currentUser.id)) return apiError(c, 400, '不能删除自己的账号。');
    let count = 0;
    for (const id of body.ids) if (await c.var.db.deleteUser(id)) count++;
    return c.json({ message: `成功删除 ${count} 个用户。` });
  })
  .delete('/users/:id', zValidator('param', z.object({ id: z.string().regex(/^[1-9]\d*$/) }), validationHook), async (c) => {
    const id = Number(c.req.valid('param').id);
    if (id === c.get('user')!.id) return apiError(c, 400, '不能删除自己的账号。');
    if (!await c.var.db.deleteUser(id)) return apiError(c, 404, '用户不存在。');
    return c.json({ message: '用户删除成功。' });
  })
  .get('/classes', async (c) => c.json({
    classes: await c.var.db.getClasses(),
    assignments: await c.var.db.getAllClassAssignments(),
    teachers: await c.var.db.getUsersByRole('teacher')
  }))
  .post('/classes', zValidator('json', createClassBodySchema, validationHook), async (c) => {
    const body = c.req.valid('json');
    const nameError = validateName(body.name);
    if (nameError) return apiError(c, 400, nameError);
    return c.json({ message: '班级创建成功。', class: await c.var.db.createClass(body.name.trim()) });
  })
  .put('/classes/:classId', zValidator('param', classIdParamSchema, validationHook), zValidator('json', createClassBodySchema, validationHook), async (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    const nameError = validateName(body.name);
    if (nameError) return apiError(c, 400, nameError);
    if (!await c.var.db.updateClassName(classId, body.name.trim())) return apiError(c, 404, '班级不存在。');
    return c.json({ message: '班级信息已保存。' });
  })
  .get('/classes/students', zValidator('query', classStudentsQuerySchema, validationHook), async (c) => {
    const query = c.req.valid('query');
    if (query.scope === 'all') return c.json({ students: await c.var.db.getAssignedStudents() });
    const classId = query.class_id ? Number(query.class_id) : null;
    if (classId && !await c.var.db.findClassById(classId)) return apiError(c, 404, '班级不存在。');
    return c.json({ students: await c.var.db.searchStudentsForClassAssignment(query.q?.trim() ?? '', classId) });
  })
  .put('/classes/:classId/teachers', zValidator('param', classIdParamSchema, validationHook), zValidator('json', classTeachersBodySchema, validationHook), async (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    if (!await c.var.db.findClassById(classId)) return apiError(c, 404, '班级不存在。');
    for (const id of body.teacher_ids) {
      const t = await c.var.db.findUserById(id);
      if (!t || t.role !== 'teacher') return apiError(c, 400, '分配列表中存在无效教师。');
    }
    await c.var.db.assignTeachersToClass(classId, body.teacher_ids);
    return c.json({ message: '分配关系更新成功。' });
  })
  .delete('/classes/:classId/teachers', zValidator('param', classIdParamSchema, validationHook), zValidator('json', classTeachersBodySchema, validationHook), async (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    if (!await c.var.db.findClassById(classId)) return apiError(c, 404, '班级不存在。');
    for (const id of body.teacher_ids) {
      const t = await c.var.db.findUserById(id);
      if (!t || t.role !== 'teacher') return apiError(c, 400, '分配列表中存在无效教师。');
    }
    await c.var.db.removeTeachersFromClass(classId, body.teacher_ids);
    return c.json({ message: '分配关系更新成功。' });
  })
  .put('/classes/:classId/students', zValidator('param', classIdParamSchema, validationHook), zValidator('json', classStudentsBodySchema, validationHook), async (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    if (!await c.var.db.findClassById(classId)) return apiError(c, 404, '班级不存在。');
    for (const id of body.student_ids) {
      const s = await c.var.db.findUserById(id);
      if (!s || s.role !== 'student') return apiError(c, 400, '分配列表中存在无效学生。');
    }
    await c.var.db.assignStudentsToClass(classId, body.student_ids);
    return c.json({ message: '分配关系更新成功。' });
  })
  .delete('/classes/:classId/students', zValidator('param', classIdParamSchema, validationHook), zValidator('json', classStudentsBodySchema, validationHook), async (c) => {
    const classId = Number(c.req.valid('param').classId);
    const body = c.req.valid('json');
    if (!await c.var.db.findClassById(classId)) return apiError(c, 404, '班级不存在。');
    for (const id of body.student_ids) {
      const s = await c.var.db.findUserById(id);
      if (!s || s.role !== 'student') return apiError(c, 400, '分配列表中存在无效学生。');
    }
    await c.var.db.removeStudentsFromClass(classId, body.student_ids);
    return c.json({ message: '分配关系更新成功。' });
  });
