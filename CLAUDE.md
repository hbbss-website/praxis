# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

可爱奶龙社会实践系统：单仓库、pnpm workspace 组织的全栈 TypeScript 应用。

- 前端：React 19 + Vite + shadcn/ui（new-york 风格，neutral 基色）+ Tailwind v4
- 后端：Hono（`@hono/node-server`）+ Zod 校验
- 数据库：SQLite + Drizzle ORM（beta 版）
- 鉴权：JWT（`jose`），登录失败次数限流
- Node ≥ 24，包管理器固定为 `pnpm@10.33.0`

## 常用命令

```bash
pnpm install --frozen-lockfile      # 安装依赖
pnpm dev                            # 同时启动后端 (tsx watch) 与前端 (vite)
pnpm dev:backend / pnpm dev:frontend
pnpm build                          # 仅构建前端产物到 frontend/dist
pnpm start                          # build + 以 tsx 运行 backend/src/server.ts（由后端同时托管前端静态文件）
pnpm typecheck                      # tsc --noEmit
pnpm test                           # vitest run
pnpm test:watch                     # vitest --ui
pnpm test:all                       # typecheck + test（husky pre-commit 会自动运行）
vitest run backend/tests/api.test.ts -t "<用例名>"   # 跑单个测试

# 数据库（schema 在 backend/src/db/schema.ts，迁移输出到 backend/drizzle）
pnpm db:generate    # 由 schema 生成迁移
pnpm db:push        # 直接同步 schema 到 DB（开发）
pnpm db:migrate     # 运行 backend/scripts/migrate.ts
pnpm db:studio
```

修改后端或数据库结构后务必运行 `pnpm test:all`（这也是 pre-commit 钩子）。

## 架构要点

### 后端入口与路由聚合
- `backend/src/server.ts` 仅启动 HTTP 服务；真正的应用在 `backend/src/app.ts`。
- `app.ts` 中导出两个关键对象：
  - `api`（`Hono<AppBindings>`）——挂载在 `/api` 下，聚合 `authRoutes / adminRoutes / teacherRoutes / studentRoutes / uploadRoutes`。
  - `app` ——组合 CORS、`authMiddleware`、`api`，并负责托管 `frontend/dist` 静态资源与 `/uploads` 文件（带路径穿越防护）。
- **类型导出 `export type Api = typeof api` 是前后端共享契约的核心**，前端通过它实现 Hono RPC（见下文）。修改路由/入参/返回类型时会自动通过 TS 传导到前端。

### 鉴权与共享基础设施
- `plugins/auth.ts`：定义 `AppBindings`（Hono 的 `Variables`/`Bindings` 类型）及注入当前用户的中间件。
- `http.ts`：集中放置 `apiError`、`requireAuthenticatedUser` 以及所有 Zod schema（UID、密码、长度上限、上传路径正则等）。新增校验规则应放这里，避免在路由里重复定义。
- `auth/`：`config.ts`（JWT 配置）、`password.ts`（哈希）、`login-attempts.ts`（失败锁定，由 `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_MS` 控制）。
- `models.ts`：领域常量与类型（`userRoles`、`recordStatuses`、`notificationTypes`、`User` 等），前后端均可引用。
- `database.ts` + `db/{client,schema,setup}.ts`：Drizzle 客户端与初始化。数据库文件位置由 `DATABASE_FILE` 决定（默认 `./backend/data/app.db`），与 `drizzle.config.ts` 保持同源。

### 前端结构
- 别名 `@/* → frontend/src/*`（见 `tsconfig.json`、`components.json`）。
- `features/` 按角色划分页面：`admin-pages.tsx` / `teacher-pages.tsx` / `student-pages.tsx` / `auth-page.tsx` / `setup-password-page.tsx`。
- `shared/` 放跨角色的业务组件；`components/ui` 为 shadcn 生成的原子组件——通过 shadcn CLI 安装，而非手写。
- `lib/api.ts` 使用 `hc<Api>()` 构建类型安全的 RPC 客户端；**前端调用后端一律走这里，不要重复手写 REST 路径/请求类型**，仅在必要时补少量适配层。
- `lib/auth.tsx`、`lib/session.ts` 管理会话；`lib/types.ts` 汇总前端侧类型。

### 环境变量
见 README。关键：`DATABASE_FILE`、`JWT_SECRET`（≥32 位）、`CORS_ORIGINS`（逗号分隔）、`JWT_EXPIRES_IN`、`LOGIN_MAX_ATTEMPTS`、`LOGIN_LOCKOUT_MS`、`TRUST_PROXY`、`PORT`、`HOST`。

## 项目约定（来自 AGENTS.md）

- **前端**：UI 保持简洁紧凑；**不要添加任何不必要的元素、解释、说明或英文翻译**。通过 shadcn/ui 安装全部 UI 组件。**在汉字与半角字符之间插入空格**，全角标点与半角字符之间不需要。
- **后端**：遵循 RESTful；Hono 编写；SQLite + Drizzle。修改 `schema`、迁移脚本或 DB 文件位置时必须同步修改相关配置。
- **前后端类型共享**优先复用既有 TS 类型；接口调用优先 Hono RPC。
- **任何一侧都不要信任对方传入的内容**，必须做合法性判断（后端用 `http.ts` 中的 Zod schema）。
- 代码风格简洁、可维护，**尽量不写注释，不要重复造轮子**。
