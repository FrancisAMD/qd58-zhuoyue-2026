# 卓越 2026 API（认证与短信接入阶段）

Cloudflare Worker + D1 后端。当前已提交手机号密码认证、注册/找回密码短信认证、Turnstile 服务端校验、阿里云 PNVS API 适配，以及资料和基础目录 API。

## 当前认证 API

- `POST /api/auth/register/request-code`：注册短信请求，Body: `{phone, turnstileToken}`
- `POST /api/auth/register`：完成注册，Body: `{phone, code, password}`
- `POST /api/auth/login`：手机号密码登录，Body: `{phone, password}`
- `POST /api/auth/password/request-code`：找回密码短信请求，Body: `{phone, turnstileToken}`
- `POST /api/auth/password/reset`：重设密码，Body: `{phone, code, newPassword}`
- `POST /api/auth/logout`
- `GET/PUT /api/profile`
- `GET /api/directory`
- `GET /api/health`

密码使用 PBKDF2-SHA256（310,000 次迭代）派生后存储；会话 Cookie 为 Secure、HttpOnly、SameSite=Lax，数据库仅保存会话 token 的 SHA-256 摘要。密码重置会撤销该用户所有现有会话。

## D1 迁移

本次新增 `migrations/0002_password_auth.sql`，在原有 users 表增加 password_hash，并为 OTP 记录增加 purpose/out_id。先确认远程数据库迁移历史，再运行：

```bash
cd backend
npx wrangler d1 migrations list qd58-zhuoyue-db --remote
npx wrangler d1 migrations apply qd58-zhuoyue-db --remote
```

不要对已存在的生产数据执行手工 DROP/重建操作。

## Worker Secrets

在 backend 目录执行：

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put ALIBABA_ACCESS_KEY_ID
npx wrangler secret put ALIBABA_ACCESS_KEY_SECRET
```

不要将 Secret 写入 wrangler.toml、前端或 GitHub。Site Key 是公开值，已放在 Pages 前端。

非敏感阿里云参数可通过 Wrangler vars 配置：
- `ALIBABA_SIGN_NAME`：控制台已审核/可用的签名名称
- `ALIBABA_TEMPLATE_CODE`：已审核/可用模板 Code
- `ALIBABA_SCHEME_NAME`：若发送接口配置了方案名称，核验时必须使用同一个名称；未配置则使用默认方案

当前 Worker 默认使用截图中的签名“恒创联众”和模板 `100001`。正式发短信前请确认这两个资源已在号码认证服务中开通可用。

## 阿里云 PNVS 认证流程

Worker 通过 ACS3-HMAC-SHA256 对 `dypnsapi.aliyuncs.com` 的请求签名：
- `SendSmsVerifyCode`：`TemplateParam={"code":"##code##","min":"5"}`，系统生成验证码；不返回验证码明文；验证码长度明确设置为 6 位，纯数字；有效期 300 秒、发送间隔 60 秒、覆盖旧码。
- `CheckSmsVerifyCode`：必须判断 `Model.VerifyResult === "PASS"`。仅 `Success === true` 不代表验证码正确。

每次发送前必须通过 Turnstile Siteverify，检查 success、action 和 hostname。注册 action 为 `register`，找回密码 action 为 `password_reset`。

## 当前限制

本阶段尚未完成管理员 API、组长转让 API、完整管理员初始化/RBAC、审计日志、数据删除/匿名化、备份恢复和端到端真实短信测试。不要将网站开放给真实报名用户，直到完成后续测试和安全审查。
