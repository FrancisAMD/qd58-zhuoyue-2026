# 项目状态

最后更新：2026-11-21

## 已提交
- Cloudflare Pages/Worker 域名与 D1 配置。
- 手机号密码登录、短信注册/找回密码、PBKDF2-SHA256 密码摘要、会话 Cookie 和登录限流。
- Turnstile 服务端 Siteverify；阿里云 PNVS ACS3 签名发送/核验适配。
- 个人资料、高校类别/规范化、并发安全大学自动组队、同校目录和同省组长列表。
- 组长转让 pending/accepted/rejected/expired 状态；默认 7 天到期，API 惰性清理 + 每 15 分钟 Cron 清理，并写入系统审计。
- 注册/资料明确同意记录与隐私说明初稿。
- 管理员独立登录/登出/会话校验，独立 HttpOnly Cookie，登录 IP/用户名摘要限流。
- owner/admin/viewer RBAC；名单分页、关键词/省份/大学/年级/类别筛选；最多 5000 行公式安全 CSV/XLSX；审计查询；owner 创建/停用 admin/viewer。
- 管理员名单和 CSV/XLSX 不包含手机号与个人备注；viewer 仅可查看汇总统计。

## 本次里程碑（2026-11-13）
- 新增 backend/migrations/0006_admin_rbac.sql：管理员生命周期字段、大小写不敏感用户名唯一索引、会话/审计索引和最后一个 active owner 保护。
- 扩展 Worker 管理 API 与独立管理员 Session。
- 新增 owner 初始化脚本 scripts/create-admin.mjs，只生成哈希 SQL，不访问远程 D1。
- 更新管理后台 UI、角色视图、筛选、CSV、审计和账号管理。
- PBKDF2 改为 Workers 原生 Web Crypto deriveBits，避免依赖 node:crypto Node 兼容层；密码摘要比较采用固定长度 XOR 累积。
- 新增管理员登录/RBAC/CSV/审计测试与迁移约束测试。

## 未完成 / 阻塞
- 远程 D1 迁移状态尚未读取；当前 PR 分支包含 0001–0013，部署前需核对目标 D1 的 0001–0013 与远程记录，按序应用缺失迁移。
- 尚未初始化首位 owner；需在用户终端运行脚本并用 Wrangler 写入管理员摘要。
- 用户自助删除/匿名化 API 已提交，隔离测试覆盖登录态、模拟 Turnstile/PNVS 和原子性；尚未在真实 D1/PNVS 环境联调。正式保留期限、删除申请邮箱/负责人尚待组织方确定。
- 备份恢复方案已形成操作建议，但未执行备份或恢复演练；组织方尚未确认保留期限与申请邮箱。
- 真实 Turnstile、阿里云 PNVS 短信、Worker/Pages 部署和浏览器端到端联调未验证；当前自动化测试使用隔离 mock，不替代真实环境验证。
- 高校权威目录补全、转让前端 UI、外部管理员登录失败告警仍待完善。原生 XLSX 导出已完成并通过隔离测试。

**不要开放真实报名**，直至远程迁移、owner 初始化、数据删除渠道、保留期限、备份恢复演练和端到端安全测试全部完成。
## 本次增量里程碑（2026-11-13）
- 新增 backend/migrations/0007_transfer_expiry.sql，为转让记录增加 expires_at，旧记录按创建时间补齐 7 天期限。
- Worker 在创建、查看和响应转让时先清理过期记录；Cloudflare Cron 每 15 分钟执行一次兜底清理。
- 过期转让写入 system audit_logs，过期后无法再接受或拒绝；队长归属保持不变。
- 新增转让过期迁移约束和 scheduled handler 测试。

- 追加到期竞态保护：响应更新同时校验 D1 当前时间，D1 触发器阻止到期后直接改为 accepted/rejected；未授权接收者不会触发清理批处理。

## 本次增量里程碑（2026-11-14）
- 新增 backend/migrations/0008_account_anonymization.sql：删除时间、不可逆 tombstone、删除前队长/待处理转让保护、已删除记录不可恢复。
- 新增已登录账号删除流程：当前密码 + 绑定手机号 PNVS 短信验证码 + Turnstile + 二次确认；服务端不接受客户端指定手机号。
- 删除事务撤销用户 Session、清除 OTP 和手机号相关限流键、终止关联 pending 转让、清空直接身份资料和授权记录，并写入不含手机号/姓名的系统审计。
- 有其他有效队员的队长必须先转让；独自担任队长时释放队长槽位。后续首位新成员可接管空队伍。
- 登录、目录、同省队长列表、管理员统计和名单均排除已删除账号。
- 隐私页更新为 2026-11-14-v2；备份与恢复说明明确每日加密备份、建议 30 天滚动保留、每月独立测试库恢复演练（待组织方确认，尚未执行）。
- 本次没有运行远程 D1 迁移、备份导出、生产部署或真实短信发送。


## 本次增量里程碑（2026-11-14）：账号删除原子性验证

- 新增 `backend/migrations/0009_account_deletion_atomicity.sql`：`account.deleted` 审计事件必须引用已匿名化 tombstone。若删除 batch 中用户更新未成功，最后的审计插入触发约束失败，使 D1 batch 回滚，避免半完成删除。
- Worker 将 D1 删除冲突统一映射为 HTTP 409 `account_delete_conflict`；仍有其他队员的队长仍返回 `leader_transfer_required`。
- 扩充账号生命周期测试：模拟 Turnstile Siteverify 与阿里云 PNVS 发送/核验，覆盖会话绑定手机号、错误验证码、错误密码、队长限制、删除后会话撤销、审计信息最小化及 batch 冲突回滚。
- 测试使用 mock D1 和 mock 外部服务；不代表真实 D1、Turnstile、PNVS 或浏览器联调已完成。未执行远程迁移、真实短信、备份或部署。


## 本次增量里程碑（2026-11-15）：限流标识去标识化与短期认证数据清理

- 新增 createRateLimitKey：短信、普通登录和管理员登录的限流桶键统一使用 RATE_LIMIT_HMAC_SECRET 做 HMAC-SHA256，不再把原始手机号、IP 或管理员用户名写入 D1。
- 未配置至少 32 字符的限流密钥时，短信/登录限流路径 fail-closed，返回 503；部署前需通过 Wrangler Secret 单独配置。
- 新增 cleanupExpiredSecurityData 并接入每 15 分钟 Cron：验证码挑战消费/过期满 24 小时清理；过期用户和管理员 Session 清理；旧版原始标识限流桶在窗口起点满 24 小时后清理；HMAC 桶在窗口起点满 48 小时后清理。
- 每条清理 SQL 使用子查询和 LIMIT 500 分批执行；审计日志不自动清理，等待组织方确认正式保留周期。
- 新增迁移 0010_security_data_retention_indexes.sql，为 OTP、Session 和限流窗口增加清理索引。
- 新增限流密钥去标识化、缺少密钥 fail-closed、账号删除时清除手机号限流桶、Cron 清理语句及索引测试。
- 本次未执行远程 D1 迁移、真实短信、备份导出或生产部署。部署前需设置 RATE_LIMIT_HMAC_SECRET。


## 本次增量里程碑（2026-11-15）：管理员登录失败审计

- Worker 对通过格式校验且未触发限流、但凭据不正确的管理员登录请求写入 `admin.login.failed` 系统审计。
- 审计只保存失败原因类别，不记录提交用户名、IP、密码或请求正文；客户端始终收到统一的 `401 invalid_credentials`，避免账号枚举。
- 格式错误和已限流请求不写审计，避免无效请求灌满审计表；限流仍由 IP/用户名 HMAC 桶执行。
- 新增隔离测试覆盖未知账号、停用账号、密码不匹配、审计写入故障时统一响应，以及限流请求不产生审计事件。
- 失败审计可供 owner/admin 查询，但尚未配置邮件/短信/即时告警通道；真实 D1、Cloudflare、PNVS 联调仍未执行。


## 本次增量里程碑（2026-11-16）：注册/找回短信请求防账号枚举

- 注册与找回密码的短信请求不再在 Turnstile/限流前返回 phone_already_registered 或 phone_not_registered；手机号资格检查移至 Turnstile 通过并预留限流额度之后。
- 对符合/不符合条件的手机号，公开请求均返回相同的 `{ok:true}`，不向前端暴露阿里云 RequestId；只有符合条件的请求才真正调用 PNVS 并创建验证码挑战。
- 公共注册/找回请求的 PNVS 或挑战存储异常不再返回可用于区分账号状态的错误；服务端记录不含手机号、IP、验证码或请求正文的最小化错误类别。短信服务未配置时统一返回服务配置错误。
- 前端改为“请求已受理，若手机号符合当前操作条件将发送验证码”的中性提示。
- 新增 `backend/tests/auth-enumeration-smoke.mjs`，覆盖已注册/未注册手机号在注册和找回场景下的响应一致性、PNVS 仅对合格请求发送、限流键不含原始手机号/IP。
- 本次不新增 D1 迁移；不执行远程数据库、真实短信、Turnstile 或生产部署。


## 本次增量里程碑（2026-11-16）：管理员原生 XLSX 导出

- 新增 `backend/src/xlsx.js`：使用 Worker 原生 Web API 生成最小 OOXML 工作簿，无额外 npm 依赖；单元格统一使用 inline string，公式样式文本不会变成公式。
- `GET /api/admin/people?format=xlsx` 与 CSV 共用 `people:export` 权限、现有筛选和最多 5000 行上限；字段白名单不包含手机号、个人备注或验证码。
- 导出审计记录格式、行数和筛选数量；管理后台增加 Excel 下载按钮。
- 新增 Worker 路由隔离测试和 Python 标准库 ZIP/XML 测试，覆盖 owner 导出、viewer/未登录拒绝、超限拒绝、中文/特殊字符、公式文本和敏感字段不泄露。
- 未部署、未执行远程 D1 操作、未读取真实用户数据。


## 本次增量里程碑（2026-11-17）：密码生命周期与 Session 版本绑定

- 新增 0011_password_session_version.sql：users/sessions 增加 auth_version，历史数据默认版本 1。
- currentUser 校验 Session 与用户凭据版本一致；登录创建 Session 时使用密码摘要和版本条件 INSERT，避免旧密码校验与密码重置并发时创建有效 Session。
- 密码修改使用旧密码摘要 + 旧 auth_version compare-and-swap；成功后递增版本、保留并升级当前 Session、撤销其他设备 Session，并写入不含个人信息的审计事件。
- 短信找回密码在 PNVS 验证后以同样的 compare-and-swap 原子更新密码、递增版本、撤销全部 Session 并审计；并发重置只能有一个基于同一旧凭据状态的请求成功。
- 账号删除增加已验证密码摘要和 auth_version 条件，防止密码变更与删除并发时使用过期密码。
- 新增 backend/tests/password-lifecycle-smoke.mjs 与 D1 schema 版本列检查；更新 Worker build marker 和前端冲突提示。
- 本次没有执行远程 D1 迁移、真实短信、Turnstile、备份或生产部署。


## 本次增量里程碑（2026-11-17）：PNVS 挑战先持久化再发送

- 依据阿里云 PNVS `SendSmsVerifyCode` 文档，将 D1 challenge 写入移至短信发送前；OutId 在发送前持久化，避免阿里云已接受短信、后续 D1 写入失败导致用户收到无法核验的验证码。
- D1 challenge 写入失败时不会调用 PNVS，并释放本次限流预留。
- PNVS 明确拒绝时删除不可用 challenge 并释放配额；网络/超时等结果不确定时保留 challenge 和配额，允许已经送达的验证码继续核验，并避免重复发送造成额外费用。
- 增加 PNVS 参数契约测试：6 位数字、300 秒有效期、60 秒间隔、覆盖旧码、`##code##` 服务端生成、`ReturnVerifyCode=false`、OutId 关联；确保应用不接收/存储明文验证码。
- 测试为 mock 外部服务与隔离 D1，不代表真实 PNVS、Turnstile、D1 或生产环境联调。


## PNVS 生产配置安全检查（2026-11-17）

- 删除仓库中的示例签名“恒创联众”和模板 Code“100001”默认值；它们来自接口文档示例，不能推定为本账号已获批配置。
- Worker 现在要求 AccessKey ID/Secret、已批准签名和模板 Code 同时存在才会进入 Turnstile 后续发送流程；签名或模板缺失时 fail-closed，不发短信、不消耗 Turnstile token、不预留限流额度。
- 新增测试覆盖缺少签名或模板时返回统一服务配置错误且不调用 PNVS。生产环境需由账号持有人从 PNVS 控制台填写实际审批值。


## 本次增量里程碑（2026-11-18）：短信限流预留原子绑定窗口

- 修复短信配额预留的并发窗口竞态：原实现先执行 UPSERT，再单独 SELECT window_started_at；如果另一请求恰好在两条语句之间滚动到新窗口，失败回滚可能误减新窗口中另一请求的计数。
- reserveRateLimit 改为单条 SQLite UPSERT ... RETURNING window_started_at，返回值与本次原子更新绑定；回滚仍按 bucket_key + window_started_at 精确匹配。
- 扩展 PNVS 挑战持久化测试，模拟配额预留提交后、Worker 收到结果前另一请求滚动冷却窗口；验证明确拒绝的回滚不会扣减新窗口计数。
- 不新增 D1 迁移；不执行远程 D1、真实短信、Turnstile 或生产部署。


## 本次增量里程碑（2026-11-18）：登录密码验证时间侧信道缓解

- 普通用户和管理员登录在账号不存在、管理员停用或密码摘要损坏时执行固定成本 dummy PBKDF2；存在账号的错误密码路径同样执行一次 PBKDF2，减少响应耗时导致的账号枚举。
- 用户登录密码长度限制为 128 个字符；密码修改当前密码也增加长度上限，降低异常超长输入的 KDF 资源消耗。
- password-lifecycle-smoke.mjs 与 admin-auth-audit-smoke.mjs 通过包装 Web Crypto deriveBits，检查未知用户、错误密码、未知管理员、停用管理员均执行一次派生，限流请求不执行派生。
- 不新增 D1 迁移；本地完整项目 checkout 不可用，最终测试以 GitHub Actions 为准。未执行真实 D1、Turnstile、PNVS、备份或生产部署。


## 本次增量里程碑（2026-11-19）：验证码挑战生命周期并发安全

- 新增 `backend/migrations/0012_otp_challenge_lifecycle.sql`：OTP 挑战增加 `superseded_at`，并为未消费、未覆盖的挑战增加局部索引。
- 重新发送验证码时，先在同一 D1 batch 中覆盖同手机号、同用途的旧挑战并插入新挑战；若新挑战写入失败，batch 回滚，旧挑战仍有效。
- 采用安全优先策略：即使 PNVS 对新短信明确拒绝，旧挑战也保持失效，用户需重新申请；不允许回退到旧码。
- 验证尝试次数通过带 `RETURNING` 的条件 UPDATE 原子预留，检查手机号、用途、未消费、未覆盖、有效期和最大尝试次数。
- PNVS 核验成功后再次原子检查过期/覆盖/消费状态，避免验证码在外部网络往返期间过期或被新验证码覆盖后仍然完成业务操作。
- 新增 OTP 核验竞态测试，覆盖过期前置拦截、核验期间过期、核验期间被覆盖、并发五次尝试上限和并发单次消费。
- 本次仅提交代码与本地/CI 测试；未应用远程 D1 迁移、发送真实短信或部署 Worker。远程上线前需先按顺序应用 0012。


## 本次增量里程碑（2026-11-19）：高校目录 JSON 数据契约

- 新增 `data/university-catalog.schema.json` 与空模板，一级分类统一为 `mainland`、`hmt`、`overseas`；内地只收本科层次，特殊办学类型作为标签。
- 地域约束：内地精确到省（城市可选）；港澳台精确到地区；海外只到国家，校区位置遵循同样粒度。
- 单独区分多校区结构和是否存在正式分校；未核实使用 null/unknown，不允许把多校区直接推断成分校。
- 新增无外部依赖的目录校验器和 smoke tests，覆盖分类、地区、985/211/双一流标签、重复 ID/学校代码/规范化名称、校区完整度、来源与核验状态。
- GitHub Actions 已通过当前 PR 提交的全量检查；本次没有录入真实高校名单、修改 D1 迁移、执行远程数据库操作或部署。
- 当前高校目录数据契约 PR：待审核；合并后仍需由本地 AI/人工按官方来源填充目录，再设计 D1 兼容迁移与 dry-run 导入器。


## 本次增量里程碑（2026-11-20）：高校目录字段级证据约束

- 加强目录校验器：学校 ID 前缀必须与 mainland/HMT/overseas 分类及地区代码一致。
- 来源 supports_fields 限定为已定义的高校事实字段；HTTPS 来源 URL 禁止嵌入用户名/密码。
- verification.status=verified 不再仅凭“存在官方来源”通过：每个 verified_fields 必须被官方来源逐字段覆盖；名称、分类、学历层次、地域为最低必核字段；学校代码、项目标签、双一流学科和完整校区声明按实际填写情况增加核验要求。
- 扩充目录测试，覆盖字段覆盖不足、伪造字段名、凭据型 URL、ID 分类/地区错配和重复学校代码。
- 本次仅更新高校目录契约 PR；未导入真实高校数据、修改 D1 迁移、操作远程 D1 或部署。


## 本次增量里程碑（2026-11-20）：高校目录 D1 兼容关系型结构

- 新增 \`backend/migrations/0013_university_catalog_relational.sql\`：为 \`universities\` 增加稳定目录 ID、国家/省市、英文名、学校代码、学历层次、办学性质、校区完整度、核验状态等字段。
- 新增高校别名、标签、校区、来源和导入批次五张关系表；为目录 ID、国家感知规范化名称、学校代码、标签检索和主校区设置索引/约束。
- \`catalog_id IS NOT NULL\` 才代表正式目录记录；旧 \`normalized_name\` 和旧分类字段保留兼容，不自动合并 \`sino_foreign\`/\`unclassified\` 记录。
- 扩展 \`backend/tests/schema-smoke.py\`：按顺序执行全部迁移，在 0013 前插入旧中外合作高校、用户和队伍，验证迁移后原 ID/FK 不变；并测试目录唯一性、JSON 校验、标签、别名、校区、来源、导入批次和外键约束。
- 本次仅修改开发分支和 PR #6；未执行远程 D1 迁移、导入真实高校、读取用户数据或部署 Worker/Pages。生产 D1 是否已应用 0012/0013 仍需在用户终端核验。
- 下一步：只读 dry-run 规划器已在 2026-11-21 完成；后续先设计测试 D1 写入器、批次原子性/回滚和审计方案，不得直接连接生产库。

## 本次增量里程碑（2026-11-21）：高校目录只读导入计划器

- 新增 `scripts/plan-university-catalog-import.mjs`：先调用现有目录校验器，再读取严格白名单的高校快照，按 catalog_id、学校代码和国家感知规范化名称生成 insert/update/link_existing/skip/manual_review/conflict 计划。
- 旧记录仅同名时进入 manual_review；匹配依据指向不同记录、分类不一致或 dataset_version 复用但 checksum 改变时进入 conflict，不自动合并。
- 对已标记 merged 的记录，将 merged_into 解析为实际 D1 universities.id；目标无法安全解析时要求人工审核。
- 新增只读快照 SQL 与 JSON 模板；快照仅含高校目录字段和导入批次元数据，严格拒绝 phone 等未白名单字段。
- 规划器只输出 JSON，不连接 D1、不生成可执行 SQL、不执行 INSERT/UPDATE/DELETE；计划显式声明不修改 users、teams 和成员外键。
- 新增专项测试覆盖新增、精确 ID 更新、旧记录链接、同名人工审核、匹配分歧冲突、checksum 重放、合并目标主键映射和敏感字段拒绝。
- 本次未读取远程 D1、未应用 0013、未导入高校数据、未部署 Worker/Pages。生产导入仍需在确认迁移状态、备份恢复和测试 D1 演练后单独设计。


## 本次增量里程碑（2026-11-21）：高校目录导入对账安全加固

- 快照校验现在限制为现有 D1 分类集合，并验证国家/地区代码为大写 ISO alpha-2 或 null；规范化快照必须提供非空学校名称。
- 匹配时校验国家/地区代码，防止同一学校代码在不同国家/地区出现时被错误关联；旧记录缺少国家代码且仅凭学校代码命中时转人工审核。
- 已应用批次的相同版本与 checksum 不再仅凭 record_count 就直接 skip：必须逐条确认 catalog_id 仍存在，且分类、国家代码、国家感知规范化名称和学校代码一致；快照缺行或身份字段改变时标记 conflict。
- 新增回归测试覆盖跨国家学校代码冲突、缺少国家代码、目录 ID 国家不一致，以及已应用批次的缺行/身份变化。
- 最新开发分支提交：`62fe654e9184a8cf18902f14141e54861c1a2c32`；GitHub Actions 全部步骤通过（run 44882289045）。
- 本次只修改 GitHub 开发分支和 Draft PR #6；未执行远程 D1 查询/写入、迁移、真实短信、用户数据访问或 Worker/Pages 部署。

## 本次增量里程碑（2026-11-22）：高校目录只读搜索 API

- Worker 新增公开只读 GET /api/universities，供个人资料页按名称/别名/英文名/学校代码搜索规范化高校。
- 查询只返回 catalog_id 非空、catalog_status='active'、verification_status='verified' 且有 verified_at 的目录记录；旧版自由文本、草稿、待核验、停用和合并记录不会进入选择结果。
- 支持分类、国家代码、省份代码筛选；校验分类与国家/地区约束，省份筛选自动限定为内地/中国；限制 query 长度、limit（1–25）和 offset（0–1000）。
- SQL 使用参数绑定和 instr；学校代码只做受限字面前缀匹配；返回字段固定白名单，不读取或输出手机号、用户、队伍或审计资料。
- 新增 backend/tests/university-catalog-api-smoke.mjs，覆盖筛选、NFKC 规范化、分页、别名查询 SQL、畸形 JSON 安全降级、字段白名单和无效参数在访问 D1 前被拒绝。
- 不新增 D1 迁移；本次仅提交到高校目录 Draft PR #6，未导入真实高校、访问远程 D1、部署 Worker/Pages 或读取个人数据。
- 当前目录为空模板，因此搜索接口暂时返回空结果属于预期。高校目录搜索与 catalog_id 资料绑定已在 2026-11-22 的后续增量中完成，详见下文。


## 本次增量里程碑（2026-11-22）：高校目录绑定个人资料

- `GET /api/profile` 增加稳定 `universityCatalogId`，不暴露数据库内部 ID；在迁移 0013 尚未应用时回退读取旧字段，保持既有账号资料可读。
- `PUT /api/profile` 只接受 active、verified 且具有 verified_at 的高校目录记录；内地记录必须包含 undergraduate，国家/地区代码必须与 mainland/HMT/overseas 分类一致；名称和类别均从 D1 目录记录派生，不信任客户端提交的学校名称/类别。
- 新账号不能再通过自由文本创建 universities 记录；旧账号可继续保留原大学，只能更新个人字段，不能自行更换或重命名既有高校。
- 用户大学绑定使用 D1 universities.id，公开 catalog_id 仅作为选择标识；写入增加 university_id compare-and-set 条件，避免并发首次登记时相互覆盖。
- 前端高校类别收敛为 mainland/HMT/overseas，搜索 GET /api/universities 并从已核验结果选择；中外合作办学、军事、公安、民族、艺术、体育等本科高校归入内地目录。
- 新增 `backend/tests/university-catalog-profile-smoke.mjs`，覆盖伪造学校名称/类别、未核验记录、自由文本新建拒绝、旧账号兼容、跨校更换拒绝、并发 compare-and-set，以及未应用 0013 时 GET 兼容。
- 当前目录仍为空模板，因此新用户在目录填充并核验前无法完成高校资料提交；这是预期的 fail-closed 行为。没有导入高校、读取个人资料、执行远程 D1 迁移或生产部署。


## 本次增量里程碑（2026-11-23）：同队手机号展示的当前授权校验

- 修复 /api/directory 的手机号展示条件：不再仅依赖 phone_visible_to_team=1，还必须同时满足资料同意已勾选、资料同意时间存在、资料同意版本等于当前隐私说明版本，以及账号同意时间/版本有效。资料保存接口仅接受 JSON 布尔值 true 作为手机号展示授权；字符串 false、字符串 true、数字 1 均按关闭处理。
- 所有条件在 D1 查询的 CASE 中执行，未授权、撤回、旧版本或不完整同意记录均返回 phone: null；省级队长列表仍不查询、不返回手机号。
- 新增 backend/tests/directory-phone-consent-smoke.mjs，覆盖明确授权、关闭展示、旧版本、缺失同意时间、缺失账号同意和版本不匹配，并检查 SQL 侧强制执行隐私条件；扩展 university-catalog-profile-smoke.mjs 验证只有字面布尔值 true 可以开启手机号展示。
- 将专项测试接入 check:worker 与 test:worker。
- 不新增 D1 迁移；不访问远程 D1、真实用户数据、短信服务或生产部署。该测试使用隔离 Worker/D1 mock，真实浏览器和云端联调仍待执行。
