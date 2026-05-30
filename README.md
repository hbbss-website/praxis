# 可爱奶龙社会实践系统

## 技术栈

- 运行时：Node.js
- 前端：React, shadcn/ui
- 后端：Hono
- 数据库：SQLite, Drizzle ORM
- 配置：TOML，见下方配置表

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

## 配置

`config.toml` 可选，缺失的字段自动使用默认值。所有可配置项：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `port` | 后端 HTTP 监听端口 | `3000` |
| `vite_port` | Vite 开发服务器端口（仅开发环境） | `5173` |
| `backend_host` | 后端监听地址 | `"127.0.0.1"` |
| `frontend_host` | 前端开发地址（仅开发环境） | `"127.0.0.1"` |
| `jwt_secret` | JWT 签名密钥，至少 32 字符 | 随机生成 |
| `jwt_issuer` | JWT 签发者 | `"social-practice-system"` |
| `jwt_expires_in` | JWT 有效期，支持 `s`/`m`/`h`/`d` 后缀 | `"8h"` |
| `login_max_attempts` | 登录连续失败锁定阈值 | `5` |
| `login_lockout_ms` | 锁定持续时间（毫秒） | `900000`（15 分钟） |
| `upload_image_max_size_bytes` | 单张图片上传大小上限 | `5242880`（5 MiB） |
| `upload_webp_quality` | WebP 压缩质量（1–100） | `76` |
| `upload_max_image_dimension` | 图片最长边缩放目标像素 | `1920` |
| `upload_webp_effort` | WebP 压缩力度（0–6） | `5` |
| `temp_upload_ttl_ms` | 临时上传文件保留时间（毫秒） | `1800000`（30 分钟） |
| `temp_upload_cleanup_interval_ms` | 临时文件清理间隔（毫秒） | `5000` |
| `timezone` | 时区标识 | `"UTC+8"` |
| `trust_proxy` | 是否信任反向代理转发地址 | `false` |
| `is_production` | 生产模式标记 | `false` |
| `cors_origins` | 允许的 CORS 域名列表 | `[]` |
| `record_max_images` | 每条实践记录最多图片数 | `9` |
| `max_daily_records` | 学生每日最多提交记录数 | `50` |
| `generated_password_length` | 批量创建用户时的生成密码长度 | `8` |
| `initial_admin_password` | 首次启动自动创建的默认管理员密码 | `"12345678"` |
| `csv_import_max_size_bytes` | CSV 批量导入文件大小上限 | `52428800`（50 MiB） |
| `user_name_max_length` | 用户姓名最大长度 | `40` |
| `title_max_length` | 记录/任务标题最大长度 | `120` |
| `content_max_length` | 记录内容最大长度 | `5000` |
| `comment_max_length` | 审核评语最大长度 | `500` |
| `password_min_length` | 密码最小长度 | `8` |
| `password_max_length` | 密码最大长度 | `32` |
| `uid_max_length` | UID 最大长度 | `32` |
| `location_max_length` | 实践地点最大长度 | `120` |
| `max_record_duration` | 实践时长最大值（小时） | `24` |

## 默认账号

| 角色 | UID | 密码 |
| --- | --- | --- |
| 管理员 | `A00001` | `12345678` |
