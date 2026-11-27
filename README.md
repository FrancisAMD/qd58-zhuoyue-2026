# 青岛五十八中「卓越·2026」返校宣讲平台

面向青岛五十八中校友的登记、大学组队和同校联系平台。前端部署在 Cloudflare Pages，业务 API 运行在 Cloudflare Workers，数据存储使用 D1 和 R2。

- 网站：<https://58er.eon21.space>
- API：<https://api.58er.eon21.space>

## 项目结构

| 目录 / 文件 | 用途 |
| --- | --- |
| `index.html`、`app.js`、`style.css`、`theme.js` | 学生端页面、系统深浅色适配、注册手机号预检查 |
| `admin.html`、`admin.js` | 独立管理员后台 |
| `privacy.html` | 隐私说明 |
| `account-deletion-ui.js`、`ui-sections.css`、`donations.css` | 账号删除交互、页面补充样式、赞助名单样式 |
| `assets/` | 页面图片资源，包括赞助二维码和插画 |
| `data/profile-sources/` | 前端登记表使用的高校、校区、专业门类和招生类型 JSON |
| `data/university-catalog.*` | 高校目录导入的数据格式、Schema 和模板 |
| `backend/src/worker-entry.js` | Worker 入口；先处理账号删除资格检查，再转交主 Worker |
| `backend/src/worker.js` | API 主逻辑：认证、资料、组队、转让、目录、管理员等 |
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
- **R2**：`GROUP_QR` 用于各地区群聊二维码，Bucket 为 `qd58-group-chat-qr`。账号删除台账代码还依赖 `DELETE_LEDGER`（建议私有 Bucket 名为 `qd58-account-deletion-ledger`）；当前仓库的 `backend/wrangler.toml` 尚未声明该绑定，正式使用账号删除功能前需先核对并补齐 R2 配置。

验证码由 Cloudflare Turnstile 与阿里云 PNVS 配合处理。注册前会先核验手机号是否已有账号；该接口要求同意隐私说明，并按 IP 和手机号双重限流。AccessKey、Turnstile Secret 和限流 HMAC Secret 应通过 Worker Secrets 配置，不要写入 Git。短信签名名称与模板编号属于非密钥配置，可写入 `backend/wrangler.toml` 的 `[vars]`。配置中的 `keep_vars = true` 也会保留在 Cloudflare Dashboard 单独管理的普通变量，避免下一次 Wrangler 部署将其清除。

## 本地检查

需要 Node.js、npm、Python。常用命令：

```powershell
npm ci
npm run check:worker
npm run test:worker
npm run test:catalog
python backend/tests/schema-smoke.py
npm run test:backup
```

## 部署

Pages 在 `main` 有新提交后由 Cloudflare Git 集成自动发布。Worker 从仓库根目录部署：

```powershell
npx wrangler deploy --config backend/wrangler.toml
```

只有新增了 D1 migration 时才需要检查并应用远程迁移：

```powershell
npx wrangler d1 migrations list qd58-zhuoyue-db --remote --config backend/wrangler.toml
npx wrangler d1 migrations apply qd58-zhuoyue-db --remote --config backend/wrangler.toml
```

不要把 D1 导出、备份、管理员引导 SQL、密码或任何密钥提交到仓库。备份与恢复要求见 [docs/d1-backup-restore.md](docs/d1-backup-restore.md)，管理员和安全运维说明见 [OPERATIONS-SECURITY.md](OPERATIONS-SECURITY.md)。
