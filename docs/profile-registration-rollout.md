# 卓越·2026 登记页上线操作

本次登记表单从 `data/profile-sources/` 加载四份 JSON，并通过 Worker 校验学校、校区、13 个专业学科门类和招生大类。前端 Pages 发布与 Worker/D1 发布是三个不同动作。

## A. Pages 前端

本项目 Cloudflare Pages 生产分支应为 `main`。提交到 `main` 后，Cloudflare Pages Git Integration 会自动构建并发布静态页面。前端 JSON 放在仓库根目录下的 `data/profile-sources/`，会随页面部署一起发布。

## B. D1 数据库（必须先于新 Worker）

在项目根目录运行 PowerShell：

```powershell
git pull origin main
npm ci
npx wrangler d1 migrations apply qd58-zhuoyue-db --remote --config backend/wrangler.toml
```

迁移会依次应用仓库尚未应用的迁移，包括高校目录关系表、`0015_profile_registration_fields.sql` 和 `0016_profile_fields_refinement.sql`。这是新增列和新增表的迁移；执行前，建议在 Cloudflare D1 控制台确认已有备份。

然后导入完整学校目录及表单选项：

```powershell
npm run seed:profile-catalog -- --remote
```

导入脚本读取仓库内四份 JSON，使用源 ID 写入 D1；内地高校和港澳台高校分别建立目录记录，内地校区以 JSON 中的主校区/branches 层级保存。仅保存 13 个专业学科门类代码和 11 个招生大类代码，不再保存具体招生类型。脚本会清空已废弃的高中班级和旧专业宽泛分组，把旧具体招生类型映射到招生大类，并清理无法验证的第二手机号等旧值。脚本按批次执行，使用 INSERT OR IGNORE / UPSERT，可在批次失败并修复问题后重新运行。

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

本轮 Worker 构建标记应为 `three-step-university-reassign-20261127`。若仍显示旧标记，说明 Worker 尚未更新。不要在新 D1 字段迁移前部署新 Worker。

健康检查会额外返回不含密钥值的 `readiness` 状态：
- `rateLimitConfigured`：`RATE_LIMIT_HMAC_SECRET` 是否存在且至少 32 位。
- `turnstileConfigured`：`TURNSTILE_SECRET_KEY` 是否存在。
- `smsCredentialsConfigured`：`ALIBABA_ACCESS_KEY_ID` 和 `ALIBABA_ACCESS_KEY_SECRET` 是否都存在。
- `smsTemplateConfigured`：`ALIBABA_SIGN_NAME` 和 `ALIBABA_TEMPLATE_CODE` 是否都存在。

前两项以及阿里云 AccessKey 必须使用 Worker Secrets；SignName 和 TemplateCode 作为 Worker Variables 配置。名称必须严格使用以上大写拼写。不要把密钥值写入 GitHub。
如缺少 Secrets，可在项目根目录按提示执行 `npx wrangler secret put SECRET_NAME --config backend/wrangler.toml`，并按终端提示粘贴对应值；如缺少 SignName/TemplateCode，请在 Cloudflare Worker 的 Settings → Variables and Secrets → Variables 中补齐，再重新部署 Worker。

### 短信 503 的判定
- `sms_not_configured`：阿里云 AccessKey、SignName 或 TemplateCode 至少有一项未配置。
- `rate_limit_secret_not_configured`：缺少或长度不足的限流 HMAC Secret。
- `turnstile_failed`：Worker 服务端 Siteverify 请求异常或未能确认本次 token；浏览器组件显示绿色成功不代表服务端验证已通过。
- `rate_limited`：触发手机号或 IP 频率限制，按响应里的 `retryAfter` 等待。
当前 Worker 会把阿里云明确拒绝的注册短信请求对外处理成中性响应，因此若前端直接看到 503，优先检查上述配置/服务端 Turnstile，不要先按阿里云业务频控处理。

## D. 三步页面与高校重新选择

登录后的页面分为三个可点击步骤：`01 选择高校`、`02 完善资料`、`03 查看同校同学`。已完成资料且新版隐私授权有效的用户，下次登录直接进入第 03 步；未完成资料的用户从第 01 步开始。顶部全局栏已移除，修改密码、退出登录和账号删除入口统一放在页面底部。

在第 01 步的“已选高校”卡片中，可以点击“移除所选高校”，重新选择高校类别、学校和校区。个人资料和寄语会保留在表单中，重新选择后保存即可更新归属。

高校归属变更时，Worker 会保护旧团队：
- 普通队员可以重新加入另一所大学团队。
- 原团队只有该用户一人且该用户是组长时，系统会释放原团队组长位，再建立/加入新团队。
- 如果该用户仍是有其他队员的组长，必须先把组长身份转让给队员，才能更换高校。
- 有尚未处理的组长转让申请时，暂不允许变更高校。
这次归属调整不新增数据库字段；如果之前已应用 `0016_profile_fields_refinement.sql`，本次只需部署新 Worker，不需要重复迁移或导入目录。

## E. 页面验证顺序

1. 未登录访问首页，登录/注册流程应保持原样。
2. 登录后进入资料登记，选择中国内地高校，搜索“北京大学”或“青岛大学”，确认出现主校区及 JSON 中有记录的在用校区。
3. 选择港澳台高校，确认只显示学校名，不出现校区选择。
4. 选择海外高校，确认显示自由输入框；保存后进入“学校信息正在审核”状态页。
5. 内地高校必须选择一个专业学科门类和一个招生大类；招生选项只读取 JSON 的顶层大类，普通类、强基计划等均为独立选项。
6. 保存资料后进入同校目录；同校成员联系方式仅在双方都完成 v5 隐私同意后展示。
7. 用两个同校测试账号验证组长转让：组长发起，接收方接受/拒绝，刷新后核对组长状态。


## F. 本次资料字段精简与旧数据清理

- 高中班级字段已从学生登记页、同校通讯录和管理员名单中移除。迁移会把现有用户的旧 `class_name` 清空，但保留账号、姓名、高中学校、大学、团队及组长关系。
- 原个人备注内容会迁移到新 `greeting` 字段；旧 `bio` 清空。页面显示名称为“寄语”。
- 专业使用 13 个官方学科门类代码。旧的“文科/理科/工科/农科/医科”只是合并分组，无法唯一转换为某一个学科门类，因此不自动猜测；无法对应的旧专业值会清空，用户下次保存资料时重新选择。军事学仅对军事院校开放，符合源 JSON 规则。
- 招生途径仅保留招生大类。旧具体招生类型如果能在招生 JSON 中找到父级大类，则自动映射；无法映射时清空。具体招生类型选项不再加载。
- 清理脚本不会删除用户账号，不会删除大学或团队记录，不会改变组长关系。它只清理废弃字段和不符合格式的第二手机号、过长微信号等资料值。
- 隐私说明版本更新为 `2026-11-27-v5`。已有成员需要重新确认新版隐私说明后，通讯录联系方式才重新展示。

## G. 当前边界

- 校区不会拆分大学团队，团队仍以 university ID 为唯一归组单位。
- 港澳台目录只选择学校名。
- 海外学校审核前不会创建大学团队；管理后台的海外学校审核操作仍需单独完成后才能解锁审核用户。
- Pages 推送只自动发布静态前端；除非项目另有 Worker Builds 配置，Worker 仍需按 C 节使用 Wrangler 部署。
- 以上操作不会自动修改阿里云短信、Turnstile 或现有 Worker Secrets。
