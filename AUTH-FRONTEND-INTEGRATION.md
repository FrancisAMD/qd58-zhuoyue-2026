# 前端与 Worker 接口整合说明

前端 Pages：https://58er.eon21.space；Worker API：https://api.58er.eon21.space。

## 同学接口
- POST /api/auth/register/request-code、POST /api/auth/register、POST /api/auth/login。
- POST /api/auth/password/request-code、POST /api/auth/password/reset、POST /api/auth/password/change、POST /api/auth/logout。
- GET/PUT /api/profile、GET /api/directory。
- POST /api/teams/transfer、GET /api/teams/transfers、POST /api/teams/transfer/:id/accept|reject。

## 管理员接口
- POST /api/admin/login、POST /api/admin/logout、GET /api/admin/me。
- GET /api/admin/overview。
- GET /api/admin/people：支持 q/province/university/grade/category/page/pageSize；format=csv 导出。
- GET /api/admin/audit。
- GET/POST /api/admin/admins，以及 POST /api/admin/admins/:id。

管理员使用独立 __Host-qd58_admin Cookie。owner 可管理 admin/viewer；admin 可查看名单、审计并导出；viewer 仅看统计。管理员名单和 CSV 不含手机号与个人备注。

## 安全与运维
- Turnstile Secret 和阿里云 AccessKey 只存 Worker Secrets。
- 迁移按序应用；本次新增 0006_admin_rbac.sql。
- owner 初始化、备份建议、删除/匿名化未完成事项见 OPERATIONS-SECURITY.md。
- 本仓库提交不代表已部署或已应用远程 D1；不发送真实短信、不触碰真实用户数据。