import { Router } from 'express';

import database from '../database';
import { authMiddleware, teacherOnly } from '../middleware/auth';
import type { UpdateRecordInput } from '../models';

const router = Router();

function asRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function checkDate(date: string): boolean {
  return Date.parse(date) <= Date.now() + 14 * 60 * 60 * 1000;
}

function checkDuration(duration: number) {
  return duration >= 0.1;
}

router.get('/records', authMiddleware, teacherOnly, (request, response) => {
  try {
    const records = database.getAllRecords({
      student_id: typeof request.query.student_id === 'string' ? request.query.student_id : null,
      status: typeof request.query.status === 'string' ? request.query.status : null
    });

    response.json({ records });
  } catch (error) {
    console.error('加载教师记录失败。', error);
    response.status(500).json({ error: '加载记录失败。' });
  }
});

router.get('/records/:id', authMiddleware, teacherOnly, (request, response) => {
  try {
    const record = database.getTeacherRecordById(Number(request.params.id));

    if (!record) {
      response.status(404).json({ error: '记录不存在。' });
      return;
    }

    response.json({ record });
  } catch (error) {
    console.error('加载记录详情失败。', error);
    response.status(500).json({ error: '加载记录详情失败。' });
  }
});

router.get('/students', authMiddleware, teacherOnly, (_request, response) => {
  try {
    const students = database.getAllStudents();
    response.json({ students });
  } catch (error) {
    console.error('加载学生列表失败。', error);
    response.status(500).json({ error: '加载学生列表失败。' });
  }
});

router.get('/students/:id/records', authMiddleware, teacherOnly, (request, response) => {
  try {
    const records = database.getRecordsByStudent(Number(request.params.id));
    response.json({ records });
  } catch (error) {
    console.error('加载学生详情记录失败。', error);
    response.status(500).json({ error: '加载记录失败。' });
  }
});

router.put('/records/:id/review', authMiddleware, teacherOnly, (request, response) => {
  const status = request.body.status;
  const comment =
    typeof request.body.comment === 'string' && request.body.comment.trim()
      ? request.body.comment.trim()
      : null;

  if (status !== 'approved' && status !== 'rejected') {
    response.status(400).json({ error: '审核状态只能是通过或驳回。' });
    return;
  }

  try {
    const updatedRecord = database.updateRecord(Number(request.params.id), {
      status,
      teacher_comment: comment
    });

    if (!updatedRecord) {
      response.status(404).json({ error: '记录不存在。' });
      return;
    }

    const message = status === 'approved' 
      ? `你的实践记录 "${updatedRecord.title}" 已被通过。` 
      : `你的实践记录 "${updatedRecord.title}" 已被驳回。`;
      
    database.createNotification(updatedRecord.student_id, status, message);

    response.json({ message: '审核结果保存成功。' });
  } catch (error) {
    console.error('审核记录失败。', error);
    response.status(500).json({ error: '审核记录失败。' });
  }
});

router.put('/records/:id', authMiddleware, teacherOnly, (request, response) => {
  const existingRecord = database.getRecordById(Number(request.params.id));

  if (!existingRecord) {
    response.status(404).json({ error: '记录不存在。' });
    return;
  }

  const updates: UpdateRecordInput = {
    updated_by_username: request.user!.username
  };
  
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
    if (!checkDuration(+duration)) { response.status(400).json({ error: '时长过短。' }); return; }
    updates.duration = +duration;
  }
  if (request.body.image_path !== undefined) {
    updates.image_path = asOptionalString(request.body.image_path);
  }

  try {
    database.updateRecord(existingRecord.id, updates);
    response.json({ message: '记录更新成功。' });
  } catch (error) {
    console.error('更新教师记录失败。', error);
    response.status(500).json({ error: '更新记录失败。' });
  }
});

router.delete('/records/:id', authMiddleware, teacherOnly, (request, response) => {
  const existingRecord = database.getRecordById(Number(request.params.id));

  if (!existingRecord) {
    response.status(404).json({ error: '记录不存在。' });
    return;
  }

  try {
    database.deleteRecord(existingRecord.id);
    database.createNotification(existingRecord.student_id, 'deleted', `你的实践记录 "${existingRecord.title}" 已被教师删除。`);
    response.json({ message: '记录删除成功。' });
  } catch (error) {
    console.error('删除教师记录失败。', error);
    response.status(500).json({ error: '删除记录失败。' });
  }
});

router.get('/statistics', authMiddleware, teacherOnly, (_request, response) => {
  try {
    response.json({ statistics: database.getStatistics() });
  } catch (error) {
    console.error('加载统计数据失败。', error);
    response.status(500).json({ error: '加载统计数据失败。' });
  }
});

export default router;
