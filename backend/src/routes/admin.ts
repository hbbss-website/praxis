import bcrypt from 'bcryptjs';
import { Router } from 'express';

import database from '../database';
import { authMiddleware, adminOnly } from '../middleware/auth';

const router = Router();

// --- Single User Creation ---

router.post('/users', authMiddleware, adminOnly, (request, response) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
  const role = request.body.role;

  if (!name) { response.status(400).json({ error: '姓名不能为空。' }); return; }
  if (!database.isValidRole(role)) { response.status(400).json({ error: '角色无效。' }); return; }

  try {
    const result = database.createUser(name, role);
    response.json({ message: '用户创建成功。', user: result });
  } catch (error) {
    console.error('创建用户失败。', error);
    response.status(500).json({ error: '创建用户失败。' });
  }
});

// --- Batch User Creation (JSON) ---

router.post('/users/batch', authMiddleware, adminOnly, (request, response) => {
  const entries = request.body.entries;

  if (!Array.isArray(entries) || entries.length === 0) {
    response.status(400).json({ error: '用户列表不能为空。' });
    return;
  }

  const validated: Array<{ name: string; role: 'admin' | 'teacher' | 'student' }> = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const role = entry.role;
    if (!name) { response.status(400).json({ error: `第 ${i + 1} 行姓名为空。` }); return; }
    if (!database.isValidRole(role)) { response.status(400).json({ error: `第 ${i + 1} 行角色无效。` }); return; }
    validated.push({ name, role });
  }

  try {
    const results = database.createUsers(validated);
    response.json({ message: `成功创建 ${results.length} 个用户。`, users: results });
  } catch (error) {
    console.error('批量创建用户失败。', error);
    response.status(500).json({ error: '批量创建用户失败。' });
  }
});

// --- CSV Import ---

router.post('/users/import', authMiddleware, adminOnly, (request, response) => {
  const csvContent = typeof request.body.csv === 'string' ? request.body.csv : '';

  if (!csvContent) {
    response.status(400).json({ error: 'CSV内容不能为空。' });
    return;
  }

  const lines = csvContent.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);

  if (lines.length === 0) {
    response.status(400).json({ error: 'CSV没有有效数据。' });
    return;
  }

  const validated: Array<{ name: string; role: 'admin' | 'teacher' | 'student' }> = [];

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(',').map((p: string) => p.trim());
    if (parts.length < 2) {
      response.status(400).json({ error: `第 ${i + 1} 行格式无效，需要 name,role。` });
      return;
    }

    const name = parts[0];
    const role = parts[1];

    if (!name) {
      response.status(400).json({ error: `第 ${i + 1} 行姓名为空。` });
      return;
    }
    if (role !== 'student' && role !== 'teacher' && role !== 'admin') {
      response.status(400).json({ error: `第 ${i + 1} 行角色无效，只能是 student/teacher/admin。` });
      return;
    }
    validated.push({ name, role });
  }

  try {
    const results = database.createUsers(validated);
    response.json({ message: `成功导入 ${results.length} 个用户。`, users: results });
  } catch (error) {
    console.error('CSV 导入失败。', error);
    response.status(500).json({ error: 'CSV 导入失败。' });
  }
});

// --- User Management ---

router.get('/users', authMiddleware, adminOnly, (request, response) => {
  try {
    const role = typeof request.query.role === 'string' && database.isValidRole(request.query.role)
      ? request.query.role : undefined;
    const users = database.getUsersByRole(role as any);
    response.json({ users });
  } catch (error) {
    console.error('加载用户列表失败。', error);
    response.status(500).json({ error: '加载用户列表失败。' });
  }
});

router.put('/users/:id', authMiddleware, adminOnly, (request, response) => {
  const userId = Number(request.params.id);
  const user = database.findUserById(userId);

  if (!user) {
    response.status(404).json({ error: '用户不存在。' });
    return;
  }

  try {
    const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
    const newPassword = typeof request.body.password === 'string' ? request.body.password : '';

    if (name) database.updateUserName(userId, name);
    if (newPassword) {
      if (newPassword.length < 8) {
        response.status(400).json({ error: '密码至少需要 8 位。' });
        return;
      }
      database.updateUserPassword(userId, bcrypt.hashSync(newPassword, 10));
    }

    response.json({ message: '用户信息更新成功。' });
  } catch (error) {
    console.error('更新用户信息失败。', error);
    response.status(500).json({ error: '更新用户信息失败。' });
  }
});

router.put('/users/batch', authMiddleware, adminOnly, (request, response) => {
  const updates = request.body.updates;

  if (!Array.isArray(updates) || updates.length === 0) {
    response.status(400).json({ error: '更新列表不能为空。' });
    return;
  }

  try {
    let successCount = 0;
    for (const update of updates) {
      const userId = Number(update.id);
      const user = database.findUserById(userId);
      if (!user) continue;

      const name = typeof update.name === 'string' ? update.name.trim() : '';
      const newPassword = typeof update.password === 'string' ? update.password : '';

      if (name) database.updateUserName(userId, name);
      if (newPassword) {
        if (newPassword.length < 8) continue; // skip invalid password
        database.updateUserPassword(userId, bcrypt.hashSync(newPassword, 10));
      }
      successCount++;
    }

    response.json({ message: `成功更新 ${successCount} 个用户。` });
  } catch (error) {
    console.error('批量更新用户失败。', error);
    response.status(500).json({ error: '批量更新用户失败。' });
  }
});

router.delete('/users/:id', authMiddleware, adminOnly, (request, response) => {
  const userId = Number(request.params.id);

  if (userId === request.user!.id) {
    response.status(400).json({ error: '不能删除自己的账号。' });
    return;
  }

  try {
    if (!database.deleteUser(userId)) {
      response.status(404).json({ error: '用户不存在。' });
      return;
    }
    response.json({ message: '用户删除成功。' });
  } catch (error) {
    console.error('删除用户失败。', error);
    response.status(500).json({ error: '删除用户失败。' });
  }
});

// --- Teacher-Student Assignments ---

router.get('/assignments', authMiddleware, adminOnly, (_request, response) => {
  try {
    const assignments = database.getAllAssignments();
    const teachers = database.getUsersByRole('teacher');
    const students = database.getAllStudents();
    response.json({ assignments, teachers, students });
  } catch (error) {
    console.error('加载分配关系失败。', error);
    response.status(500).json({ error: '加载分配关系失败。' });
  }
});

router.post('/assignments', authMiddleware, adminOnly, (request, response) => {
  const teacherId = Number(request.body.teacher_id);
  const studentIds = request.body.student_ids;

  if (!Number.isFinite(teacherId)) {
    response.status(400).json({ error: '教师 ID 无效。' });
    return;
  }

  const teacher = database.findUserById(teacherId);
  if (!teacher || teacher.role !== 'teacher') {
    response.status(404).json({ error: '教师不存在。' });
    return;
  }

  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    response.status(400).json({ error: '学生列表不能为空。' });
    return;
  }

  try {
    database.assignStudentsToTeacher(teacherId, studentIds.map(Number));
    response.json({ message: '分配关系更新成功。' });
  } catch (error) {
    console.error('更新分配关系失败。', error);
    response.status(500).json({ error: '更新分配关系失败。' });
  }
});

router.delete('/assignments', authMiddleware, adminOnly, (request, response) => {
  const teacherId = Number(request.body.teacher_id);
  const studentIds = request.body.student_ids;

  if (!Number.isFinite(teacherId) || !Array.isArray(studentIds)) {
    response.status(400).json({ error: '参数无效。' });
    return;
  }

  try {
    database.removeStudentsFromTeacher(teacherId, studentIds.map(Number));
    response.json({ message: '分配关系删除成功。' });
  } catch (error) {
    console.error('删除分配关系失败。', error);
    response.status(500).json({ error: '删除分配关系失败。' });
  }
});

export default router;
