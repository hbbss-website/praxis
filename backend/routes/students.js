const express = require('express');
const db = require('../database');
const { authMiddleware, studentOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/records', authMiddleware, studentOnly, (req, res) => {
  try {
    const records = db.getRecordsByStudent(req.user.id);
    res.json({ records });
  } catch (error) {
    console.error('Failed to load student records:', error);
    res.status(500).json({ error: 'Failed to load records.' });
  }
});

router.post('/records', authMiddleware, studentOnly, (req, res) => {
  const { title, content, practice_date, location, duration, image_path } = req.body;

  if (!title || !content || !practice_date) {
    return res.status(400).json({ error: 'title, content, and practice_date are required.' });
  }

  try {
    const record = db.createRecord({
      student_id: req.user.id,
      title,
      content,
      practice_date,
      location: location || null,
      duration: duration || null,
      image_path: image_path || null
    });

    return res.json({
      message: 'Record created successfully.',
      recordId: record.id
    });
  } catch (error) {
    console.error('Failed to create student record:', error);
    return res.status(500).json({ error: 'Failed to create record.' });
  }
});

router.put('/records/:id', authMiddleware, studentOnly, (req, res) => {
  const record = db.getRecordById(req.params.id);

  if (!record || record.student_id !== req.user.id) {
    return res.status(404).json({ error: 'Record not found.' });
  }

  try {
    db.updateRecord(req.params.id, {
      title: req.body.title,
      content: req.body.content,
      practice_date: req.body.practice_date,
      location: req.body.location || null,
      duration: req.body.duration || null,
      image_path: req.body.image_path || null
    });

    return res.json({ message: 'Record updated successfully.' });
  } catch (error) {
    console.error('Failed to update student record:', error);
    return res.status(500).json({ error: 'Failed to update record.' });
  }
});

router.delete('/records/:id', authMiddleware, studentOnly, (req, res) => {
  const record = db.getRecordById(req.params.id);

  if (!record || record.student_id !== req.user.id) {
    return res.status(404).json({ error: 'Record not found.' });
  }

  try {
    db.deleteRecord(req.params.id);
    return res.json({ message: 'Record deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete student record:', error);
    return res.status(500).json({ error: 'Failed to delete record.' });
  }
});

module.exports = router;
