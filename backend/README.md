# 卓越 2026 API（后端第一里程碑）

本目录是独立 Cloudflare Workers + D1 后端骨架，可与 Pages 前端分离部署。当前完成：

- D1 关系型表结构：同学、大学、队伍、验证码、用户会话、组长转让、管理员、审计日志、限流桶。
- 手机验证码接口：短信发送通过环境变量配置的 HTTP Provider 抽象；缺少服务配置时 fail-closed，不回显验证码。验证码使用 HMAC-SHA256 摘要存储，5 分钟默认有效、最多 5 次尝试、一次性消费；手机号/IP 发送限流。
- 随机不透明会话 token，仅保存 SHA-256 摘要，使用 Secure / HttpOnly / SameSite=Strict Cookie。
- 资料更新、大学名称规范化、自动建队与首位组长、同校通讯录、同省组长列表。
- 组长转让请求与接收/拒绝接口，服务端校验发起人当前组长身份、接收人同队身份和待处理状态。
- 独立管理员账号密码登录（PBKDF2 格式），角色字段和审计日志；首个管理员需要由安全的离线 bootstrap 脚本/可信运维方式创建，当前不提供公开自助注册。

## 配置与迁移

1. 创建 D1 数据库并将 `wrangler.toml` 中 `database_id` 替换为真实 ID。
2. 执行 `npx wrangler d1 migrations apply zhuoyue-2026 --local`，本地验证后再对远端执行 `--remote`。
3. 配置 `APP_ORIGIN`，并使用 `wrangler secret put` 配置 `OTP_HMAC_SECRET`、`SMS_PROVIDER_URL`、`SMS_PROVIDER_TOKEN`。本项目不会主动发送真实短信；配置前 `/auth/request-code` 返回 503。
4. SMS Provider 接口契约：`POST {phone, code, template}`，Bearer token；需根据实际短信供应商的签名、模板与回执要求实现适配器。
5. 管理员口令存储格式：`pbkdf2$迭代次数$base64盐$base64派生值`。生成与写入管理员账号应通过本地受控脚本完成，严禁把口令或哈希放在前端。

## 当前 API

- `GET /api/health`
- `POST /api/auth/request-code` `{phone}`
- `POST /api/auth/verify` `{phone,code}`
- `POST /api/auth/logout`
- `GET /api/profile` / `PUT /api/profile`
- `GET /api/directory`
- `POST /api/teams/transfer` `{toUserId}`
- `POST /api/teams/transfer/:id/accept` / `reject`
- `POST /api/admin/login` `{username,password}`
- `POST /api/admin/logout`
- `GET /api/admin/overview`
- `GET /api/admin/people?q=&province=&university=&page=&pageSize=`
- `GET /api/admin/people?format=csv`（最多导出 10000 条，需管理员会话）

## 重要待办（尚未达到公开生产就绪）

- 补充端到端测试、CSRF/Origin 与跨域部署策略审查；目前建议前后端同源反向代理，或严格设置 `APP_ORIGIN`。
- 增加管理员初始化脚本、管理员用户管理、报名名单分页/筛选、可审计 CSV 导出、删除/匿名化流程。
- D1 当前手机号唯一；正式数据迁移前要设计去重与大学别名审核流程。
- 短信供应商适配、短信签名/模板、回执处理仍需真实账号与凭据；本次没有发送短信。
- 需对转让并发冲突、手机号可见范围、账户注销和会话撤销补充自动化测试。
- 需补充隐私政策、数据保存期限、备份恢复演练和管理员最小权限策略。
- 不要把本 Worker 直接上线承载真实个人信息，直到上述检查完成。
