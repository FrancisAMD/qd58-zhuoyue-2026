# 卓越 2026 API（管理员 RBAC 阶段）

Cloudflare Worker + D1 后端。已提交手机号密码认证、Turnstile 服务端校验、阿里云 PNVS 接口适配、个人资料、大学自动组队、组长转让、同校目录，以及独立管理员认证与角色权限。

## 管理员 API

- POST /api/admin/login：独立管理员用户名/密码登录，IP 和用户名摘要双重限流，签发独立 Secure / HttpOnly / SameSite=Strict Cookie。
- POST /api/admin/logout、GET /api/admin/me。
- GET /api/admin/overview：统计概览；viewer 仅获得汇总数字。
- GET /api/admin/people：owner/admin 名单查询，支持 q、province、university、grade、category、page、pageSize。
- GET /api/admin/people?format=csv：最多导出 5000 行，执行公式注入转义；不含手机号和个人备注。
- GET /api/admin/audit：查看管理员审计记录。
- GET/POST /api/admin/admins：owner 创建 admin/viewer；POST /api/admin/admins/:id 更新角色或停用状态。

### RBAC

- owner：统计、名单、导出、审计、管理员账号管理。
- admin：统计、名单、导出、审计。
- viewer：仅统计概览。
- owner 账号不允许通过普通管理 API 修改或停用；D1 迁移触发器保护最后一个 active owner。
- 管理员名单和 CSV 不返回手机号、个人备注或验证码。手机号只在同校目录中按本人明确授权展示。

## D1 迁移

本次新增 migrations/0006_admin_rbac.sql，为管理员增加更新时间、最近登录时间和创建者，增加大小写不敏感的用户名唯一索引、会话/审计索引及最后一个 active owner 保护触发器。

先检查远程状态，再按迁移系统应用；不要手动重复执行 SQL：

    npx wrangler d1 migrations list qd58-zhuoyue-db --remote --config backend/wrangler.toml
    npx wrangler d1 migrations apply qd58-zhuoyue-db --remote --config backend/wrangler.toml

## 初始化 owner

见仓库根目录 OPERATIONS-SECURITY.md。脚本 scripts/create-admin.mjs 只生成 PBKDF2 摘要 SQL，不连接数据库。密码通过临时环境变量传入，不得提交密码或生成的 SQL。

## 本地检查

    npm ci
    npm run check:worker
    npm run test:worker
    python backend/tests/schema-smoke.py

远程 D1 迁移、真实短信、Turnstile、部署和浏览器联调均未由本次提交执行。
## 组长转让到期

- 默认待处理转让有效期为 7 天（`TRANSFER_TTL_SECONDS`，允许配置范围 1 小时至 30 天）。
- `backend/migrations/0007_transfer_expiry.sql` 为历史记录补齐到期时间。
- API 在新建、读取和响应转让前执行惰性清理；Worker Cron 每 15 分钟执行兜底清理。
- 过期转让变为 `expired` 并写入系统审计，不会改变当前队长。
