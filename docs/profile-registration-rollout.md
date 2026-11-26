# 卓越·2026 登记页上线操作

本次登记表单从 `data/profile-sources/` 加载四份 JSON，并通过 Worker 校验学校、校区、专业大类和招生途径。前端 Pages 发布与 Worker/D1 发布是三个不同动作。

## A. Pages 前端

本项目 Cloudflare Pages 生产分支应为 `main`。提交到 `main` 后，Cloudflare Pages Git Integration 会自动构建并发布静态页面。前端 JSON 放在仓库根目录下的 `data/profile-sources/`，会随页面部署一起发布。

## B. D1 数据库（必须先于新 Worker）

在项目根目录运行 PowerShell：

```powershell
git pull origin main
npm ci
npx wrangler d1 migrations apply qd58-zhuoyue-db --remote --config backend/wrangler.toml
```

迁移会依次应用仓库尚未应用的迁移，包括高校目录关系表和 `0015_profile_registration_fields.sql`。这是新增列和新增表的迁移；执行前，建议在 Cloudflare D1 控制台确认已有备份。

然后导入完整学校目录及表单选项：

```powershell
npm run seed:profile-catalog -- --remote
```

导入脚本读取仓库内四份 JSON，使用源 ID 写入 D1；内地高校和港澳台高校分别建立目录记录，内地校区以 JSON 中的主校区/branches 层级保存。招生类别和具体类型分开保存，专业大类也独立保存。脚本按批次执行，使用 INSERT OR IGNORE / UPSERT，可在批次失败并修复问题后重新运行。

预期数据规模：内地 1,455 所、港澳台 54 所、内地在用分支校区 216 条、13 个专业学科门类、11 个招生大类 / 34 个具体招生类型。

## C. Worker API

D1 迁移和数据导入成功后，再部署 Worker：

```powershell
npx wrangler deploy --config backend/wrangler.toml
```

部署后检查：

```powershell
Invoke-RestMethod https://api.58er.eon21.space/api/health
```

本轮 Worker 构建标记应为 `profile-registration-v4-20261126`。若仍显示旧标记，说明 Worker 尚未更新。不要在新 D1 字段迁移前部署新 Worker。

## D. 页面验证顺序

1. 未登录访问首页，登录/注册流程应保持原样。
2. 登录后进入资料登记，选择中国内地高校，搜索“北京大学”或“青岛大学”，确认出现主校区及 JSON 中有记录的在用校区。
3. 选择港澳台高校，确认只显示学校名，不出现校区选择。
4. 选择海外高校，确认显示自由输入框；保存后进入“学校信息正在审核”状态页。
5. 内地高校必须选择专业大类，以及招生大类和具体招生途径；普通类批次和强基计划等选项由招生 JSON 两级读取。
6. 保存资料后进入同校目录；同校成员联系方式仅在双方都完成 v4 隐私同意后展示。
7. 用两个同校测试账号验证组长转让：组长发起，接收方接受/拒绝，刷新后核对组长状态。

## E. 当前边界

- 校区不会拆分大学团队，团队仍以 university ID 为唯一归组单位。
- 港澳台目录只选择学校名。
- 海外学校审核前不会创建大学团队；管理后台的海外学校审核操作仍需单独完成后才能解锁审核用户。
- Pages 推送只自动发布静态前端；除非项目另有 Worker Builds 配置，Worker 仍需按 C 节使用 Wrangler 部署。
- 以上操作不会自动修改阿里云短信、Turnstile 或现有 Worker Secrets。
