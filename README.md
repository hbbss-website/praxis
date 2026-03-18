# 社会实践系统

## 技术栈

- 使用 Bun 进行依赖管理、脚本执行和后端运行
- 使用 TypeScript 编写后端代码、前端页面逻辑和测试
- 使用 Express 提供 API 服务
- 使用 `backend/database.json` 作为 JSON 文件数据存储
- 前端为静态 HTML + CSS 页面

## 如何使用

安装依赖：

```bash
bun install
```

启动：

```bash
bun start
```

以开发模式启动：

```bash
bun dev
```

编译前端 ts 文件：

```bash
bun build:frontend
```

运行类型检查和测试：

```bash
bun test:all
```

默认运行在 `http://localhost:3000`。

## 安全配置

部署前请配置以下环境变量：

```bash
JWT_SECRET=请替换为至少32位的高强度随机密钥
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
JWT_EXPIRES_IN=8h
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MS=900000
```

前端认证状态现在存储在 `sessionStorage` 中，而不是 `localStorage`。后端增加了更严格的 JWT 校验、登录失败限流、认证响应 `Cache-Control` 防缓存，以及 `helmet` 安全响应头。

## 默认账号

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 教师 | `teacher1` | `123456` |
| 学生 | `student1` | `123456` |
| 学生 | `student2` | `123456` |
