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

## 删除与匿名化（尚未实现）

当前 Worker 尚未提供用户自助删除 API。正式开放前应补充：身份二次验证、组长先完成转让或队伍解散、撤销全部用户 Session、删除 OTP 与登录限流痕迹、清理转让关联、删除或匿名化资料，并保留不含手机号/姓名的必要审计事件。因为现有转让和队长外键存在关联，不能简单执行 DELETE FROM users；必须在事务和外键约束下实现并测试。

活动资料保留期限、删除申请邮箱/负责人、备份到期清除规则仍待组织方确定。以上项目完成前，隐私页明确提示不得开放真实报名。

## 当前边界

本里程碑只提交代码、迁移和文档；没有执行远程 D1 迁移、生成 owner 账号、导出真实数据或部署 Worker/Pages。