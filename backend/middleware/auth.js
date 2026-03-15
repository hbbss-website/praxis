const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-secret-key-change-this-in-production';

// 验证JWT token
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
}

// 验证老师角色
function teacherOnly(req, res, next) {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ error: '只有老师可以访问此资源' });
  }
  next();
}

// 验证学生角色
function studentOnly(req, res, next) {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: '只有学生可以访问此资源' });
  }
  next();
}

module.exports = {
  JWT_SECRET,
  authMiddleware,
  teacherOnly,
  studentOnly
};
