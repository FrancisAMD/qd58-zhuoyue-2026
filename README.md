# 青岛五十八中「卓越·2026」返校宣讲平台

面向青岛五十八中校友的登记、大学组队和同校联系平台。前端部署在 Cloudflare Pages，业务 API 运行在 Cloudflare Workers，数据存储使用 D1 和 R2。

- 网站：<https://58er.eon21.space>
- API：<https://api.58er.eon21.space>

## 项目结构

| 目录 / 文件 | 用途 |
| --- | --- |
| `index.html`、`app.js`、`style.css`、`theme.js` | 学生端页面、系统深浅色适配、手机号归属验证注册流程 |
| `admin.html`、`admin.js` | 独立管理员后台 |
| `privacy.html` | 隐私说明 |
| `favicon.svg` | 全站统一站点图标（SVG 矢量） |
| `account-deletion-ui.js`、`ui-sections.css`、`donations.css` | 账号删除交互、页面补充样式、赞助名单样式 |
| `assets/` | 页面图片资源，包括赞助二维码和插画 |
| `data/profile-sources/` | 前端登记表使用的高校、校区、专业门类和招生类型 JSON |
| `data/university-catalog.*` | 高校目录导入的数据格式、Schema 和模板 |
| `backend/src/worker-entry.js` | Worker 入口；先处理账号删除资格检查，再转交主 Worker |
| `backend/src/worker.js` | API 主逻辑：认证、资料、组队、转让、目录、管理员与备份管理 API |
| `scripts/d1-backup-action.mjs`、`.github/workflows/d1-backup.yml` | GitHub Actions 定时导出 D1、分块加密、上传 R2 并回读验证 |
| `backend/src/xlsx.js` | 管理后台 Excel 导出 |
| `backend/src/account-deletion-ledger.js` | 账号删除意图的 R2 台账逻辑 |
| `backend/src/university-catalog-import.js` | 高校目录导入与校验逻辑 |
| `backend/migrations/` | 按编号顺序执行的 D1 数据库迁移 |
| `backend/tests/`、`scripts/` | 自动化测试、数据校验和运维脚本 |
| `backend/wrangler.toml` | Worker、D1、R2、域名和定时任务配置 |

## 使用的 Cloudflare 服务

- **Pages**：从 GitHub 的 `main` 分支发布仓库根目录的静态前端。
- **Workers**：提供 `api.58er.eon21.space`，入口文件为 `backend/src/worker-entry.js`。
- **D1**：数据库名为 `qd58-zhuoyue-db`；表结构变更保存在 `backend/migrations/`。
- **R2**：`GROUP_QR` 保存地区群聊二维码（`qd58-group-chat-qr`）；`D1_BACKUPS` 保存每日 D1 加密备份（私有 Bucket `qd58-d1-backups`）。账号删除台账仍依赖尚未绑定的 `DELETE_LEDGER`，不能据此宣称旧备份恢复后的删除重放已经自动化。

验证码由 Cloudflare Turnstile 与阿里云 PNVS 配合处理。注册前会先核验手机号是否已有账号；该接口要求同意隐私说明，并按 IP 和手机号双重限流。阿里云 AccessKey、Turnstile Secret、限流 HMAC Secret 和备份主密钥通过 Worker Secrets 配置；D1 Export API Token 与 R2 S3 Access Key/Secret 通过 GitHub Actions Repository Secrets 配置。不要写入 Git。短信签名名称与模板编号属于非密钥配置，可写入 `backend/wrangler.toml` 的 `[vars]`。配置中的 `keep_vars = true` 也会保留在 Cloudflare Dashboard 单独管理的普通变量，避免下一次 Wrangler 部署将其清除。

## 本地检查

需要 Node.js、npm、Python。常用命令（另含备份加密专项测试）：

```powershell
npm ci
npm run check:worker
npm run test:worker
npm run test:catalog
python backend/tests/schema-smoke.py
npm run test:backup
```

## 部署

Pages 在 `main` 有新提交后由 Cloudflare Git 集成自动发布。Worker 从仓库根目录部署。每日 D1 备份由 `.github/workflows/d1-backup.yml` 在 GitHub Actions 上运行，需配置 GitHub Repository Secrets；配置方法见 [备份与恢复手册](docs/d1-backup-restore.md)。Worker 后台手动触发 GitHub Actions 还需可选 Secret `GITHUB_BACKUP_DISPATCH_TOKEN`：

```powershell
npx wrangler deploy --config backend/wrangler.toml
# 可选：让后台“立即备份/完整性验证”按钮触发 GitHub Actions
npx wrangler secret put GITHUB_BACKUP_DISPATCH_TOKEN --config backend/wrangler.toml
```

只有新增了 D1 migration 时才需要检查并应用远程迁移：

```powershell
npx wrangler d1 migrations list qd58-zhuoyue-db --remote --config backend/wrangler.toml
npx wrangler d1 migrations apply qd58-zhuoyue-db --remote --config backend/wrangler.toml
```

不要把 D1 导出、备份、管理员引导 SQL、密码或任何密钥提交到仓库。备份与恢复要求见 [docs/d1-backup-restore.md](docs/d1-backup-restore.md)，管理员和安全运维说明见 [OPERATIONS-SECURITY.md](OPERATIONS-SECURITY.md)。
