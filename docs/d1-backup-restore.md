# D1 加密备份、校验与恢复手册

本手册描述当前的 GitHub Actions + Cloudflare D1 + R2 自动备份实现。提交代码、创建凭据或配置 Secret 都不代表真实备份已经成功；首次生产备份仍须手动触发并确认 R2 中已出现通过验证的清单与密文对象。

## 1. 备份架构

- D1 数据库：`qd58-zhuoyue-db`（ID 写在 `.github/workflows/d1-backup.yml` 中）。
- 执行器：GitHub Actions Workflow `.github/workflows/d1-backup.yml`，每天 18:05 UTC 计划触发，即日本时间次日 03:05。
- 导出：Cloudflare D1 Export API，输出可重新导入 D1 的 SQL；导出期间 D1 可能暂时无法处理查询，必须持续轮询。
- 加密与上传：GitHub-hosted `ubuntu-latest` 临时 Runner 执行 Node.js 加密和 AWS CLI 上传；不使用 Cloudflare Workers CPU 或 Cloudflare Workflows 执行备份。
- 存储：私有 R2 Bucket `qd58-d1-backups`，对象通过 R2 S3-compatible API 上传；Worker 的 `D1_BACKUPS` binding 继续用于后台列举、下载和删除。
- 保留期：默认 30 天，Action 成功后清理过期备份；至少保留一份最新成功备份。
- 管理：`/admin.html` 的“数据库备份管理”仅 owner 可访问。普通 admin 无权查看、下载、验证、触发或删除备份。

GitHub Actions 定时任务使用 UTC cron，计划时间为日本时间 03:05。GitHub 官方说明，定时任务在高负载时可能延迟；因此备份时间是目标时间而非精确执行保证。若当天未执行，可从 GitHub Actions 页面手动运行。

## 2. 加密格式

备份文件不以明文 SQL 上传到 R2。

1. 每个备份生成独立 256-bit 随机数据密钥（DEK）。
2. DEK 通过 HKDF-SHA256 从版本化主密钥派生的 AES-256-GCM 包装密钥加密。
3. D1 SQL 导出文件按 8 MiB 分块，每块使用独立随机 96-bit nonce 与 AES-256-GCM 加密。
4. 每块的 AAD 绑定备份 ID、块序号和明文长度；清单记录明文/密文长度、nonce、SHA-256。
5. 整份 JSON 清单通过从主密钥派生的独立 HMAC-SHA256 密钥签名。
6. 文件上传完成后，Action 从 R2 下载密文回读，逐块解密并验证 GCM 认证标签与 SHA-256；通过后才上传 `status=completed` 的签名清单。
7. R2 本身还会对静态对象加密；这不替代应用层加密。

R2 对象路径：

- `d1-backups/v1/objects/<backupId>.qd58enc`：只有密文。
- `d1-backups/v1/manifests/<backupId>.json`：签名清单与包装后的 DEK（不含主密钥或明文 DEK）。

主密钥不进入 D1、R2、GitHub 日志、浏览器或审计日志。GitHub Actions 会把导出的明文 SQL 暂存在 Runner 的临时目录，完成后删除临时目录，不上传 GitHub Artifacts。丢失主密钥会导致对应密钥版本的备份无法恢复。轮换时必须保留旧版本 Secret，直到其所有备份过期。

## 3. 一次性配置

### 3.1 Cloudflare 资源

确认以下资源已经创建：

- R2 Bucket：`qd58-d1-backups`，保持私有，不绑定公开访问域名。
- D1 Export API Token：只授予目标 Cloudflare 账户的 D1 Edit 权限，不使用 Global API Key。
- R2 API Token：Object Read & Write，并且只应用于 `qd58-d1-backups` 这个 Bucket。记录 Access Key ID 和 Secret Access Key；Secret Access Key 只会显示一次。

D1 API Token 与 R2 S3 API 凭据是两套不同凭据，不能互相替代。

### 3.2 GitHub Actions Repository Secrets

打开 GitHub 仓库：

`Settings → Secrets and variables → Actions → New repository secret`

设置下列五项 Repository Secrets：

| Secret 名称 | 内容 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | 具有目标 D1 Edit 权限的 API Token |
| `BACKUP_MASTER_KEY_V1` | 与 Worker 上完全相同的 32 字节备份主密钥 |
| `R2_ACCESS_KEY_ID` | 限定到备份 Bucket 的 R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 对应 R2 Secret Access Key |

主密钥必须与 Worker Secret `BACKUP_MASTER_KEY_V1` 完全一致。若之前只在 Cloudflare Worker 中设置过该密钥，还要将同一个值再保存为 GitHub Repository Secret；不要生成第二个不同的密钥。

主密钥在本机生成示例（只在本机生成和保存，不要粘贴到聊天或提交 Git）：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`D1_DATABASE_ID` 已固定在 Workflow 文件中：`3d32e597-57e9-4e52-833b-98bdec7ffb0b`。Bucket 名称和保留期也在 Workflow 中配置。修改数据库或 Bucket 时需同步修改 Workflow。

### 3.3 Worker 侧配置

Worker 需要：

- R2 binding：`D1_BACKUPS` → `qd58-d1-backups`。
- 必需 Secret：`BACKUP_MASTER_KEY_V1`，与 GitHub Actions Secret 相同。
- 可选 Secret：`GITHUB_BACKUP_DISPATCH_TOKEN`，用于让后台“立即备份”和“验证完整性”按钮触发 GitHub Actions。

可选 PAT 的创建方式：

1. 在 GitHub 创建 Fine-grained personal access token。
2. Repository access 只选择 `FrancisAMD/qd58-zhuoyue-2026`。
3. Repository permissions 中只授予 `Actions: Read and write`。
4. 将 token 保存为 Worker Secret：

```powershell
npx wrangler secret put GITHUB_BACKUP_DISPATCH_TOKEN --config backend/wrangler.toml
```

这是后台按钮的可选授权，不属于每日自动备份所需的 GitHub Actions Secret。未配置时，定时备份仍会运行；所有者仍可从仓库的 Actions 页面手动运行，只是后台按钮会提示未配置。

如果之前按 Cloudflare Workflow 方案在 Worker 中设置过 `CLOUDFLARE_ACCOUNT_ID` 或 `CLOUDFLARE_API_TOKEN`，新方案不再使用它们；它们不再列入 `backend/wrangler.toml` 的必需 Secret。GitHub Actions 必须单独配置同名 Repository Secrets。

## 4. 部署与检查

先同步仓库：

```powershell
git pull --ff-only origin main
```

Worker 配置已移除 Cloudflare Workflow 绑定和 300,000 ms CPU 上限，不新增 D1 migration。部署：

```powershell
npx wrangler deploy --config backend/wrangler.toml
```

随后确认：

- `https://api.58er.eon21.space/api/health` 的 `backupStorageConfigured` 与 `backupEncryptionConfigured` 为 `true`。
- 如果已设置 `GITHUB_BACKUP_DISPATCH_TOKEN`，`backupDispatchConfigured` 应为 `true`。
- GitHub 仓库的 Actions 页面已启用 Actions，且出现 `d1-encrypted-backup` Workflow。
- GitHub Repository Secrets 的五项名称与表格一致。

健康检查只证明 Worker 绑定和本地密钥存在，不证明 GitHub Secrets、真实 D1 导出、R2 上传或恢复已经成功。

## 5. 运行备份

### 自动运行

Workflow 每天日本时间 03:05 计划运行。导出期间 D1 可能暂时无法处理查询，因此应安排在低访问量时段。Cloudflare D1 Export API 必须被持续轮询；若轮询中断，导出会取消。

### 后台手动运行

所有者登录 `https://58er.eon21.space/admin.html`，打开“数据库备份管理”，点击“立即备份”。Worker 使用可选的 `GITHUB_BACKUP_DISPATCH_TOKEN` 触发 GitHub Actions 的 `workflow_dispatch`，并把备份 ID 与管理员随机 ID 作为输入。审计表记录手动触发动作，不记录任何 Secret。

### GitHub Actions 页面手动运行

打开仓库的 Actions → `d1-encrypted-backup` → Run workflow。选择：

- `backup`：创建新备份。
- `verify`：验证已有备份，并填写 `backup_id`。

可用此方式作为后台手动触发授权未配置时的备用操作。

## 6. 后台管理与保留

- 后台“数据库备份管理”仅 owner 可访问。可查看最近 100 条备份的状态、时间、加密大小、分块数和验证状态。
- 可手动触发备份、再次启动完整性验证、下载加密对象、下载签名清单和删除备份。
- 服务端再次检查 `backups:manage`，普通 admin 无权访问。删除成功备份时，最后一份成功备份受到保护。
- R2 Bucket 使用私有 S3 API；Worker 对象接口只返回密文，不会向浏览器输出明文 SQL 或备份主密钥。
- 默认保留最近 30 天。只有新备份通过 R2 回读验证并写入成功清单后才清理过期对象。失败或不可验证的清单不会被自动清理。

## 7. 本地解密与完整性校验

从后台分别下载加密文件和签名清单，保存到仓库外的受限目录。不要把明文恢复文件保留在同步盘、公共目录或 Git 仓库。

```powershell
New-Item -ItemType Directory -Force .private-backups
$env:BACKUP_MASTER_KEY_V1 = Read-Host "输入离线保管的 BACKUP_MASTER_KEY_V1"
node scripts/decrypt-d1-backup.mjs --manifest .private-backups/backup.manifest.json --input .private-backups/backup.qd58enc --output .private-backups/restore.sql
Remove-Item Env:BACKUP_MASTER_KEY_V1
python scripts/verify-d1-export.py .private-backups/restore.sql --expected-migration 0019_donation_records.sql
```

解密脚本会先校验清单 HMAC，再逐块验证 AES-GCM 标签、块长度和 SHA-256；遇到错误会删除未完成的明文输出。解密后的 SQL 仍属于高度敏感个人信息，需按受限临时文件管理。

## 8. 仅在独立测试 D1 演练恢复

演练绝不能指向生产库。先创建专用测试 D1，确认它的 ID 与生产 D1 ID 不同：

```powershell
npx wrangler d1 create qd58-backup-restore-test
```

在核对解密 SQL 和目标数据库后，使用当前 Wrangler 版本支持的导入方式导入测试库：

```powershell
npx wrangler d1 execute qd58-backup-restore-test --remote --file .private-backups/restore.sql --config backend/wrangler.toml
```

导入后至少检查：

- `PRAGMA integrity_check` 返回 `ok`。
- `PRAGMA foreign_key_check` 不返回违规行。
- D1 migrations 版本与导出时一致。
- 用户（包括 tombstone）、高校、队伍、组长转让、管理员数量与导出数据一致。
- 使用合成账号测试登录、同校目录、组队/转让和后台权限。
- 演练结束后按数据处理规范销毁测试数据库、明文 SQL 和临时副本。

导入命令成功不等于恢复演练完成，仍须通过应用层检查。

## 9. 生产恢复的删除隐私阻断项

**当前后台不提供生产数据库一键恢复，也不能宣称生产恢复已经安全。**

原因是用户删除可能发生在某个备份时间点之后。恢复较早快照会重新带回删除前的姓名、手机号和个人资料。当前项目有账号删除意图 R2 模块，但：

- `DELETE_LEDGER` Bucket 仍未在 `backend/wrangler.toml` 中绑定。
- 删除意图自动重放/对账流程仍未实现。
- 因而还不能可靠地找出并重新匿名化备份时间点之后已删除的账号。

在独立、访问受限、持久的删除台账完成配置、校验、重放和演练之前，不得将较早备份恢复到生产。此限制优先于恢复可用性。

## 10. 当前安全边界

- 默认保留 30 天是技术配置，不代表已通过组织方的个人信息保留政策审批。
- GitHub Actions 使用标准 `ubuntu-latest` Runner，公开仓库标准 Runner 的计费政策请以 GitHub 官方 Actions 定价说明为准；不要切换到 Larger Runner。
- GitHub Runner 只在临时目录处理明文 SQL，不上传 GitHub Artifacts，不打印 SQL 或签名下载 URL；任务退出时删除临时目录。
- GitHub Repository Secrets 仅供主分支上受信任的 Workflow 使用。公开仓库应限制主分支写权限，审查 Workflow 和备份脚本修改，避免不可信提交读取 Secrets。
- R2 S3 API 凭据应限制为 `qd58-d1-backups` Bucket 的 Object Read & Write；Cloudflare D1 API Token 应只拥有目标账户所需的 D1 Edit 权限。
- GitHub Actions 定时任务在高负载时可能延迟；应查看 Actions 运行历史，并在失败时手动重试。
- D1 与 R2 仍在同一个 Cloudflare 账户内；该副本不能完全应对整个 Cloudflare 账户失陷或被删除。重要数据后续可增加独立账户/异地密文副本。
- Cloudflare D1 Time Travel 与 R2 备份是两层不同机制；Time Travel 的可用期限和套餐资格应在 Cloudflare Dashboard 实际确认。
- 当前仓库的测试使用合成数据和 mock API，不会访问生产 D1、发送短信、调用真实 D1 Export、上传真实 R2 备份或完成真实恢复。
