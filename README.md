# 社会实践系统

## 技术栈

- 使用 `pnpm` 进行依赖管理
- 前端使用 `React + Vite + shadcn/ui`
- 后端使用 `Node.js + Hono`
- 数据库使用 `SQLite + better-sqlite3`
- ORM 使用 `Drizzle ORM`

默认数据库文件为 `backend/data/app.db`，上传文件目录为 `backend/uploads`。

## 安装与初始化

```bash
pnpm install
pnpm db:migrate
```

## 如何使用

安装依赖：

```bash
pnpm install --frozen-lockfile
```

启动：

```bash
pnpm start
```

更多命令见 `package.json`。

## 环境变量

```bash
DATABASE_FILE=./backend/data/app.db
JWT_SECRET=请替换为至少 32 位的高强度随机密钥
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
JWT_EXPIRES_IN=8h
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MS=900000
```

## 默认账号

| 角色 | UID | 密码 |
| --- | --- | --- |
| 管理员 | `A00001` | `12345678` |
| 教师 | `T00001` | `12345678` |
| 学生 | `S00001` | `12345678` |
| 学生 | `S00002` | `12345678` |
