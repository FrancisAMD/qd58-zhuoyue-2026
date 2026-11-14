# 青岛五十八中 卓越·2026返校宣讲

- Pages: https://58er.eon21.space
- Worker API: https://api.58er.eon21.space
- D1: qd58-zhuoyue-db

项目已包含手机号密码认证与短信注册/找回密码接口、Turnstile 服务端核验、阿里云 PNVS 适配、个人资料、大学自动组队、组长转让和同校目录。管理员独立认证、RBAC、名单查询/筛选、审计与 CSV 导出已在主线实现。

**当前仍不可直接作为真实报名入口开放：** 迁移 0006 尚未应用到远程 D1；尚未初始化 owner 账号；数据删除/匿名化、正式保留期限、组织者联系渠道、备份恢复演练和真实环境端到端验证待完成。请先阅读 OPERATIONS-SECURITY.md、privacy.html 和 PROJECT-STATUS.md。


## 用户账号删除与隐私

登录用户可在个人资料页面发起账号删除，需当前密码、绑定手机号短信验证和二次确认。服务端对在线资料执行不可逆匿名化，保留随机标识以维护历史转让/审计关联；删除后的账号不会出现在目录和管理员名单中。详见 `privacy.html` 与 `OPERATIONS-SECURITY.md`。

新增 D1 迁移 `0008_account_anonymization.sql`。尚未应用远程迁移或部署 Worker。
