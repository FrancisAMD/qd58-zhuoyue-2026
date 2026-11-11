# 卓越 2026 正式版后端开发记录（里程碑 1）

本次新增 `backend/`，提供 Cloudflare Workers + D1 的后端起点。它尚未接入现有静态 Demo 前端，也尚未部署。

## 本次完成
- D1 初始迁移：用户、大学、大学队伍、OTP、用户会话、组长转让、管理员与管理员会话、审计日志、限流表。
- Workers API：验证码申请/验证/退出，个人资料读写，队内目录，同省组长列表，组长转让请求/接受/拒绝，管理员登录/退出、数据概览、分页查询和 CSV 导出。
- 安全默认：验证码摘要存储、过期和尝试次数限制、手机号/IP 发送限流、验证码一次性消费、随机会话 token 摘要存储、Secure/HttpOnly/SameSite Cookie、Origin 检查、手机号默认不向队友展示、管理员独立登录和审计。
- 大学名称 NFKC 与空白/常见标点规范化；同一规范化名称复用同一大学记录。
- 组长转让增加每队最多一个 pending 的数据库唯一索引；仅当前组长可发起，仅指定接收人可接受/拒绝。

## 验证
- `node --check backend/src/worker.js`：通过。
- `node backend/tests/worker-smoke.mjs`：通过（健康检查、非法 Origin 拒绝）。
- `python backend/tests/schema-smoke.py`：通过（手机号先注册、资料补全、建队、转让记录）。

## 尚未完成
- 前端尚未接入 Worker API；当前 Demo 仍使用 localStorage。
- Cloudflare D1 ID、Pages 域名和短信服务商凭据尚未配置。
- 尚需管理员安全初始化、端到端/并发测试、删除/匿名化流程、隐私政策、备份恢复演练。
- 未部署生产服务，未发送真实短信，未录入真实报名数据。
