# 卓越 2026 API（组队与组长转让阶段）

Cloudflare Worker + D1 后端。当前已提交手机号密码认证、注册/找回密码短信认证、Turnstile 服务端校验、阿里云 PNVS 适配、资料与目录 API，以及大学自动组队和组长转让服务端流程。

## 本阶段新增

- 大学规范化后以唯一 `normalized_name` 归并，并使用 `INSERT OR IGNORE` 处理并发创建。
- 首位完成大学资料的用户通过唯一 `teams.university_id` 成为初始组长；用户资料更新与队伍创建放在同一 D1 batch 中。
- 已有大学的成员再次保存资料不会覆盖现任组长；用户不能直接切换已登记大学，避免现任组长脱离队伍。
- `POST /api/teams/transfer`：仅当前组长可向同校成员发起转让。
- `POST /api/auth/password/change`：登录状态下校验当前密码后修改密码，保留当前设备 Session、撤销其他设备 Session。
- 注册与找回密码的 Turnstile 票据一次性使用；前端在短信成功后保留验证成功的视觉状态，不重复提交票据。再次主动申请短信时才重置组件获取新票据。
- 高校分类：`mainland`（中国大陆）、`hmt`（港澳台）、`sino_foreign`（内地中外合作办学）、`overseas`（海外）；类别存于高校实体，不存为用户自由文本。
- 大陆高校的本科/专科层次单独保存；985、211、双一流保留为可重叠的 `project_tags_json` 标签，由后续权威高校目录补全，不作为互斥选项。
- `GET /api/teams/transfers`：查看本人发起或收到的转让，不返回手机号。
- `POST /api/teams/transfer/:id/accept` 和 `/reject`：仅接收者可操作，pending 状态只能终结一次。
- D1 triggers 保证组长必须属于该大学、转让发起者必须是现任组长、接收者必须是同校成员；接受时在同一数据库事务中变更组长。
- 转让请求、接受、拒绝写入 `audit_logs`；审计元数据不包含手机号。

## D1 迁移

新增 `migrations/0003_team_transfer_invariants.sql` 和 `migrations/0004_university_categories.sql`。先查看远程迁移状态，再执行：

```bash
cd backend
npx wrangler d1 migrations list qd58-zhuoyue-db --remote --config wrangler.toml
npx wrangler d1 migrations apply qd58-zhuoyue-db --remote --config wrangler.toml
```

迁移仅新增索引和触发器，不删除、不重建现有表。不要对已有数据执行 DROP。

## 当前限制

管理员 API/RBAC/CSV、数据删除/匿名化、隐私告知页面、备份恢复和真实云端端到端测试仍待完成。未配置密钥或未部署前，不能宣称真实短信链路已验证。请先在测试数据库验证迁移，再部署；不要公开收集真实报名资料。
