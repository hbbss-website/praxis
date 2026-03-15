const express = require('express');
const db = require('../database');
const { authMiddleware, teacherOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/records', authMiddleware, teacherOnly, (req, res) => {
  try {
    const records = db.getAllRecords({
      student_id: req.query.student_id,
      status: req.query.status
    });
    res.json({ records });
  } catch (error) {
    console.error('Failed to load teacher records:', error);
    res.status(500).json({ error: 'Failed to load records.' });
  }
});

router.get('/students', authMiddleware, teacherOnly, (req, res) => {
  try {
    const students = db.getAllStudents();
    res.json({ students });
  } catch (error) {
    console.error('Failed to load students:', error);
    res.status(500).json({ error: 'Failed to load students.' });
  }
});

router.get('/students/:id/records', authMiddleware, teacherOnly, (req, res) => {
  try {
    const records = db.getRecordsByStudent(parseInt(req.params.id, 10));
    res.json({ records });
  } catch (error) {
    console.error('Failed to load student detail records:', error);
    res.status(500).json({ error: 'Failed to load records.' });
  }
});

router.put('/records/:id/review', authMiddleware, teacherOnly, (req, res) => {
  const { status, comment } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected.' });
  }

  try {
    const updatedRecord = db.updateRecord(req.params.id, {
      status,
      teacher_comment: comment || null
    });

    if (!updatedRecord) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    return res.json({ message: 'Review saved successfully.' });
  } catch (error) {
    console.error('Failed to review record:', error);
    return res.status(500).json({ error: 'Failed to review record.' });
  }
});

router.get('/statistics', authMiddleware, teacherOnly, (req, res) => {
  try {
    res.json({ statistics: db.getStatistics() });
  } catch (error) {
    console.error('Failed to load statistics:', error);
    res.status(500).json({ error: 'Failed to load statistics.' });
  }
});

module.exports = router;
