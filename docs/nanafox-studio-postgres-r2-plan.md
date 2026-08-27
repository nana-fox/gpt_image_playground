# NanaFox Studio PostgreSQL + R2 落地计划

## 结论与边界

- Studio 复用现有 PostgreSQL 服务实例，但使用独立数据库 `nanafox_studio`、独立账号和独立连接串。
- 不修改 Router/Sub2API 业务表；Router 仍只提供身份校验，Studio 保存 `identity_subject` 映射。
- PostgreSQL 保存用户、会话、额度、订阅、任务和作品元数据；R2 私有 Bucket 保存作品文件。
- 测试与生产使用不同数据库、Bucket 和最小权限凭证。

## L1.1 引用验证

| 符号 | 证据 (file:line) | 签名 | 用途 |
|-----|-----------------|-----|-----|
| `readStudioServerConfig` | `studio-server/server.mjs:18` | `(env = process.env) -> config` | 将 SQLite 文件配置改为 PostgreSQL 连接配置 |
| `createStudioRuntime` | `studio-server/server.mjs:123` | `(config = readStudioServerConfig()) -> runtime` | 建立连接池、执行迁移并组装 Store |
| `createSessionStore` | `studio-server/sessionStore.mjs:6` | `(options = {}) -> store` | 用户和会话持久化 |
| `createQuotaStore` | `studio-server/quotaStore.mjs:12` | `(options = {}) -> store` | 免费额度、订阅、加量包和预占事务 |
| `createGenerationTaskStore` | `studio-server/generationTaskStore.mjs:12` | `(options = {}) -> store` | 任务幂等和状态机 |
| `createArtworkStore` | `studio-server/artworkStore.mjs:16` | `(options = {}) -> store` | 由本地文件实现替换为 R2 实现 |

## L1.2 同类路径对照

参考实现：`studio-server/quotaStore.mjs:176-233`

- [x] 事务内释放过期预占；PostgreSQL 使用同一 client，不跨连接。
- [x] 额度选择和扣减并发保护；使用 `FOR UPDATE SKIP LOCKED` 或条件更新。
- [x] `user_id + idempotency_key` 唯一约束保持不变。
- [x] 失败必须回滚，生成失败后释放付费额度。
- [x] 管理员加额继续使用 `user_id + reference` 幂等。

## L1.3 约定清单

| 约定 | 现状 | 我的选择 | 理由 |
|-----|-----|--------|------|
| 数据库隔离 | Studio SQLite 文件 | 同 PostgreSQL 实例、独立 database/role | 节省运维成本且不污染 Router 数据 |
| 时间存储 | Unix 毫秒整数 | PostgreSQL `BIGINT`，API 仍输出 ISO 时间 | 首次迁移保持行为一致，减少范围 |
| Store API | 同步方法 | 改为 Promise，调用点显式 `await` | `pg` 是异步客户端 |
| Schema 变更 | Store 启动时建表 | 有序 SQL migrations + advisory lock | 多实例启动安全、可审计 |
| 作品访问 | 后端读取本地文件 | 后端鉴权后返回短时签名 URL/重定向 | 不暴露长期公开地址和凭证 |
| R2 环境 | 无 | test/prod 独立 Bucket 和 Token | 降低误删和凭证泄漏影响面 |

## L1.4 Return 语义

| return 形态 | caller 解读 | 测试名 |
|-----------|-----------|--------|
| `Promise<session>` | 登录成功并设置 Cookie | `creates and restores a PostgreSQL session` |
| `Promise<null>` | 会话不存在或已过期，返回 401 | `removes an expired PostgreSQL session` |
| `Promise<reservation>` | 额度已在同一事务中预占 | `serializes concurrent quota reservations` |
| rejected `QuotaError` | 额度不足或状态冲突，不生成图片 | `does not overspend a single credit concurrently` |
| `Promise<task>` | 合法任务状态迁移完成 | `preserves generation task idempotency` |
| rejected storage error | 不确认额度，任务失败并释放预占 | `releases quota when R2 upload fails` |

## L1.5 负向断言

| 输入 | 必须返回 | 测试断言 |
|-----|--------|--------|
| 缺少 `STUDIO_DATABASE_URL` | 启动失败 | error 含变量名 |
| 两个并发请求消费最后 1 次额度 | 仅一个成功 | 一个 reserved、一个 `QUOTA_EXHAUSTED` |
| 相同幂等键但提示词不同 | 稳定冲突 | `IDEMPOTENCY_CONFLICT` |
| R2 返回非成功状态 | 不确认额度 | reservation 为 released |
| 用户访问他人作品 | 404/403，不签发 URL | 未调用签名函数 |
| R2 Key 不满足对象路径规则 | 拒绝读取/删除 | storage validation error |

## L1.6 回滚

| 类别 | 变更 | 回滚动作 | 顺序 |
|-----|-----|--------|------|
| 代码 | Store 异步化、PostgreSQL/R2 实现 | 切回保留的上一版 Studio 镜像 | 1 |
| 配置 | `STUDIO_DATABASE_URL`、R2 凭证 | 恢复旧容器的 SQLite Volume 配置 | 2 |
| 数据 | 新建 Studio database 和 R2 test Bucket | 保留只读用于排障；确认无新数据后再清理 | 3 |
| 告警 | PostgreSQL/R2 健康检查 | 随回滚镜像移除对应探针 | 4 |

回滚后可接受状态：测试站回到 SQLite 和本地作品 Volume；Router、Playground、Sub2API 均不重启、不改表。生产未切换前不存在生产回滚数据差异。

---

## L2.1 运行时假设

| 假设 | 验证路径 | 环境 | 假设不成立时行为 |
|-----|--------|-----|--------------|
| 现有 PostgreSQL 实例可创建独立 database/role | 只读检查版本、连接数和磁盘，再建 test DB | test | 使用独立 PostgreSQL 容器，不共用实例 |
| `pg` 连接池可覆盖当前单实例负载 | 并发额度集成测试 + 连接池指标 | isolated test DB | 降低 pool size，不增加应用实例 |
| R2 S3 API 可从日本服务器稳定访问 | Bucket 级 PUT/GET/DELETE 小文件测试 | test Bucket | 改用 OSS Tokyo，不改 Store 上层契约 |
| 现有 SQLite 仅测试数据 | 导出用户/任务/额度行数核对 | test | 执行一次性导入脚本后再切换 |

## L2.2 状态机

```text
生成请求 → PostgreSQL 创建幂等任务
  → 同一事务预占免费次数或付费额度
  → 调用生图提供方
  → R2 上传成功
  → PostgreSQL 写作品元数据并确认额度

失败分支：
  Provider 失败 → 释放预占 → 任务 failed
  R2 上传失败 → 释放预占 → 任务 failed
  DB 确认暂时失败 → 保持 output_stored → 启动恢复任务重试

并发点：同一用户最后一份额度和同一 Idempotency-Key。
防护：唯一约束、行锁、条件更新和单事务。
```

## L2.6 权限/安全

| 维度 | 回答 | 证据 |
|-----|-----|-----|
| 身份来源 | Router 签名身份换取 Studio Session | `studio-server/authApp.mjs:124` |
| 授权边界 | Studio 数据库仅接受 Studio role；作品查询必须带 user_id | `studio-server/generationApp.mjs:32` |
| 凭证泄漏面 | PostgreSQL/R2 Secret 仅在服务器环境变量，不进前端和仓库 | deployment secret injection |
| SSRF | R2 endpoint 由部署配置固定，不接受用户输入 | server config |
| 租户隔离 | 所有用户任务/作品读取同时匹配 user_id | `studio-server/generationTaskStore.mjs:96` |
| 日志脱敏 | 不记录连接串、Token、Secret、签名 URL | structured error logging |

## L2-ops.1 可观测性

| 失败模式 | 日志 | 指标 | 告警规则 | 可区分状态? |
|---------|-----|-----|--------|------------|
| PostgreSQL 不可连接 | `studio.database_unavailable` | health 503 | 连续 3 次失败 | 是 |
| migration 失败 | `studio.migration_failed` | readiness false | 每次触发告警 | 是 |
| R2 上传失败 | `studio.artwork_upload_failed` | 按状态码计数 | 5 分钟 > 3 | 是 |
| 额度最终确认失败 | `studio.finalization_pending` | pending 数量 | 15 分钟仍存在 | 是 |

## L2-ops.2 兼容灰度

| 维度 | 问题 | 处理 |
|-----|-----|-----|
| 老调用方 | 前端 API 是否变化 | 保持现有响应结构和 Cookie 行为 |
| 第三方 shape 漂移 | R2/S3 错误不同 | 统一为作品存储错误并记录 request id |
| feature flag | 是否双写 SQLite | 不双写；测试站一次性切换 |
| 新旧对比 | 如何比较 | 同一套服务端测试分别跑旧 Store 和 PostgreSQL Store |
| 回滚污染 | 新数据如何处理 | 测试期允许回滚后新数据暂不可见，保留 PostgreSQL/R2 不删除 |

## 分阶段实现

1. PostgreSQL 1:1 迁移现有表和行为，完成异步化与并发集成测试。
2. 测试站切 PostgreSQL，验证登录、3 次免费额度、管理员加额、真实生图、重启持久化。
3. 开通 R2 test Bucket 和最小权限 Token，替换本地作品存储。
4. 增加 `studio_artworks` 元数据表、短时签名访问和删除闭环。
5. 配置 PostgreSQL 备份及 NAS 增量拉取，做一次恢复演练。

## 剩余风险登记

| 项 | 接受/已知/待后续 | Owner | Follow-up ticket |
|----|----------------|------|-----------------|
| R2 APAC 不保证日本落点 | 已知；若产品需要日本驻留则换 OSS/S3 Tokyo | Product/Infra | 上线前数据驻留确认 |
| SQLite 测试数据是否保留 | 切换前核对并一次性迁移 | Engineering | PostgreSQL cutover |
| 付费渠道尚未确定 | 当前先保留订阅/额度内部模型 | Product | Payment integration |
