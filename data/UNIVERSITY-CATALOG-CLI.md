# 高校目录 Owner CLI

此 CLI 仅用于高校目录批次的 Owner 管理；它不会把密码、Session Cookie 或 Manifest 写入新的文件。

## 先生成目录和清单

请先完成目录 JSON、旧 D1 快照、Dry-run 计划和 Manifest：

\`\`\`powershell
npm run validate:universities -- data/university-catalog.json
npm run plan:universities -- --catalog data/university-catalog.json --existing data/university-catalog-existing.snapshot.json --out data/university-catalog-import-plan.json
npm run prepare:universities -- --catalog data/university-catalog.json --plan data/university-catalog-import-plan.json --out data/university-catalog-import-manifest.json
\`\`\`

## 命令

目标 API 和网站 Origin 必须显式指定，避免误操作环境；示例中的域名仅为配置示例：

\`\`\`powershell
node scripts/university-catalog-admin-cli.mjs status --api-base https://api.58er.eon21.space --app-origin https://58er.eon21.space --dataset-version 2026-11-25
node scripts/university-catalog-admin-cli.mjs stage --api-base https://api.58er.eon21.space --app-origin https://58er.eon21.space --manifest data/university-catalog-import-manifest.json
node scripts/university-catalog-admin-cli.mjs finalize --api-base https://api.58er.eon21.space --app-origin https://58er.eon21.space --dataset-version 2026-11-25 --manifest-sha256 <64位小写SHA-256>
\`\`\`

- status 只查询状态。
- stage 上传暂存 Manifest；上传前验证记录 SHA-256、身份、重复目标、Manifest 摘要和 8 MiB 请求上限。上传后核验 Worker 返回的批次状态。
- finalize 先检查批次完整性和 SHA-256，然后要求在终端输入完整的 APPLY + SHA-256 确认词；提交后再次查询，只有 applied 且暂存表清空才报告成功。
- 登录时先输入管理员用户名，再在不回显的终端输入密码。CLI 仅在内存中使用登录 Cookie，并在结束时尽力调用注销接口；不支持通过命令行参数输入密码。
- 使用该 CLI 需要 Owner 角色、universities:import 权限以及 Worker UNIVERSITY_CATALOG_IMPORT_ENABLED=true。此开关默认关闭。
- CLI 不部署 Worker，不应用迁移，不修改用户或队伍关系。正式提交仍由 Worker 重新验证目标映射并在 D1 Batch 中完成。
- 测试用 mock fetch，不代表 Cloudflare 真实环境已联调。

**只有在独立测试 D1、备份和恢复演练完成后，才应尝试正式提交。**
