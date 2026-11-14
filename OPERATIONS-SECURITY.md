# 管理员、安全与数据运维方案

## 管理员角色

| 角色 | 能力 |
|---|---|
| owner | 汇总概览、名单查询/筛选、CSV 导出、审计查询、创建和停用 admin/viewer |
| admin | 汇总概览、名单查询/筛选、CSV 导出、审计查询 |
| viewer | 仅汇总概览，不读取个人名单或审计明细 |

管理员使用独立的 __Host-qd58_admin Secure / HttpOnly / SameSite=Strict Cookie，与同学登录 Session 完全分离。管理员登录按 IP 与用户名摘要限流；停用账号后，服务端立即拒绝其旧 Session。最后一个 active owner 不能被停用或删除。

管理员名单与 CSV 不返回手机号和个人备注。手机号仍只由同校目录按本人明确授权展示；管理员角色不能绕过此范围。名单查询、CSV 导出、审计查看和管理员账号变更写入 audit_logs。

## 首位 owner 账号引导

1. 先在 Cloudflare D1 测试库应用所有迁移，确认包含 0006_admin_rbac.sql。
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

## 备份建议（尚未执行）

- 正式收集数据后，建议每天导出一次 D1，并启用 Cloudflare D1 Time Travel（按当前账户套餐和数据库设置确认可用性）。
- 导出文件包含个人信息，应加密保存到受限访问的独立存储，不得放入 Git 仓库、公开 R2 bucket 或普通聊天附件。
- 建议先确定保留周期（例如最近 30 天日备份），并每月在独立测试数据库演练恢复；具体周期需要活动组织方确认后写入正式隐私说明。
- Wrangler 命令格式以当前安装版本为准，执行前先运行 npx wrangler d1 export --help。典型导出命令为：

    New-Item -ItemType Directory -Force .private-backups
    npx wrangler d1 export qd58-zhuoyue-db --remote --output .private-backups/qd58-backup.sql --config backend/wrangler.toml

- 不要在生产库上试验恢复。恢复演练必须使用独立 D1 数据库，并核对行数、迁移版本和关键关系。

## 用户删除与匿名化

已实现用户自助删除 API，要求登录态、当前密码、绑定手机号短信验证码和明确输入 `DELETE`。短信请求必须先通过 Turnstile；验证码有效期沿用 PNVS 5 分钟配置、服务端限制 60 秒冷却和手机号/IP 配额。删除请求只从当前 Session 取得手机号，不接受客户端传入其他号码。

队长若仍有其他有效队员，必须先完成队长转让；独自担任队长时才允许释放队长槽位。删除事务会终止关联的 pending 转让、撤销全部用户 Session、删除 OTP 和手机号相关限流记录、清空手机号/密码/姓名/学校/班级/大学/年级/地区/备注/手机号授权/同意记录，并写入不含直接身份信息的 system audit。

为保留历史转让和审计外键完整性，不物理删除 users 行，而是写入不可逆 tombstone（随机用户 ID、`deleted:` 占位号码、删除时间）。删除账户不能重新激活；同一手机号可重新注册新账号。删除后的账号从登录、目录、管理员名单和统计中排除。历史转让/审计仅保留随机 ID；备份中的历史快照仍须按备份保留规则到期清除。

## 备份与恢复（操作方案，尚未执行）

- 生产报名开始前，必须确定数据保留期限、备份保留周期、备份负责人和删除申请联系渠道。当前建议每日 D1 导出、加密保存、滚动保留 30 天；每月在独立测试 D1 做一次恢复演练。此周期是待组织方确认的建议，不是已生效的承诺。
- 导出文件包含个人信息，必须在本地受限目录生成后立即使用组织方认可的加密方式加密，并存入受限、启用访问审计的存储。禁止提交 Git、放入公开 R2 bucket 或通过普通聊天传输。
- 导出前检查当前 Wrangler 版本支持的参数：`npx wrangler d1 export --help`。示例：`npx wrangler d1 export qd58-zhuoyue-db --remote --output .private-backups/qd58-backup.sql --config backend/wrangler.toml`。导出、加密、上传、清理必须由受权运维人员执行。
- 恢复演练必须使用独立 D1 数据库，不覆盖生产库；验证迁移版本、用户/大学/队伍/转让数量、外键完整性、删除 tombstone 和管理员 owner 数量。演练完成后安全销毁临时副本。
- 在线删除不会即时改写既有备份；备份到期删除前，受限备份中可能仍包含删除前快照。隐私说明应明确这一点。

正式开放真实报名前，仍须确定负责人/申请邮箱、资料保留期限与备份周期，并完成远程迁移、owner 初始化、恢复演练和端到端安全测试。

## 当前边界

本里程碑只提交代码、迁移和文档；没有执行远程 D1 迁移、生成 owner 账号、导出真实数据或部署 Worker/Pages。