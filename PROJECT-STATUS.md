# 项目状态（2026-11-11）

## 已完成
- 返校宣讲报名/分组 Demo。
- Cloudflare Workers + D1 后端第一版骨架与迁移。
- OTP HMAC 摘要、有效期/尝试次数/限流、随机会话 token 摘要。
- 大学规范化、自动建队、组长转让状态流、同校通讯录与同省组长列表。
- 管理员登录、概览、名单查询和 CSV 导出 API。
- 本地语法/冒烟/schema 测试通过。

## 下一阶段
1. 接通 Pages 前端与 Worker API，移除生产路径上的 localStorage 演示身份。
2. 完成管理员 bootstrap、RBAC 细分和 CSV 导出权限控制。
3. 补充数据删除/匿名化、隐私告知、数据保留期限和备份恢复。
4. 完成 Worker + D1 本地及测试环境端到端测试、转让并发测试。
5. 绑定 Cloudflare Pages、D1；按实际文件上传需求再接 R2。
6. 依据短信供应商 API 完成 Provider 适配；未授权前不发送真实短信。

## 环境占位项
- `backend/wrangler.toml`: `database_id`、`APP_ORIGIN`
- Worker secrets: `OTP_HMAC_SECRET`、`SMS_PROVIDER_URL`、`SMS_PROVIDER_TOKEN`
