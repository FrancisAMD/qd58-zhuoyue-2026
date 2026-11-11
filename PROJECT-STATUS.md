# 项目状态

最后更新：2026-11-11

## 已提交
- Cloudflare Pages 前端：手机号密码登录、短信注册、短信找回密码、Turnstile 组件、资料编辑和目录界面。
- Worker 认证阶段：手机号密码登录、PBKDF2-SHA256 密码哈希、随机会话 Cookie、密码重置后撤销全部会话。
- 阿里云 PNVS：ACS3-HMAC-SHA256 请求签名、SendSmsVerifyCode 发送、CheckSmsVerifyCode 核验；验证码明文不返回前端、不写入 D1。
- Turnstile：Worker 服务端 Siteverify，校验 success、action 和 hostname。
- D1 迁移 0002：增加 password_hash、OTP purpose 和 out_id。
- 发送频控：手机号 60 秒冷却、手机号日限额、IP 小时限额；验证码有效期 5 分钟、最多 5 次核验尝试。
- 前端 API 对接：登录、注册、找回密码、资料和基础目录接口。

## 当前未完成
- 尚未在真实 Cloudflare Worker + D1 环境执行迁移和部署。
- 尚未使用真实阿里云 RAM AccessKey 发送/核验短信；不能宣称短信链路已跑通。
- 尚未在真实浏览器完成 Turnstile + Cookie 跨域联调。
- 管理后台 API、组长转让 API、完整 RBAC、审计日志、CSV 导出尚未接入当前 Worker。
- 大学建队并发一致性、隐私告知、数据删除/匿名化、备份恢复和安全审查仍待完成。

## 安全提示
完成远程迁移、密钥配置、真实短信测试和完整端到端测试前，不要公开收集真实个人信息。
