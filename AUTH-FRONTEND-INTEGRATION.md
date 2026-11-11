# 前端整合说明

前端 Pages 域名为 https://58er.eon21.space，API 域名为 https://api.58er.eon21.space。

已加入手机号密码登录、短信注册、短信找回密码、Turnstile 前端组件、资料编辑、同校目录和同省联络人界面。旧演示数据、固定验证码和前端管理员硬编码口令不再使用。

前端预期 Worker 接口：POST /api/auth/login；POST /api/auth/register/request-code；POST /api/auth/register；POST /api/auth/password/request-code；POST /api/auth/password/reset；POST /api/auth/logout；GET/PUT /api/profile；GET /api/directory；管理接口沿用 /api/admin/*。

当前仓库还没有 backend/src/worker.js，旧后端里程碑也不支持密码登录、注册、密码重置、Turnstile 服务端核验和阿里云 PNVS。此次提交只是前端与 API 契约，不代表认证已可用。完成 Worker、D1 迁移和端到端测试前，不要公开收集真实个人信息。

Site Key 是公开标识，Secret Key 只能保存在 Worker Secret。Worker 必须调用 Cloudflare Siteverify 并检查 success、action 和 hostname。跨域 API 需要正确设置 Access-Control-Allow-Origin、Access-Control-Allow-Credentials 和必要的预检响应。