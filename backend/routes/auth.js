const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
// 导入的是你之前提供的 database 对象 (包含 findUserByUsername 等方法)
const db = require('../database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// 登录
router.post('/login', async(req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '请提供用户名和密码' });
    }

    try {
        // 【修改点】不再使用 db.prepare，而是直接调用 database 模块的方法
        const user = db.findUserByUsername(username);

        if (!user) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        // 验证密码
        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        // 生成 Token
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET, { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                name: user.name
            }
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 获取当前用户信息
router.get('/me', (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未提供认证令牌' });
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // 【可选优化】这里也可以从数据库中重新拉取最新用户信息，或者直接返回 token 中的信息
        // const user = db.findUserById(decoded.id);
        // if (!user) return res.status(404).json({ error: '用户不存在' });

        res.json({ user: decoded });
    } catch (error) {
        res.status(401).json({ error: '令牌无效' });
    }
});

module.exports = router;