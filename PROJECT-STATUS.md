# 项目状态

最后更新：2026-11-13

## 已提交
- Cloudflare Pages/Worker 域名与 D1 配置。
- 手机号密码登录、短信注册/找回密码、PBKDF2-SHA256 密码摘要、会话 Cookie 和登录限流。
- Turnstile 服务端 Siteverify；阿里云 PNVS ACS3 签名发送/核验适配。
- 个人资料、高校类别/规范化、并发安全大学自动组队、同校目录和同省组长列表。
- 组长转让 pending/accepted/rejected API、接收者权限校验和 D1 状态触发器。
- 注册/资料明确同意记录与隐私说明初稿。
- 管理员独立登录/登出/会话校验，独立 HttpOnly Cookie，登录 IP/用户名摘要限流。
- owner/admin/viewer RBAC；名单分页、关键词/省份/大学/年级/类别筛选；最多 5000 行公式安全 CSV；审计查询；owner 创建/停用 admin/viewer。
- 管理员名单和 CSV 不包含手机号与个人备注；viewer 仅可查看汇总统计。

## 本次里程碑（2026-11-13）
- 新增 backend/migrations/0006_admin_rbac.sql：管理员生命周期字段、大小写不敏感用户名唯一索引、会话/审计索引和最后一个 active owner 保护。
- 扩展 Worker 管理 API 与独立管理员 Session。
- 新增 owner 初始化脚本 scripts/create-admin.mjs，只生成哈希 SQL，不访问远程 D1。
- 更新管理后台 UI、角色视图、筛选、CSV、审计和账号管理。
- PBKDF2 改为 Workers 原生 Web Crypto deriveBits，避免依赖 node:crypto Node 兼容层；密码摘要比较采用固定长度 XOR 累积。
- 新增管理员登录/RBAC/CSV/审计测试与迁移约束测试。

## 未完成 / 阻塞
- 远程 D1 尚未应用 0003-0006（必须先读取远程迁移状态，再按序应用）。
- 尚未初始化首位 owner；需在用户终端运行脚本并用 Wrangler 写入管理员摘要。
- 用户数据删除/匿名化 API 尚未实现；正式保留期限、删除申请邮箱/负责人尚待组织方确定。
- 备份恢复方案已形成操作建议，但未执行备份或恢复演练。
- 真实 Turnstile、阿里云 PNVS 短信、Worker/Pages 部署和浏览器端到端联调未验证。
- 高校权威目录补全、转让前端 UI、管理员安全加固/登录失败告警仍待完善。

**不要开放真实报名**，直至远程迁移、owner 初始化、数据删除渠道、保留期限、备份恢复演练和端到端安全测试全部完成。