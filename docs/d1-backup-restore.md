# D1 加密备份、校验与恢复手册

本手册描述仓库中的自动备份实现及其启用步骤。提交代码不代表已经创建 R2 Bucket、配置 Worker Secrets、成功运行真实 D1 导出或完成恢复演练。

## 1. 备份架构

- D1 数据库：`qd58-zhuoyue-db`。
- 导出方式：Cloudflare D1 Export API，导出 D1-compatible SQL。
- 执行器：Cloudflare Workflow `qd58-d1-backup`，每天 18:05 UTC 运行，即日本时间次日 03:05。
- 存储：独立私有 R2 Bucket `qd58-d1-backups`，绑定名 `D1_BACKUPS`。
- 保留期：默认 30 天，`BACKUP_RETENTION_DAYS` 可配置为 7–365 天。只有新备份成功后才会清理过期备份。
- 管理：`/admin.html` 的“数据库备份管理”仅 owner 可访问；普通 admin 无权查看、下载、验证、触发或删除备份。

D1 原生导出期间，数据库可能暂时无法处理查询。计划安排在日本时间 03:05 低访问量时段；备份时间应按真实访问量和数据库规模重新评估。Workflow 会每 10 秒轮询导出状态，最多等待约 30 分钟。上传完成后会自动回读 R2 对象、解密所有分块并验证认证标签与摘要，验证通过后才将备份视为成功。后台仍可再次执行完整性检查。Workflow 配置的并发上限为 1；另有 R2 条件写入的 2 小时导出租约，轮询时续期，任务成功或失败时释放，硬中断后过期租约可被接管，防止定时与手动导出重叠。现有 Worker 每 15 分钟的 D1 维护 Cron 会先检查该租约，在导出进行期间跳过一次维护，随后自动恢复。

## 2. 加密格式

备份文件不以明文 SQL 上传到 R2。

1. 每个备份生成独立 256-bit 随机数据密钥（DEK）。
2. DEK 通过 HKDF-SHA256 从版本化主密钥派生的 AES-256-GCM 包装密钥加密。
3. D1 SQL 导出流按 8 MiB 分块，每块使用独立随机 96-bit nonce 与 AES-256-GCM 加密。
4. 每块的 AAD 绑定备份 ID、块序号和明文长度；清单记录明文/密文长度、nonce、SHA-256。
5. 整份 JSON 清单通过从主密钥派生的独立 HMAC-SHA256 密钥签名。
6. R2 自身还会对静态对象加密；这不替代应用层加密。

R2 对象路径：

- `d1-backups/v1/objects/<backupId>.qd58enc`：只有密文。
- `d1-backups/v1/manifests/<backupId>.json`：签名清单与包装后的 DEK（不含主密钥或明文 DEK）。

主密钥不进入 D1、R2、GitHub、浏览器或审计日志。丢失主密钥会导致对应密钥版本的备份无法恢复。轮换时必须保留旧版本 Secret，直到其所有备份过期。

## 3. 启用前配置

由 Cloudflare 账户管理员执行。先确认当前 Cloudflare 账户和 Wrangler 登录身份正确。

### 3.1 创建专用私有 R2 Bucket

```powershell
npx wrangler r2 bucket create qd58-d1-backups
```

如果 Bucket 已存在，不要重复创建；确认它属于正确账户且没有公开域名或公开访问策略。不要将备份 Bucket 与群聊二维码 Bucket 混用。

### 3.2 创建 Cloudflare API Token

在 Cloudflare Dashboard 创建范围尽量小的 API Token，只授予目标账户的 D1 Edit 权限。不要使用 Global API Key。该 Token 由 Workflow 调用 D1 Export API。

### 3.3 设置 Worker Secrets

```powershell
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID --config backend/wrangler.toml
npx wrangler secret put CLOUDFLARE_API_TOKEN --config backend/wrangler.toml
npx wrangler secret put BACKUP_MASTER_KEY_V1 --config backend/wrangler.toml
```

第三项输入 32 个随机字节的十六进制值（64 个十六进制字符）。可以在本机生成：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

将主密钥同时保存在组织方认可的离线密码管理器或密钥保管设施中，并确保至少一名授权恢复负责人能够按流程取回。不要将主密钥发到聊天、邮件、工单或 GitHub。不要把 API Token 放入 GitHub 文件。

### 3.4 部署 Worker 与 Workflow

```powershell
npx wrangler deploy --config backend/wrangler.toml
```

本功能不新增 D1 表或 migration，不需要运行 `wrangler d1 migrations apply`。它需要当前账户支持 Workflows，并且分块加密的 CPU 用量需要足够的 Workers 计算配额；建议使用 Workers Paid 计划并为 Workflow 配置足够的 CPU step budget。Workers Free 的 Workflow 单步 CPU 配额很低，不能假设 8 MiB 加密分块一定能运行成功。真实部署前应使用 Wrangler dry-run/部署校验确认当前配置和套餐配额。

部署后检查：

```powershell
curl.exe -sS https://api.58er.eon21.space/api/health
```

期望 `build` 为 `encrypted-d1-backup-20261128`，且以下字段均为 `true`：

- `readiness.backupStorageConfigured`
- `readiness.backupWorkflowConfigured`
- `readiness.backupExportConfigured`
- `readiness.backupEncryptionConfigured`

健康检查只证明绑定/配置存在，不证明真实导出、加密、R2 上传或恢复成功。

## 4. 后台使用

所有者登录 `https://58er.eon21.space/admin.html` 后打开“数据库备份管理”：

- 查看最新 100 条备份的状态、时间、大小、分块数和最近完整性验证结果。
- 点击“立即备份”创建一次手动 Workflow。D1 导出可能短暂影响数据库查询，建议仅在低访问量时间段触发。
- 点击“验证完整性”启动完整读取和解密流程，检查每个分块的 AES-GCM 认证标签与 SHA-256。
- 分别下载加密文件（`.qd58enc`）和签名清单（JSON）。
- 可以删除历史备份，但不能删除正在运行的备份，也不能删除最后一份成功备份。

列表不会返回 SQL 内容、手机号或其他用户资料。下载接口只输出密文文件。服务端再次检查 `backups:manage`，不能通过直接调用 API 绕过前端权限。

## 5. 本地解密与完整性校验

从后台把密文和对应清单下载到仓库外的受限目录。不要把明文恢复文件保留在同步盘、公共目录或 Git 仓库。

```powershell
New-Item -ItemType Directory -Force .private-backups
$env:BACKUP_MASTER_KEY_V1 = Read-Host "输入离线保管的 BACKUP_MASTER_KEY_V1"
node scripts/decrypt-d1-backup.mjs --manifest .private-backups/backup.manifest.json --input .private-backups/backup.qd58enc --output .private-backups/restore.sql
Remove-Item Env:BACKUP_MASTER_KEY_V1
python scripts/verify-d1-export.py .private-backups/restore.sql --expected-migration 0019_donation_records.sql
```

解密脚本会先校验清单 HMAC，再逐块验证 AES-GCM 标签、块长度和 SHA-256；遇到错误会删除未完成的明文输出。解密后的 SQL 仍属于高度敏感个人信息，需按受限临时文件管理。

如果未来主密钥版本轮换，需为对应版本设置相应环境变量，例如 `BACKUP_MASTER_KEY_V2`，并调整本地命令使用环境变量。不要删除仍有备份在用的旧版本密钥。

## 6. 仅在独立测试 D1 演练恢复

演练绝不能指向生产库。先创建一个专用测试 D1，确认它的 ID 与生产 D1 ID 不同：

```powershell
npx wrangler d1 create qd58-backup-restore-test
```

在核对解密 SQL 和目标数据库后，按当前 Wrangler 版本支持的导入方式导入测试库。较小文件可使用：

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

## 7. 生产恢复的删除隐私阻断项

**当前实现不提供生产数据库一键恢复，也不能宣称生产恢复已经安全。**

原因是用户删除可能发生在某个备份时间点之后。恢复较早快照会重新带回删除前的姓名、手机号和个人资料。当前项目有账号删除意图 R2 模块，但：

- `DELETE_LEDGER` Bucket 仍未在 `backend/wrangler.toml` 中绑定。
- 删除意图自动重放/对账流程仍未实现。
- 因而还不能可靠地找出并重新匿名化备份时间点之后已删除的账号。

在独立、访问受限、持久的删除台账完成配置、校验、重放和演练之前，不得将较早备份恢复到生产。此限制优先于恢复可用性。

## 8. 当前安全边界

- 默认保留 30 天是技术配置，不代表已通过组织方的个人信息保留政策审批。
- D1 与 R2 仍在同一 Cloudflare 账户内；此方案不能完全应对整个 Cloudflare 账户失陷或被删除。可后续增加独立账户/异地密文副本。
- Cloudflare D1 Time Travel 与 R2 备份是两层不同机制；Time Travel 的可用期限和套餐资格应在 Cloudflare Dashboard 实际确认。
- 当前仓库的测试使用合成数据和 mock API，不会访问生产 D1、发送短信、调用真实 D1 Export、上传真实 R2 备份或完成真实恢复。
