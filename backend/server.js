const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const db = require('./database');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const teacherRoutes = require('./routes/teachers');
const { authMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 确保上传目录存在
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置multer存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB限制
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('只允许上传图片文件'));
  }
});

// 中间件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/teacher', teacherRoutes);

// 文件上传路由
app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有上传文件' });
  }
  
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ 
    message: '上传成功',
    imageUrl,
    filename: req.file.filename
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`API文档:`);
  console.log(`  POST /api/auth/login - 登录`);
  console.log(`  GET  /api/auth/me - 获取当前用户`);
  console.log(`  GET  /api/student/records - 学生获取自己的记录`);
  console.log(`  POST /api/student/records - 学生创建记录`);
  console.log(`  GET  /api/teacher/records - 老师查看所有记录`);
  console.log(`  GET  /api/teacher/students - 老师获取学生列表`);
  console.log(`  PUT  /api/teacher/records/:id/review - 老师审核记录`);
});
