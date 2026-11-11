# 青岛五十八中 卓越·2026返校宣讲

面向 2026 届青岛五十八中毕业生的返校宣讲信息登记与大学组队平台。

## 技术架构

- **Cloudflare Pages**：静态前端
- **Cloudflare Workers**：登录、资料、组队、组长转让、通讯录和管理员 API
- **Cloudflare D1**：结构化业务数据
- **Cloudflare R2**：后续按需存放头像、图片和附件（当前不需要先创建 bucket）

## 当前仓库进度

已提交：
- 项目状态与后端里程碑说明
- D1 初始迁移 SQL
- Wrangler Worker 配置模板
- 后端 API 使用说明
- D1 schema 和 Worker 冒烟测试

完整开发包：`qd58-zhuoyue-2026.zip`（本次对话提供）。仓库其余前端和 Worker 源码文件正在分批同步，未完成同步前不要连接 Cloudflare Pages 自动部署。

## 安全说明

- 尚未部署生产服务，尚未连接真实短信供应商。
- `backend/wrangler.toml` 中 D1 ID 与 Pages Origin 仍是占位符。
- 手机号默认不向同校成员展示，必须由用户明确授权。
- 管理员 bootstrap、前后端 API 接入、删除/匿名化、隐私告知、备份恢复和完整端到端测试仍待完成。
- 请勿使用真实个人信息进行公开测试。

详见 [项目状态](PROJECT-STATUS.md)、[后端里程碑](BACKEND-MILESTONE.md) 和 [后端说明](backend/README.md)。
