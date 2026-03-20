import { Router } from 'express';

import database from '../database';
import { authMiddleware, studentOnly } from '../middleware/auth';
import type { UpdateRecordInput } from '../models';

const router = Router();

function asRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function checkDate(date: string): boolean {
  return Date.parse(date) <= Date.now() + 14 * 60 * 60 * 1000;
}

function checkDuration(duration: number) {
  return duration >= 0.1;
}

router.get('/records', authMiddleware, studentOnly, (request, response) => {
  try {
    const records = database.getRecordsByStudent(request.user!.id);
    const statistics = database.getStudentStatistics(request.user!.id);
    response.json({ records, statistics });
  } catch (error) {
    console.error('加载学生记录失败。', error);
    response.status(500).json({ error: '加载记录失败。' });
  }
});

router.post('/records', authMiddleware, studentOnly, (request, response) => {
  const title = asRequiredString(request.body.title);
  const content = asRequiredString(request.body.content);
  const practiceDate = asRequiredString(request.body.practice_date);
  const duration: string = request.body.duration;

  if (!title || !content || !practiceDate || !duration) {
    response.status(400).json({ error: '标题、内容、实践日期和时长不能为空。' });
    return;
  }

  if (!checkDate(practiceDate)) {
    response.status(400).json({ error: '不能记录未来的活动。' });
    return;
  }

  if (!checkDuration(+duration)) {
    response.status(400).json({ error: '时长过短。' });
    return;
  }

  try {
    const record = database.createRecord({
      student_id: request.user!.id,
      title,
      content,
      practice_date: practiceDate,
      location: asOptionalString(request.body.location),
      duration: +duration,
      image_path: asOptionalString(request.body.image_path)
    });

    response.json({
      message: '记录创建成功。',
      recordId: record.id
    });
  } catch (error) {
    console.error('创建学生记录失败。', error);
    response.status(500).json({ error: '创建记录失败。' });
  }
});

router.put('/records/:id', authMiddleware, studentOnly, (request, response) => {
  const existingRecord = database.getRecordById(Number(request.params.id));

  if (!existingRecord || existingRecord.student_id !== request.user!.id) {
    response.status(404).json({ error: '记录不存在。' });
    return;
  }

  if (existingRecord.status !== 'pending' && existingRecord.status !== 'rejected') {
    response.status(403).json({ error: '只能修改待审核或已驳回的记录。' });
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
    if (!title) {
      response.status(400).json({ error: '标题不能为空。' });
      return;
    }

    updates.title = title;
  }

  if (request.body.content !== undefined) {
    if (!content) {
      response.status(400).json({ error: '内容不能为空。' });
      return;
    }
    updates.content = content;
  }

  if (request.body.practice_date !== undefined) {
    if (!practiceDate) {
      response.status(400).json({ error: '实践日期不能为空。' });
      return;
    }
    if (!checkDate(practiceDate)) {
      response.status(400).json({ error: '不能记录未来的活动。' });
      return;
    }
    updates.practice_date = practiceDate;
  }

  if (request.body.location !== undefined) {
    updates.location = asOptionalString(request.body.location);
  }

  if (request.body.duration !== undefined) {
    if (!duration) {
      response.status(400).json({ error: '时长不能为空。' });
      return;
    }
    if (!checkDuration(+duration)) {
      response.status(400).json({ error: '时长过短。' });
      return;
    }
    updates.duration = +duration;
  }

  if (request.body.image_path !== undefined) {
    updates.image_path = asOptionalString(request.body.image_path);
  }

  try {
    database.updateRecord(existingRecord.id, updates);
    response.json({ message: '记录更新成功。' });
  } catch (error) {
    console.error('更新学生记录失败。', error);
    response.status(500).json({ error: '更新记录失败。' });
  }
});

router.delete('/records/:id', authMiddleware, studentOnly, (request, response) => {
  const existingRecord = database.getRecordById(Number(request.params.id));

  if (!existingRecord || existingRecord.student_id !== request.user!.id) {
    response.status(404).json({ error: '记录不存在。' });
    return;
  }

  if (existingRecord.status !== 'pending') {
    response.status(403).json({ error: '只能删除待审核的记录。' });
    return;
  }

  try {
    database.deleteRecord(existingRecord.id);
    response.json({ message: '记录删除成功。' });
  } catch (error) {
    console.error('删除学生记录失败。', error);
    response.status(500).json({ error: '删除记录失败。' });
  }
});

router.get('/notifications', authMiddleware, studentOnly, (request, response) => {
  try {
    const notifications = database.getNotificationsByStudent(request.user!.id);
    const unreadCount = database.getUnreadNotificationCount(request.user!.id);
    response.json({ notifications, unreadCount });
  } catch (error) {
    console.error('加载通知失败。', error);
    response.status(500).json({ error: '加载通知失败。' });
  }
});

router.post('/notifications/read', authMiddleware, studentOnly, (request, response) => {
  try {
    database.markNotificationsAsRead(request.user!.id);
    response.json({ message: '通知已标记为已读。' });
  } catch (error) {
    console.error('标记通知已读失败。', error);
    response.status(500).json({ error: '操作失败。' });
  }
});

export default router;
