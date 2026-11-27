# Worker API 与 D1 后端

本目录是 Cloudflare Workers + D1 的后端实现。Worker 配置位于 `wrangler.toml`，入口为 `src/worker-entry.js`；入口会先处理账号删除资格预检，再把其余请求交给 `src/worker.js`。

主要模块：

- `src/worker.js`：登录注册、Turnstile/阿里云 PNVS、资料、高校组队、组长转让、同校目录、管理员 API。
- `src/xlsx.js`：原生 XLSX 导出。
- `src/university-catalog-import.js`：高校目录分阶段导入。
- `src/account-deletion-ledger.js`：账号删除意图 R2 台账。
- `migrations/`：D1 数据库迁移；只按迁移系统检查并应用，不要手动重复执行 SQL。
- `tests/`：Worker 与 D1 行为的隔离 smoke tests。

## 管理员权限

- **owner**：全部后台权限，包括报名名单、CSV/Excel 导出、用户删除、操作审计、赞助名单、高校目录导入/审核、群聊二维码，以及管理员账号管理。
- **admin**：仅统计概览、高校审核和地区群聊二维码管理。
- **viewer**：已废弃；旧只读账号不能再登录，新账号也不能创建。所有者可在后台删除遗留账号。

管理员独立使用 `__Host-qd58_admin` Cookie。普通管理员无法读取或修改报名名单、导出用户资料、查看审计或管理管理员账号；这些限制同时由 Worker API 服务端执行。

## 常用命令

在仓库根目录运行：

```powershell
npm ci
npm run check:worker
npm run test:worker
python backend/tests/schema-smoke.py
npx wrangler deploy --config backend/wrangler.toml
```

远程 D1 迁移前，先执行 `wrangler d1 migrations list` 确认状态。管理员初始化、Secrets、备份和恢复操作说明见仓库根目录的 `OPERATIONS-SECURITY.md` 与 `docs/d1-backup-restore.md`。

---

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


### PNVS 签名与模板配置必须来自控制台

仓库不再提供示例签名或示例模板 Code 作为默认值。只有在号码认证服务控制台确认已获批、且模板变量与 `code` / `min` 匹配后，才在 `backend/wrangler.toml` 的 `[vars]` 中填写 `ALIBABA_SIGN_NAME` 与 `ALIBABA_TEMPLATE_CODE`。两项任意缺失时 Worker fail-closed，返回 `sms_not_configured`，不会调用 PNVS 或发送短信。AccessKey 仍只通过 Worker Secrets 配置。


## 短信限流预留的并发窗口安全（2026-11-18）

- 短信发送的冷却、手机号日限额和 IP 小时限额均通过单条 UPSERT 原子预留；预留语句使用 SQLite `RETURNING window_started_at` 返回本次实际更新的窗口起点。
- 不再通过第二条 SELECT 获取预留窗口，避免并发请求在两条语句之间推进窗口后，失败回滚误减新窗口中的其他请求计数。
- PNVS 明确拒绝或发送前 D1 失败时，仍只按原始窗口起点释放本次预留；PNVS 结果不确定时保留挑战与额度。
- `pnvs-challenge-persistence-smoke.mjs` 增加窗口切换竞态模拟。无需数据库迁移；此测试不代替真实 D1/PNVS 联调。


## 登录密码验证的时间侧信道缓解（2026-11-18）

- 普通用户与管理员登录在账号不存在、管理员停用或密码摘要格式损坏时，仍执行一次固定成本的 PBKDF2-SHA256 验证；使用进程内 dummy salt/expected digest，不写入 D1，不可能作为有效凭据通过。
- 已存在账号的错误密码与不存在账号的登录路径执行相同次数的 PBKDF2 派生，减少通过响应耗时枚举账号的机会；公开响应仍使用统一认证错误。
- 普通用户登录密码输入限制为最多 128 个字符；密码修改也限制当前密码长度，避免超长输入放大 KDF 资源消耗。
- 隔离测试通过包装 Web Crypto deriveBits，验证未知/停用/密码错误路径各执行一次 PBKDF2，限流请求不执行 KDF。
- 该措施降低时间侧信道，不承诺消除网络抖动、数据库查询和运行时调度带来的所有统计差异。


## 验证码挑战生命周期与并发保护

- 新增迁移 `0012_otp_challenge_lifecycle.sql`，为挑战记录增加 `superseded_at`。
- 同一手机号、同一用途重新请求验证码时，旧的未消费挑战会与新挑战写入放在同一 D1 batch 中原子覆盖/创建。若新挑战无法持久化，batch 回滚，旧挑战不受影响。
- 出于安全考虑，即使 PNVS 明确拒绝新短信，旧验证码也不会恢复；用户需要重新请求验证码。
- 验证尝试通过条件 UPDATE + RETURNING 原子占用，严格限制最大次数；PNVS 返回 PASS 后还会再次检查挑战未过期、未覆盖且未消费，防止外部核验期间状态变化。
- 注册、密码重置和账号删除使用各自独立的 `purpose`，不能跨用途使用挑战。
- `npm run test:worker` 包含 OTP 生命周期专项模拟测试。模拟测试不替代真实 PNVS/Cloudflare D1 联调。
