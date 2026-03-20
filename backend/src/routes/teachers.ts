import bcrypt from 'bcryptjs';
import { Router } from 'express';

import database from '../database';
import { authMiddleware, teacherOrAdmin } from '../middleware/auth';
import type { RecordFilters, UpdateRecordInput } from '../models';

const router = Router();

function asRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function checkDate(date: string): boolean {
  return Date.parse(date) <= Date.now() + 14 * 60 * 60 * 1000;
}

function checkDuration(duration: number) {
  return duration >= 0.1 && Number.isInteger(duration * 10);
}

/** Get student IDs visible to the current user (all for admin, assigned for teacher) */
function getVisibleStudentIds(userId: number, role: string): Set<number> | undefined {
  if (role === 'admin') return undefined; // admin sees all
  const students = database.getTeacherStudents(userId);
  return new Set(students.map((s) => s.id));
}

// --- Records ---

router.get('/records', authMiddleware, teacherOrAdmin, (request, response) => {
  try {
    const studentIds = getVisibleStudentIds(request.user!.id, request.user!.role);
    const filters: RecordFilters = {
      student_id: typeof request.query.student_id === 'string' ? request.query.student_id : null,
      status: typeof request.query.status === 'string' ? request.query.status : null,
      created_after: typeof request.query.created_after === 'string' ? request.query.created_after : null,
      created_before: typeof request.query.created_before === 'string' ? request.query.created_before : null,
      updated_after: typeof request.query.updated_after === 'string' ? request.query.updated_after : null,
      updated_before: typeof request.query.updated_before === 'string' ? request.query.updated_before : null
    };
    const records = database.getAllRecords(filters, studentIds);
    response.json({ records });
  } catch (error) {
    console.error('加载记录失败。', error);
    response.status(500).json({ error: '加载记录失败。' });
  }
});

router.get('/records/:id', authMiddleware, teacherOrAdmin, (request, response) => {
  try {
    const studentIds = getVisibleStudentIds(request.user!.id, request.user!.role);
    const record = database.getTeacherRecordById(Number(request.params.id), studentIds);
    if (!record) { response.status(404).json({ error: '记录不存在。' }); return; }
    response.json({ record });
  } catch (error) {
    console.error('加载记录详情失败。', error);
    response.status(500).json({ error: '加载记录详情失败。' });
  }
});

router.put('/records/:id/review', authMiddleware, teacherOrAdmin, (request, response) => {
  const status = request.body.status;
  const comment = typeof request.body.comment === 'string' && request.body.comment.trim()
    ? request.body.comment.trim() : null;

  if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
    response.status(400).json({ error: '审核状态只能是通过、驳回或撤销审核。' });
    return;
  }

  try {
    const studentIds = getVisibleStudentIds(request.user!.id, request.user!.role);
    const existing = database.getTeacherRecordById(Number(request.params.id), studentIds);
    if (!existing) { response.status(404).json({ error: '记录不存在。' }); return; }

    const updated = database.updateRecord(existing.id, { status, teacher_comment: comment });
    if (!updated) { response.status(404).json({ error: '记录不存在。' }); return; }

    let message = '';
    if (status === 'approved') message = `你的实践记录 "${updated.title}" 已被通过。`;
    else if (status === 'rejected') message = `你的实践记录 "${updated.title}" 已被驳回。`;
    else message = `你的实践记录 "${updated.title}" 已被退回待审核。`;

    database.createNotification(updated.student_id, status === 'pending' ? 'other' : status, message);

    response.json({ message: '审核结果保存成功。' });
  } catch (error) {
    console.error('审核记录失败。', error);
    response.status(500).json({ error: '审核记录失败。' });
  }
});

router.post('/records/batch-review', authMiddleware, teacherOrAdmin, (request, response) => {
  const ids = request.body.ids;
  const action = request.body.action; // 'approved' | 'rejected' | 'deleted'

  if (!Array.isArray(ids) || ids.length === 0) {
    response.status(400).json({ error: '请选择至少一条记录。' });
    return;
  }

  if (action !== 'approved' && action !== 'rejected' && action !== 'deleted') {
    response.status(400).json({ error: '操作类型无效。' });
    return;
  }

  try {
    const studentIds = getVisibleStudentIds(request.user!.id, request.user!.role);
    let successCount = 0;

    for (const id of ids) {
      const record = database.getTeacherRecordById(Number(id), studentIds);
      if (!record) continue;

      if (action === 'deleted') {
        database.deleteRecord(record.id);
        database.createNotification(record.student_id, 'deleted',
          `你的实践记录 "${record.title}" 已被删除。`);
      } else {
        database.updateRecord(record.id, { status: action, teacher_comment: null });
        const msg = action === 'approved'
          ? `你的实践记录 "${record.title}" 已被通过。`
          : `你的实践记录 "${record.title}" 已被驳回。`;
        database.createNotification(record.student_id, action, msg);
      }
      successCount++;
    }

    response.json({ message: `成功处理 ${successCount} 条记录。` });
  } catch (error) {
    console.error('批量操作失败。', error);
    response.status(500).json({ error: '批量操作失败。' });
  }
});

router.put('/records/:id', authMiddleware, teacherOrAdmin, (request, response) => {
  const studentIds = getVisibleStudentIds(request.user!.id, request.user!.role);
  const existingRecord = database.getTeacherRecordById(Number(request.params.id), studentIds);

  if (!existingRecord) {
    response.status(404).json({ error: '记录不存在。' });
    return;
  }

  const updates: UpdateRecordInput = { updated_by_uid: request.user!.uid };
  const title = asRequiredString(request.body.title);
  const content = asRequiredString(request.body.content);
  const practiceDate = asRequiredString(request.body.practice_date);
  const duration = asRequiredString(request.body.duration);

  if (request.body.title !== undefined) {
    if (!title) { response.status(400).json({ error: '标题不能为空。' }); return; }
    updates.title = title;
  }
  if (request.body.content !== undefined) {
    if (!content) { response.status(400).json({ error: '内容不能为空。' }); return; }
    updates.content = content;
  }
  if (request.body.practice_date !== undefined) {
    if (!practiceDate) { response.status(400).json({ error: '实践日期不能为空。' }); return; }
    if (!checkDate(practiceDate)) { response.status(400).json({ error: '不能记录未来的活动。' }); return; }
    updates.practice_date = practiceDate;
  }
  if (request.body.location !== undefined) {
    updates.location = asOptionalString(request.body.location);
  }
  if (request.body.duration !== undefined) {
    if (!duration) { response.status(400).json({ error: '时长不能为空。' }); return; }
    if (!checkDuration(+duration)) { response.status(400).json({ error: '时长过短或不是 0.1 的倍数。' }); return; }
    updates.duration = +duration;
  }
  if (request.body.image_path !== undefined) {
    updates.image_path = asOptionalString(request.body.image_path);
  }

  try {
    database.updateRecord(existingRecord.id, updates);
    response.json({ message: '记录更新成功。' });
  } catch (error) {
    console.error('更新记录失败。', error);
    response.status(500).json({ error: '更新记录失败。' });
  }
});

router.delete('/records/:id', authMiddleware, teacherOrAdmin, (request, response) => {
  const studentIds = getVisibleStudentIds(request.user!.id, request.user!.role);
  const existingRecord = database.getTeacherRecordById(Number(request.params.id), studentIds);

  if (!existingRecord) {
    response.status(404).json({ error: '记录不存在。' });
    return;
  }

  try {
    database.deleteRecord(existingRecord.id);
    database.createNotification(existingRecord.student_id, 'deleted',
      `你的实践记录 "${existingRecord.title}" 已被删除。`);
    response.json({ message: '记录删除成功。' });
  } catch (error) {
    console.error('删除记录失败。', error);
    response.status(500).json({ error: '删除记录失败。' });
  }
});

// --- Students ---

router.get('/students', authMiddleware, teacherOrAdmin, (request, response) => {
  try {
    const students = request.user!.role === 'admin'
      ? database.getAllStudents()
      : database.getTeacherStudents(request.user!.id);
    response.json({ students });
  } catch (error) {
    console.error('加载学生列表失败。', error);
    response.status(500).json({ error: '加载学生列表失败。' });
  }
});

router.get('/students/:id/records', authMiddleware, teacherOrAdmin, (request, response) => {
  try {
    const records = database.getRecordsByStudent(Number(request.params.id));
    response.json({ records });
  } catch (error) {
    console.error('加载学生记录失败。', error);
    response.status(500).json({ error: '加载记录失败。' });
  }
});

router.put('/students/:id', authMiddleware, teacherOrAdmin, (request, response) => {
  const studentId = Number(request.params.id);
  const student = database.findUserById(studentId);

  if (!student || student.role !== 'student') {
    response.status(404).json({ error: '学生不存在。' });
    return;
  }

  // Teacher can only manage assigned students
  if (request.user!.role === 'teacher') {
    const assigned = database.getTeacherStudents(request.user!.id);
    if (!assigned.some((s) => s.id === studentId)) {
      response.status(403).json({ error: '无权管理该学生。' });
      return;
    }
  }

  try {
    const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
    const newPassword = typeof request.body.password === 'string' ? request.body.password : '';

    if (name) database.updateUserName(studentId, name);
    if (newPassword) {
      if (newPassword.length < 8) {
        response.status(400).json({ error: '密码至少需要8位。' });
        return;
      }
      database.updateUserPassword(studentId, bcrypt.hashSync(newPassword, 10));
    }

    response.json({ message: '学生信息更新成功。' });
  } catch (error) {
    console.error('更新学生信息失败。', error);
    response.status(500).json({ error: '更新学生信息失败。' });
  }
});

// --- Statistics ---

router.get('/statistics', authMiddleware, teacherOrAdmin, (request, response) => {
  try {
    const studentIds = getVisibleStudentIds(request.user!.id, request.user!.role);
    response.json({ statistics: database.getStatistics(studentIds) });
  } catch (error) {
    console.error('加载统计数据失败。', error);
    response.status(500).json({ error: '加载统计数据失败。' });
  }
});

export default router;
