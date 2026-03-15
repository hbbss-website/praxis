const express = require('express');
const db = require('../database');
const { authMiddleware, studentOnly } = require('../middleware/auth');

const router = express.Router();

// 获取学生的社会实践记录
router.get('/records', authMiddleware, studentOnly, (req, res) => {
  const studentId = req.user.id;
  
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
    console.error('获取记录错误:', error);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 创建社会实践记录
router.post('/records', authMiddleware, studentOnly, (req, res) => {
  const studentId = req.user.id;
  const { title, content, practice_date, location, duration, image_path } = req.body;
  
  if (!title || !content || !practice_date) {
    return res.status(400).json({ error: '请填写标题、内容和实践日期' });
  }
  
  try {
    const result = db.prepare(`
      INSERT INTO practice_records (student_id, title, content, practice_date, location, duration, image_path) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(studentId, title, content, practice_date, location, duration || null, image_path || null);
    
    res.json({
      message: '记录创建成功',
      recordId: result.lastInsertRowid
    });
  } catch (error) {
    console.error('创建记录错误:', error);
    res.status(500).json({ error: '创建记录失败' });
  }
});

// 更新社会实践记录
router.put('/records/:id', authMiddleware, studentOnly, (req, res) => {
  const studentId = req.user.id;
  const recordId = req.params.id;
  const { title, content, practice_date, location, duration, image_path } = req.body;
  
  try {
    // 检查记录是否属于该学生
    const record = db.prepare('SELECT * FROM practice_records WHERE id = ? AND student_id = ?').get(recordId, studentId);
    
    if (!record) {
      return res.status(404).json({ error: '记录不存在或无权限' });
    }
    
    db.prepare(`
      UPDATE practice_records 
      SET title = ?, content = ?, practice_date = ?, location = ?, duration = ?, image_path = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(title, content, practice_date, location, duration, image_path, recordId);
    
    res.json({ message: '记录更新成功' });
  } catch (error) {
    console.error('更新记录错误:', error);
    res.status(500).json({ error: '更新记录失败' });
  }
});

// 删除社会实践记录
router.delete('/records/:id', authMiddleware, studentOnly, (req, res) => {
  const studentId = req.user.id;
  const recordId = req.params.id;
  
  try {
    const record = db.prepare('SELECT * FROM practice_records WHERE id = ? AND student_id = ?').get(recordId, studentId);
    
    if (!record) {
      return res.status(404).json({ error: '记录不存在或无权限' });
    }
    
    db.prepare('DELETE FROM practice_records WHERE id = ?').run(recordId);
    res.json({ message: '记录删除成功' });
  } catch (error) {
    console.error('删除记录错误:', error);
    res.status(500).json({ error: '删除记录失败' });
  }
});

module.exports = router;
