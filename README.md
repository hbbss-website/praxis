# 社会实践系统

## 技术栈

- 使用 Bun 进行依赖管理、脚本执行和后端运行
- 使用 TypeScript 编写后端代码、前端页面逻辑和测试
- 前端使用 React、Vite 与 shadcn/ui
- 使用 Express 提供 API 服务
- 使用 `backend/database.json` 作为 JSON 文件数据存储

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

开发模式下前端由 Vite 提供服务，默认地址为 `http://localhost:5173`，并通过代理转发 `/api` 与 `/uploads` 到后端；修改前端代码后会自动热更新。

编译前端 ts 文件：

```bash
bun build:frontend
```

运行类型检查和测试：

```bash
bun test:all
```

生产模式默认运行在 `http://localhost:3000`。

## CSV 导入说明

- 用户导入的 `CSV` 文件不包含表头
- 每行格式为 `姓名,角色,管理老师UID`
- `role` 只能是 `student`、`teacher` 或 `admin`
- 学生可以填写已有教师的 `UID`，教师和管理员最后一列留空
- 支持 `UTF-8`、`UTF-16` 和 `GBK` 编码；无法识别的编码会直接报错

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

| 角色 | UID | 密码 |
| --- | --- | --- |
| 管理员 | `A00001` | `12345678` |
| 教师 | `T00001` | `12345678` |
| 学生 | `S00001` | `12345678` |
| 学生 | `S00002` | `12345678` |
