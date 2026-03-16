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

function asOptionalDuration(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

router.get('/records', authMiddleware, studentOnly, (request, response) => {
  try {
    const records = database.getRecordsByStudent(request.user!.id);
    response.json({ records });
  } catch (error) {
    console.error('加载学生记录失败。', error);
    response.status(500).json({ error: '加载记录失败。' });
  }
});

router.post('/records', authMiddleware, studentOnly, (request, response) => {
  const title = asRequiredString(request.body.title);
  const content = asRequiredString(request.body.content);
  const practiceDate = asRequiredString(request.body.practice_date);

  if (!title || !content || !practiceDate) {
    response.status(400).json({ error: '标题、内容和实践日期不能为空。' });
    return;
  }

  try {
    const record = database.createRecord({
      student_id: request.user!.id,
      title,
      content,
      practice_date: practiceDate,
      location: asOptionalString(request.body.location),
      duration: asOptionalDuration(request.body.duration),
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

  const updates: UpdateRecordInput = {};
  const title = asRequiredString(request.body.title);
  const content = asRequiredString(request.body.content);
  const practiceDate = asRequiredString(request.body.practice_date);

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

    updates.practice_date = practiceDate;
  }

  if (request.body.location !== undefined) {
    updates.location = asOptionalString(request.body.location);
  }

  if (request.body.duration !== undefined) {
    updates.duration = asOptionalDuration(request.body.duration);
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

  try {
    database.deleteRecord(existingRecord.id);
    response.json({ message: '记录删除成功。' });
  } catch (error) {
    console.error('删除学生记录失败。', error);
    response.status(500).json({ error: '删除记录失败。' });
  }
});

export default router;
