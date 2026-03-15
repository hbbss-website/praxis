const express = require('express');
const db = require('../database');
const { authMiddleware, teacherOnly } = require('../middleware/auth');

const router = express.Router();

// 获取所有学生的社会实践记录
router.get('/records', authMiddleware, teacherOnly, (req, res) => {
  const { student_id, status } = req.query;
  
  let query = `
    SELECT pr.*, u.name as student_name, u.username as student_username 
    FROM practice_records pr 
    JOIN users u ON pr.student_id = u.id 
    WHERE 1=1
  `;
  const params = [];
  
  if (student_id) {
    query += ' AND pr.student_id = ?';
    params.push(student_id);
  }
  
  if (status) {
    query += ' AND pr.status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY pr.created_at DESC';
  
  try {
    const records = db.prepare(query).all(...params);
    res.json({ records });
  } catch (error) {
    console.error('获取记录错误:', error);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 获取所有学生列表
router.get('/students', authMiddleware, teacherOnly, (req, res) => {
  try {
    const students = db.prepare(
      'SELECT id, username, name, created_at FROM users WHERE role = ? ORDER BY name'
    ).all('student');
    res.json({ students });
  } catch (error) {
    console.error('获取学生列表错误:', error);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 获取单个学生的详细记录
router.get('/students/:id/records', authMiddleware, teacherOnly, (req, res) => {
  const studentId = req.params.id;
  
  try {
    const records = db.prepare(`
      SELECT pr.*, u.name as student_name 
      FROM practice_records pr 
      JOIN users u ON pr.student_id = u.id 
      WHERE pr.student_id = ? 
      ORDER BY pr.created_at DESC
    `).all(studentId);
    res.json({ records });
  } catch (error) {
    console.error('获取学生记录错误:', error);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 审核社会实践记录
router.put('/records/:id/review', authMiddleware, teacherOnly, (req, res) => {
  const recordId = req.params.id;
  const { status, comment } = req.body;
  
  if (!status || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '请提供有效的审核状态' });
  }
  
  try {
    db.prepare(
      'UPDATE practice_records SET status = ?, teacher_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(status, comment || null, recordId);
    res.json({ message: '审核完成' });
  } catch (error) {
    console.error('审核错误:', error);
    res.status(500).json({ error: '审核失败' });
  }
});

// 获取统计信息
router.get('/statistics', authMiddleware, teacherOnly, (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_count
      FROM practice_records
    `).get();
    
    const studentStats = db.prepare(
      'SELECT COUNT(*) as student_count FROM users WHERE role = ?'
    ).get('student');
    
    res.json({
      statistics: {
        ...stats,
        student_count: studentStats.student_count
      }
    });
  } catch (error) {
    console.error('获取统计错误:', error);
    res.status(500).json({ error: '数据库错误' });
  }
});

module.exports = router;
