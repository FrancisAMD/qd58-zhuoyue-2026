# 管理员、安全与数据运维方案

## 管理员角色

| 角色 | 能力 |
| --- | --- |
| owner | 全部后台权限：统计、报名名单、CSV/Excel 导出、用户删除、操作审计、赞助名单、高校目录导入/审核、群聊二维码、管理员账号管理 |
| admin | 统计概览、海外高校审核、地区群聊二维码管理 |
| viewer | 已废弃；历史只读账号不能登录，不能再创建，需由所有者在后台删除 |

管理员使用独立的 `__Host-qd58_admin` Secure / HttpOnly / SameSite=Strict Cookie，与同学 Session 分离。普通管理员不能读取或修改报名名单、导出用户资料、查看操作审计、管理赞助名单或管理管理员账号；Worker API 服务端也会拒绝这些请求。

所有者可启用、停用和删除普通管理员或历史只读账号，但不能删除或停用最后一个有效所有者，也不能删除当前登录的所有者账号。删除管理员会级联撤销该账号的 Session。管理员名单与导出不包含手机号和个人备注；手机号仍只按同校目录中的授权规则展示。

## 首位 owner 账号引导

1. 先在 Cloudflare D1 测试库应用所有迁移，确认包含 0001–0011 全部迁移，尤其是 0009_account_deletion_atomicity.sql 与 0011_password_session_version.sql。
2. 在本地 PowerShell 临时输入密码并生成 SQL（密码不会写入脚本或仓库）：

    $secure = Read-Host "输入至少14位管理员密码" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $env:ADMIN_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
      node scripts/create-admin.mjs rootops owner > admin-bootstrap.sql
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
      Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    }

3. 检查生成的 SQL 只包含一条 INSERT INTO admin_users，再通过 Wrangler 应用到目标 D1：

    npx wrangler d1 execute qd58-zhuoyue-db --remote --config backend/wrangler.toml --file admin-bootstrap.sql
    Remove-Item admin-bootstrap.sql

脚本只生成 PBKDF2-SHA256(100000) 密码摘要，不连接数据库，也不会创建远程账号。请在独立终端操作；不要把密码、SQL 摘要或管理员凭据提交到 GitHub。admin-bootstrap.sql 已加入 .gitignore。

### 管理员登录故障快速检查

首位管理员不会由迁移自动创建：迁移 0001 只创建空的 `admin_users` 表；`scripts/create-admin.mjs` 只在本地生成一条含 PBKDF2-SHA256 摘要的 INSERT SQL，不会连接或写入 Cloudflare D1。因此，若当前数据库没有 `active=1` 的管理员记录，登录必定返回通用 `invalid_credentials`。

先只读检查远程目标库（不会修改数据）：

```powershell
npx wrangler d1 execute qd58-zhuoyue-db --remote --config backend/wrangler.toml --command "SELECT username, role, active, last_login_at FROM admin_users ORDER BY created_at;"
```

若没有记录，按上面的“首位 owner 账号引导”生成 SQL，并在核对目标数据库与 SQL 后由有权限的运维人员执行。若记录存在，确认用户名、`active=1`、角色为 `owner`（首位账号），并确认输入的是该记录创建时设置的密码；系统不提供默认管理员口令，也不会在登录失败时自动重置密码。

管理员登录还依赖 Worker Secret `RATE_LIMIT_HMAC_SECRET`。该值缺失或短于 32 字符时，登录会在读取账号/验证密码之前 fail-closed，返回 HTTP 503 `rate_limit_secret_not_configured`，并不会建立 Session。只查看 Secret 名称，不查看或复制其值：

```powershell
npx wrangler secret list --config backend/wrangler.toml
```

如列表中没有 `RATE_LIMIT_HMAC_SECRET`，先在本机生成随机值，再通过 Wrangler 的交互提示设置；不要将值发到聊天或写入仓库：

```powershell
$rateLimitSecret = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$rateLimitSecret | npx wrangler secret put RATE_LIMIT_HMAC_SECRET --config backend/wrangler.toml
Remove-Variable rateLimitSecret
```

后台页面现在会分别提示无效凭据、限流密钥缺失、`APP_ORIGIN` 不匹配和 Worker 内部错误。若登录 POST 返回 200、但随后 `GET /api/admin/me` 返回 401，应在浏览器开发者工具的 Network 面板检查登录响应是否有 `Set-Cookie`、后续请求是否携带 `__Host-qd58_admin`；不要复制或分享 Cookie 值。前端来源必须精确为 `https://58er.eon21.space`，Worker 的 `APP_ORIGIN` 也必须精确匹配。

以上只用于故障定位；执行远程查询、Secret 配置或 D1 写入前，必须确认当前 Wrangler 登录身份、目标账户、目标数据库及生产变更授权。不要在诊断时清空或重建 `admin_users`。

## 用户删除与匿名化

已实现用户自助删除 API，要求登录态、当前密码、绑定手机号短信验证码和明确输入 `DELETE`。短信请求必须先通过 Turnstile；验证码有效期沿用 PNVS 5 分钟配置、服务端限制 60 秒冷却和手机号/IP 配额。删除请求只从当前 Session 取得手机号，不接受客户端传入其他号码。

队长若仍有其他有效队员，必须先完成队长转让；独自担任队长时才允许释放队长槽位。删除事务会终止关联的 pending 转让、撤销全部用户 Session、删除 OTP 和手机号相关限流记录、清空手机号/密码/姓名/学校/班级/大学/年级/地区/备注/手机号授权/同意记录，并写入不含直接身份信息的 system audit。

为保留历史转让和审计外键完整性，不物理删除 users 行，而是写入不可逆 tombstone（随机用户 ID、`deleted:` 占位号码、删除时间）。删除账户不能重新激活；同一手机号可重新注册新账号。删除后的账号从登录、目录、管理员名单和统计中排除。历史转让/审计仅保留随机 ID；备份中的历史快照仍须按备份保留规则到期清除。

## GitHub Actions 加密 D1 备份与恢复操作

### 自动备份架构

- GitHub Actions Workflow：`.github/workflows/d1-backup.yml`，每天 18:05 UTC（日本时间次日 03:05）计划执行；使用标准 `ubuntu-latest` Runner，不消耗 Cloudflare Worker CPU。
- Runner 调用 Cloudflare D1 Export API，持续轮询至导出完成，在临时目录将 SQL 按 8 MiB 分块使用 AES-256-GCM 加密，再通过 R2 S3-compatible API 上传到私有 Bucket `qd58-d1-backups`。
- 上传后 Runner 从 R2 回读密文、解密并验证每个分块的认证标签与 SHA-256；只有验证通过才写入 `completed` 签名清单。
- Worker 的 `D1_BACKUPS` binding 仅负责 owner-only 后台列举、下载、验证任务分发和删除；Worker 不执行 D1 导出、加密或上传。
- D1 原生导出期间数据库可能暂时无法处理查询。GitHub schedule 可能延迟，不能保证精确 03:05 开始；查看 Actions 运行历史，失败后可以手动重试。

### GitHub Repository Secrets

在 GitHub 仓库 `Settings → Secrets and variables → Actions` 中创建：

| Secret | 内容 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | 仅具备目标 D1 Edit 权限的 Token |
| `BACKUP_MASTER_KEY_V1` | 与 Worker Secret 完全相同的 32-byte 随机主密钥 |
| `R2_ACCESS_KEY_ID` | 仅应用于备份 Bucket 的 R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 对应 R2 Secret Access Key |

R2 API Token 必须限定为 Bucket `qd58-d1-backups` 的 Object Read & Write。D1 Export API Token 与 R2 S3 凭据是两套独立凭据。不要使用 Cloudflare Global API Key。

主密钥仅在本机生成并离线保管：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

将同一值设置为 GitHub Repository Secret 与 Worker Secret `BACKUP_MASTER_KEY_V1`。丢失密钥会使对应版本备份无法解密；轮换时保留旧版本密钥，直到相关备份全部过期。

### Worker 后台手动触发（可选）

要让后台“立即备份”和“验证完整性”按钮分发 GitHub Actions，需要创建 Fine-grained personal access token：

- Repository access 只选择 `FrancisAMD/qd58-zhuoyue-2026`。
- Repository permissions 只授予 `Actions: Read and write`。
- 作为 Worker Secret 设置，不要写进 GitHub 仓库文件：

```powershell
npx wrangler secret put GITHUB_BACKUP_DISPATCH_TOKEN --config backend/wrangler.toml
```

该 Secret 是可选的，不在 `secrets.required` 中。未设置时，每日 schedule 不受影响；owner 可直接进入 GitHub Actions 页面手动运行 `d1-encrypted-backup` Workflow。

之前 Cloudflare Workflow 方案中的 Worker Secrets `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` 现在不再需要。当前 Worker 只需要 `BACKUP_MASTER_KEY_V1` 进行清单校验。

### 后台操作与保留

- 后台“数据库备份管理”仅 owner 可访问。可查看备份状态、大小、验证结果；支持立即备份、验证、下载密文/清单和删除。
- 手动触发与验证由 Worker 调 GitHub workflow_dispatch API；该动作需要可选的 `GITHUB_BACKUP_DISPATCH_TOKEN`。所有手动触发、验证和删除均写入管理员审计。
- Actions 默认保留 30 天；新备份通过 R2 回读验证后才清理过期对象；保留至少一份最新成功备份。
- 下载文件只有 `.qd58enc` 密文和 JSON 清单。不会向浏览器返回明文 SQL 或主密钥。

### 本地解密与恢复演练

从后台分别下载密文和签名清单，放在仓库外的受限临时目录：

```powershell
New-Item -ItemType Directory -Force .private-backups
$env:BACKUP_MASTER_KEY_V1 = Read-Host "输入离线保管的 BACKUP_MASTER_KEY_V1"
node scripts/decrypt-d1-backup.mjs --manifest .private-backups/backup.manifest.json --input .private-backups/backup.qd58enc --output .private-backups/restore.sql
Remove-Item Env:BACKUP_MASTER_KEY_V1
python scripts/verify-d1-export.py .private-backups/restore.sql --expected-migration 0019_donation_records.sql
```

之后只导入专用测试 D1（绝不能指向生产库），检查 `PRAGMA integrity_check`、外键、迁移版本和关键表数量，再用合成账号测试登录、同校目录和后台权限。演练后销毁测试库与明文 SQL。

### 生产恢复安全阻断项

**当前后台不提供生产数据库一键恢复。**

账号删除可能发生在备份时间点之后；恢复较早的快照会重新带回删除前的手机号、姓名和个人资料。当前 `DELETE_LEDGER` Bucket 仍未绑定，删除意图自动重放与对账也未完成。该阻断项解决并演练之前，不得将较早快照恢复到生产。


## 当前边界

本里程碑只提交代码、迁移和文档；没有执行远程 D1 迁移、生成 owner 账号、导出真实数据或部署 Worker/Pages。

## 短期认证数据保留与限流密钥（2026-11-15）

- 新增 Worker Secret：RATE_LIMIT_HMAC_SECRET，至少 32 字符，建议使用 32 个随机字节生成的 64 位十六进制字符串。设置命令：npx wrangler secret put RATE_LIMIT_HMAC_SECRET --config backend/wrangler.toml。不要提交到 GitHub、聊天或前端变量。
- 可在本机生成随机值：node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"，再将输出粘贴到 Wrangler 的 Secret 输入提示中。所有环境应分别设置；密钥须妥善备份，随意轮换会使现有限流桶失效。
- SMS、普通账号登录和管理员登录的限流键现为带作用域前缀的 HMAC-SHA256 摘要，D1 不再保存原始手机号、IP 地址或管理员用户名。若缺少密钥，涉及限流的短信/登录接口 fail-closed 并返回 503。
- Cron 每 15 分钟执行一次分批清理：已消费或过期满 24 小时的验证码挑战、已过期用户/管理员 Session、旧版原始标识限流桶（窗口起点满 24 小时）及 HMAC 限流桶（窗口起点满 48 小时）。每张表每轮最多清理 500 条，积压会在后续轮次继续清理。
- 审计日志不自动清理；在组织方确定活动数据和审计保留期限之前，不擅自删除审计历史。
- 新增索引迁移：backend/migrations/0010_security_data_retention_indexes.sql。本次仅提交代码和迁移，未执行远程 D1 迁移或 Worker 部署。


## 密码版本迁移（0011）

应用 0011_password_session_version.sql 后，既有用户和 Session 均从版本 1 开始，不会因迁移本身被强制退出。之后每次密码修改/重置会递增 users.auth_version；Session 只有在版本相同的情况下有效。密码修改保留当前设备并撤销其他设备；密码重置撤销全部设备。远程执行前必须先用 Wrangler 检查迁移历史，禁止跳过或重复执行。


## PNVS 短信发送可靠性（2026-11-17）

验证码由阿里云 PNVS 服务端生成和核验。Worker 使用 `TemplateParam={"code":"##code##","min":"5"}`、6 位数字、300 秒有效期、60 秒间隔、覆盖旧验证码，并显式关闭验证码回传。应用数据库只保存随机 OutId 关联、有效期和挑战用途，不保存明文验证码。

发送前先持久化 challenge：D1 写入失败时不会调用阿里云；阿里云明确拒绝时删除挑战并释放限流预留；网络超时等结果不确定时保留挑战和限流额度，避免短信实际送达后无法核验或立即重复发送。真实模板变量名称、签名、模板 Code 与控制台审批状态仍需在生产环境核对。


## PNVS 签名与模板启用前检查

`ALIBABA_SIGN_NAME` 和 `ALIBABA_TEMPLATE_CODE` 是非密钥配置，但必须使用号码认证服务控制台中已获批、适用于当前业务场景的实际值。文档中的“恒创联众”和“100001”只是接口示例，不应直接作为生产默认值。请确认模板变量名与 Worker 发送的 `code`、`min` 一致后，再写入 `backend/wrangler.toml` 的 `[vars]`。任一值缺失时 Worker 会拒绝发送；不要通过聊天传递 AccessKey Secret。


## 浏览器 API 请求来源校验（2026-11-27）

- 前端来源配置为 `APP_ORIGIN=https://58er.eon21.space`；API 位于独立子域名 `api.58er.eon21.space`。浏览器请求到 API 时，`Origin` 应是前端来源，而不是 API 主机名。
- Worker 对所有非安全方法（除 GET、HEAD 外的请求方法）强制要求 `Origin` 与非空的 `APP_ORIGIN` 完全相等。缺失、`null`、外部来源、同站其他子域名来源以及 APP_ORIGIN 未配置时，统一返回 403 `origin_forbidden`。
- `OPTIONS` 预检同样必须带有完全匹配的 Origin；未匹配的预检返回 403，不发出允许跨域的响应头。
- 只有公开的 GET/HEAD 健康检查（`/api/health`）和高校目录读取（`/api/universities`）允许在没有 Origin 时访问；如果这两个公开端点携带了 Origin，该 Origin 仍必须精确匹配。其他所有路由（包括会延迟处理过期转让或追加审计日志的 GET）都必须带精确匹配的 Origin。不得把会改变用户资料、队伍归属或权限的操作设计为 GET/HEAD。
- 此校验是浏览器写请求的来源防护；CORS 本身不等于 CSRF 防护。当前 API 面向指定网站浏览器使用，缺少 Origin 的非浏览器写请求会被拒绝。
- 修改后应通过 Worker smoke test 验证：正确 Origin、缺失 Origin、`Origin: null`、错误来源、正确/错误预检，以及无 Origin 的安全 GET。
