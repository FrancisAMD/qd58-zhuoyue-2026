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

迁移会依次应用仓库尚未应用的迁移，包括高校目录关系表、`0015_profile_registration_fields.sql`、`0016_profile_fields_refinement.sql` 和 `0017_team_transfer_snapshots.sql`。这是新增列和新增表的迁移；执行前，建议在 Cloudflare D1 控制台确认已有备份。

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

本轮 Worker 构建标记应为 `team-school-snapshot-reset-20261127`。若仍显示旧标记，说明 Worker 尚未更新。不要在新 D1 字段迁移前部署新 Worker。

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

## H. 高校移除、资料重置与转让历史

本轮增加 `POST /api/profile/reset`。前端第 01 步的“移除所选高校”现在会立即调用该接口，而不是只清空浏览器中的选择框。确认后会清空当前用户的姓名、高中学校、年级、性别、专业、招生大类、地区/城市、校区、第二手机号、微信号、寄语及隐私同意，并解除当前大学归属；注册手机号、密码、账号和登录会话保留。用户需要重新选择高校、填写资料并重新确认隐私说明。

团队安全规则：
- 如果用户是旧团队唯一成员兼组长，服务器先释放其旧团队组长位，再清空 `users.university_id`，顺序符合 `users_cannot_leave_led_team` 数据库触发器。
- 如果用户仍是有其他成员的组长，拒绝移除并提示先转让组长身份。
- 用户如果是旧团队待处理转让的接收方，退出学校时会把待处理记录改为 `expired`，不会删除记录。
- 账号、大学团队行、已完成的转让记录和审计记录都保留。

`0017_team_transfer_snapshots.sql` 为每条转让记录增加发起时的双方姓名、学校 ID 和学校名称快照，并回填迁移前已有记录。新转让创建时也会写入快照。转让历史页面会在每条记录上显示所属高校，并区分“当前团队/历史团队”；用户换校后，旧学校的转让记录仍属于原学校，不会被误认为新学校的组长申请。历史学校的待处理邀请不可再接受或拒绝。

本轮上线顺序（先迁移，再部署 Worker）：

```powershell
git pull origin main
npx wrangler d1 migrations apply qd58-zhuoyue-db --remote --config backend/wrangler.toml
npx wrangler deploy --config backend/wrangler.toml
```

这次只需执行新增的 D1 迁移，不需要重新导入高校 JSON。部署后 `/api/health` 的 build 应为 `team-school-snapshot-reset-20261127`。

## G. 当前边界

- 校区不会拆分大学团队，团队仍以 university ID 为唯一归组单位。
- 港澳台目录只选择学校名。
- 海外学校审核前不会创建大学团队；管理后台的海外学校审核操作仍需单独完成后才能解锁审核用户。
- Pages 推送只自动发布静态前端；除非项目另有 Worker Builds 配置，Worker 仍需按 C 节使用 Wrangler 部署。
- 以上操作不会自动修改阿里云短信、Turnstile 或现有 Worker Secrets。


## I. 省份群聊二维码（R2）与入群确认

群聊二维码按 **高校校本部所在地** 分组，不按学生选择的校区分组。内地 31 个省级行政区各自一张二维码；香港、澳门、台湾共用“港澳台”二维码；海外高校共用“海外”二维码。示例：哈尔滨工业大学的校本部在黑龙江省，即使学生选了威海校区，仍展示黑龙江省二维码。

管理员页面新增“省份群聊二维码管理”：
- 选择区域并上传 PNG/JPG/WebP 图片，单张最大 5 MiB。
- R2 对象按固定区域 key 保存；同一区域再次上传会覆盖当前二维码。
- 可删除某个区域二维码。
- 管理后台按区域查看当前已登记同学的入群确认状态及时间。
- 上传新二维码会生成新的上传时间快照；旧确认记录保留，但不再计为当前二维码的有效确认，学生需要重新扫码并确认。

学生第 03 页会展示所属区域二维码、归组说明和“确认已加入群聊”按钮。确认由学生主动点击后保存到 D1 的 `group_chat_confirmations`，不会以二维码是否被扫描作为技术判断。

### 首次部署 R2

在项目根目录 PowerShell 中执行一次：

```powershell
npx wrangler r2 bucket create qd58-group-chat-qr
```

如果提示 Bucket 已存在，不需要重复创建。仓库的 `backend/wrangler.toml` 已增加 `GROUP_QR` 绑定，绑定名为 `GROUP_QR`，Bucket 名为 `qd58-group-chat-qr`。

随后更新代码、应用新增 D1 迁移并部署 Worker：

```powershell
git pull origin main
npm ci
npx wrangler d1 migrations apply qd58-zhuoyue-db --remote --config backend/wrangler.toml
npx wrangler deploy --config backend/wrangler.toml
```

这次新增的 D1 迁移为 `0018_group_chat_confirmations.sql`。无需重新导入高校 JSON。Cloudflare Pages 会自动从 `main` 发布新前端。

部署后打开 `/admin.html`，进入“省份群聊二维码管理”，逐区域上传二维码。没有上传的区域会向学生显示“二维码待上传”，不会错误显示其他地区的二维码。
