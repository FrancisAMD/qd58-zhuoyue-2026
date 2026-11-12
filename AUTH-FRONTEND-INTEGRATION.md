# 前端与 Worker 接口整合说明

前端 Pages 域名：`https://58er.eon21.space`
Worker API 域名：`https://api.58er.eon21.space`

## 已实现的 Worker API

- `POST /api/auth/register/request-code`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/password/request-code`
- `POST /api/auth/password/reset`
- `POST /api/auth/logout`
- `GET/PUT /api/profile`
- `GET /api/directory`
- `POST /api/teams/transfer`（Body: `{ "toUserId": "<同校成员用户ID>" }`）
- `GET /api/teams/transfers`
- `POST /api/teams/transfer/:id/accept`
- `POST /api/teams/transfer/:id/reject`

组长转让接口已在 Worker 实现，但当前 `app.js` 尚未提供转让管理 UI。管理员 API/RBAC/CSV 也仍待开发，不能把管理后台页面视为已连接真实数据。

## 安全边界

Site Key 是公开标识；Turnstile Secret、阿里云 AccessKey 等只能放在 Worker Secrets。Worker 负责 Siteverify、短信请求签名、密码哈希、会话校验和权限判断。不要将 Secret 写入前端或 GitHub。

D1 迁移按顺序执行。新迁移 `0003_team_transfer_invariants.sql` 增加组长成员关系与转让状态机触发器。执行远程迁移前先运行：

```bash
cd backend
npx wrangler d1 migrations list qd58-zhuoyue-db --remote
```

确认迁移历史后再运行 `npx wrangler d1 migrations apply qd58-zhuoyue-db --remote`。本项目开发流程不自动部署 Worker，也不发送真实短信。

## 当前限制

当前提交已经包含 Worker 源码、D1 迁移和本地/CI 检查，但这不代表代码已部署到 Cloudflare。尚未完成管理员独立认证、角色权限、筛选/导出、隐私告知、数据删除/匿名化、备份恢复和生产环境端到端验证。完成这些工作前不要开放真实报名。
