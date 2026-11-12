# 项目状态

最后更新：2026-11-12

## 已提交
- Cloudflare Pages 前端与 Worker API 域名配置。
- 手机号密码登录、注册短信验证码、找回密码短信验证码。
- PBKDF2-SHA256 密码哈希（Workers 兼容上限 100,000 次）、HttpOnly/Secure 会话 Cookie、登录限流。
- Turnstile 服务端 Siteverify 适配；阿里云 PNVS ACS3 签名发送/核验抽象。
- D1 用户、大学、队伍、OTP、会话、转让、管理员和审计基础表。
- 大学规范化和并发安全的首次组队。
- 组长转让 pending/accepted/rejected API 与接收者权限校验。
- D1 触发器约束组长成员关系、转让状态机和接受时的原子组长切换。
- 资料登记改为先选高校类别，再填写类别专属信息；高校目录保留 985、211、双一流可重叠标签字段。
- 转让操作写入 audit_logs；队伍目录手机号默认隐藏，只在本人开启授权后对同队成员展示。

## 本次新增
- `backend/migrations/0003_team_transfer_invariants.sql`
- `backend/migrations/0004_university_categories.sql`：高校实体增加四类分类、地区、办学层次、合作院校和可叠加项目标签。
- Worker 组长转让 API 与并发保护
- SQLite migration/trigger 回归测试
- GitHub Actions 后端检查流程

## 未完成 / 阻塞
- 管理员 API、管理员独立会话、RBAC、查询筛选和 CSV 导出尚未完成。
- 隐私告知、用户数据删除/匿名化、备份恢复策略仍待完善。
- 高校分类迁移 0004 已提交，仍需在用户 Cloudflare 远程 D1 上应用；然后部署 Worker 与 Pages。
- 未验证真实 Turnstile + 阿里云短信链路；不代表真实短信已发送。
- 真实云端迁移历史、Secrets 和 Pages/Worker 浏览器联调需要在用户环境完成。

正式开放前必须完成管理员权限、安全审查、隐私说明和端到端测试。
