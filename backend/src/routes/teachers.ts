import { Router } from 'express';

import database from '../database';
import { authMiddleware, teacherOnly } from '../middleware/auth';

const router = Router();

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

    response.json({ message: '审核结果保存成功。' });
  } catch (error) {
    console.error('审核记录失败。', error);
    response.status(500).json({ error: '审核记录失败。' });
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
