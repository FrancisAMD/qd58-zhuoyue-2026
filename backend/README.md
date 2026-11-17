# 卓越 2026 API（账号生命周期与管理员 RBAC）

Cloudflare Worker + D1 后端。已提交手机号密码认证、Turnstile 服务端校验、阿里云 PNVS 接口适配、个人资料、大学自动组队、组长转让、同校目录，以及独立管理员认证与角色权限。

## 管理员 API

- POST /api/admin/login：独立管理员用户名/密码登录，IP 和用户名摘要双重限流，签发独立 Secure / HttpOnly / SameSite=Strict Cookie。
- POST /api/admin/logout、GET /api/admin/me。
- GET /api/admin/overview：统计概览；viewer 仅获得汇总数字。
- GET /api/admin/people：owner/admin 名单查询，支持 q、province、university、grade、category、page、pageSize。
- GET /api/admin/people?format=csv：最多导出 5000 行，执行公式注入转义；不含手机号和个人备注。\n- GET /api/admin/people?format=xlsx：原生 OOXML 工作簿，沿用相同权限、筛选和上限；所有用户可控单元格均作为文本，不含手机号和个人备注。
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


## 用户账号删除与匿名化

- POST /api/account/delete/request-code：必须先登录；Worker 从当前 Session 读取绑定手机号，校验 Turnstile action 为 `account_delete` 后调用 PNVS。请求体只接收 `turnstileToken`，不接受客户端指定手机号。
- POST /api/account/delete：必须登录，提交当前密码、短信验证码和 `confirmText: "DELETE"`。验证通过后撤销全部用户 Session、清除 OTP 与手机号相关限流键、终止涉及该用户的待处理转让，并清空直接身份资料和授权记录。
- 如果用户是仍有其他有效成员的队伍队长，返回 `409 leader_transfer_required`，必须先完成队长转让。独自担任队长时释放空队伍队长槽位，后续首位新成员可成为新队长。
- 为保持历史转让与审计外键完整，用户行保留不可逆 tombstone：随机用户 ID、`deleted:` 占位号码和删除时间；直接身份字段与密码摘要清空。删除后的用户不能再登录、访问资料或出现在目录/管理员名单中。
- 删除事件只写入不含手机号和姓名的 system audit。历史转让/审计保留随机 ID；数据库备份中的历史快照不会因在线删除自动消失，须按备份保留政策到期清除。

迁移：`0008_account_anonymization.sql`。本次没有对远程 D1 执行迁移。


## 账号删除原子性与测试边界

- 新增 `migrations/0009_account_deletion_atomicity.sql`：只有用户 tombstone 已成功写入时，才允许插入 `account.deleted` 审计事件。该审计插入位于删除 D1 batch 末尾；若用户更新未命中，触发器使整批回滚，避免只撤销 Session/队长/验证码却未匿名化用户资料。
- 删除冲突统一返回 HTTP 409 和 `account_delete_conflict`；仍有队员的队长返回 `leader_transfer_required`。
- `account-deletion-smoke.mjs` 使用假的 D1 与模拟 Turnstile/PNVS HTTP 响应，覆盖会话手机号绑定、验证码发送与核验、错误密码、队长限制、删除后 Session 失效和 batch 冲突回滚。
- 这些是隔离测试，不等同于真实 Cloudflare D1、Turnstile 或阿里云 PNVS 联调；生产环境验证仍待执行。


## 短期认证数据保留与限流标识

- SMS、普通登录和管理员登录的限流桶键使用 RATE_LIMIT_HMAC_SECRET 做 HMAC-SHA256；D1 中不再写入原始手机号、IP 或管理员用户名。
- 部署前必须设置至少 32 字符的 Worker Secret：npx wrangler secret put RATE_LIMIT_HMAC_SECRET --config backend/wrangler.toml。建议使用 32 随机字节（64 个十六进制字符）；密钥需稳定保存，随意轮换会重置已有的限流桶。
- 每 15 分钟的 Cron 维护任务分批清理：验证码在消费/过期满 24 小时后清除；已过期用户和管理员会话清除；旧版含原始标识的限流桶在窗口起点满 24 小时后清除；HMAC 限流桶在窗口起点满 48 小时后清除。
- 每条清理语句最多处理 500 条，避免单次维护长时间占用 D1。审计日志不自动清理，须待组织方确定正式保留周期后再实施。
- 新增迁移：0010_security_data_retention_indexes.sql。远程 D1 未由本次开发执行迁移。


## 管理员登录失败审计

- 登录凭据被拒绝时写入 `admin.login.failed` 系统审计事件，记录原因类别（账号不存在、账号停用或密码不匹配），不记录提交的用户名、IP、密码或请求正文。
- 成功登录仍记录 `admin.login.succeeded`，包含管理员 ID 和角色。
- 格式错误和已触发限流的请求不写失败审计，避免攻击者通过大量无效请求灌满审计表；IP 与用户名维度限流仍由 HMAC 摘要桶执行。
- 如果失败审计写入暂时不可用，登录仍返回统一的 `401 invalid_credentials`，不会向客户端泄露账号是否存在。
- 该审计供具有 `audit:read` 权限的 owner/admin 查看；不构成短信、邮件或即时告警通知。


## 注册与找回短信请求的账号枚举防护

`POST /api/auth/register/request-code` 与 `POST /api/auth/password/request-code` 对已注册/未注册号码返回相同的 `{ok:true}` 响应，不返回阿里云 RequestId。Turnstile 与服务端限流通过后才检查号码是否符合对应流程；不符合条件时不发送短信、不创建 OTP challenge，但保留该请求的限流额度。符合条件时才调用 PNVS。前端提示使用中性文案，避免通过状态码、错误文案或 RequestId 暴露账号状态。此设计不替代短信渠道本身的防滥用限额。


## 原生 Excel（XLSX）名单导出

- `GET /api/admin/people?format=xlsx`：与 CSV 共用相同的 RBAC、筛选条件和最多 5000 行上限。
- 导出列与 CSV 一致；不包含手机号、个人备注、验证码或其他非名单字段。
- XLSX 使用纯 Worker 兼容的 ZIP/XML 生成器，不引入 Node 原生模块或额外运行时依赖；单元格统一写成 inline string，用户可控内容不会被写成 Excel 公式。
- 每次 CSV/XLSX 导出都写入 `admin.people.exported` 审计，元数据包含格式、行数和筛选条件数量，不包含名单内容。
- 管理后台提供独立的 CSV 与 XLSX 下载入口。XLSX 由隔离测试验证 ZIP CRC、XML 结构、中文/特殊字符、筛选、权限、5000 行上限及手机号/备注不泄露。


## 密码生命周期与 Session 凭据版本（2026-11-17）

- 迁移 0011_password_session_version.sql 为 users 与 sessions 增加 auth_version，历史账号和 Session 默认版本为 1。
- 每个用户 Session 必须满足 sessions.auth_version = users.auth_version；密码重置递增用户版本并撤销全部 Session。密码修改递增版本、撤销其他设备，并只把当前 Session 推进到新版本。
- 登录创建 Session 使用密码摘要与 auth_version 的条件 INSERT，避免密码重置发生在密码校验之后时，旧密码仍能建立有效 Session。
- 密码修改和找回密码使用 D1 compare-and-swap（旧密码摘要 + 旧 auth_version），将密码更新、Session 处理和最小化审计放入同一 D1 batch；并发竞争中只有一个请求能成功。
- 密码修改/重置审计只记录动作和随机用户 ID，不记录手机号、旧/新密码、密码摘要、验证码或请求正文。
- 账号删除同时比较已验证的密码摘要与 auth_version，避免密码修改/重置与删除并发时使用过期密码完成删除。
- backend/tests/password-lifecycle-smoke.mjs 覆盖旧 Session 失效、当前 Session 保留、重置后全端退出、验证码重放、旧密码登录竞态和 compare-and-swap 冲突。
- 远程 D1 迁移、真实 PNVS、Turnstile 和生产部署未执行。


## PNVS 验证码挑战持久化（2026-11-17）

- 发送前先在 D1 写入随机 OutId 关联的挑战记录，再调用 `SendSmsVerifyCode`；若 D1 无法保存挑战，不会调用阿里云，也不会产生短信费用。
- 请求使用阿里云服务端生成验证码占位符 `##code##`，设置 6 位数字、300 秒有效期、60 秒间隔、覆盖旧码，并显式设置 `ReturnVerifyCode=false`。应用不接收、不生成、不保存明文验证码，仅保存 `ALIYUN` 标记和 OutId。
- 明确的 PNVS 拒绝会删除挑战并释放本次限流预留；网络超时等结果不确定时保留挑战和额度，因为短信可能已经送达，后续仍可用 `CheckSmsVerifyCode` 核验。
- 新增 `backend/tests/pnvs-challenge-persistence-smoke.mjs`，检查发送参数、挑战先写入、明确拒绝清理、模糊超时恢复及配额处理。测试使用 mock Turnstile/PNVS，不发送真实短信。
