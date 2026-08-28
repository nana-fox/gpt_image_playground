# NanaFox Studio 作品删除与保留计划

> 状态：2026-08-28 已部署公网测试环境。全部逻辑位于 Studio；Router/Sub2API 不增加接口、不修改数据或任务状态。

## 用户旅程

- 作为创作者，我删除作品后希望它立刻离开作品库，但误删时仍可在 7 天内恢复。
- 作为创作者，我希望只有自己能查看、删除或恢复自己的作品。
- 作为运营方，我希望过期作品从 R2 自动删除，失败会重试，数据库不会假装已经清理成功。

## L1.1 引用验证

| 符号 | 证据 (file:line) | 签名 | 用途 |
|-----|-----------------|-----|-----|
| `createStudioGenerationApp` | `studio-server/generationApp.mjs:10` | `(options = {}) -> generationApp` | 增加本人删除、最近删除和恢复 API |
| `createGenerationTaskStore` | `studio-server/generationTaskStore.mjs:13` | `(options = {}) -> taskStore` | 在现有任务行保存删除与清理状态 |
| `createR2ArtworkStore` | `studio-server/r2ArtworkStore.mjs:8` | `(options = {}) -> artworkStore` | 复用现有私有对象删除能力 |
| `createArtworkStore` | `studio-server/artworkStore.mjs:15` | `(options = {}) -> artworkStore` | 保持本地开发模式语义一致 |
| `createGenerationRuntime` | `studio-server/server.mjs:285` | `(config, sessions, quota, tasks) -> generationRuntime` | 启动并停止清理循环 |
| `listStudioGenerations` | `src/lib/studioGeneration.ts:72` | `(viewOrRequest = 'active', request = fetch) -> Promise<StudioGenerationTask[]>` | 扩展 active/deleted 作品读取与删除恢复请求 |
| `WorksPage` | `src/studio/StudioApp.tsx:395` | `({ tasks, addTask, removeTask, useWork }) -> JSX` | 增加最近删除与用户反馈 |
| `TaskModal` | `src/studio/StudioApp.tsx:545` | `({ task, onClose, onReuse, onDelete, onRestore }) -> JSX` | 增加二次确认、删除和恢复动作 |

## L1.2 同类路径对照

参考：生成失败时 `studio-server/generationService.mjs` 的对象清理与状态补偿。

- [x] 先让用户视图不可见，再异步删除对象；对象删除失败不把数据库标成已清理。
- [x] R2 与 filesystem 都复用 `outputs.remove(output)`，不增加存储供应商分支。
- [x] 删除、恢复均要求 Studio Session、同源请求和 CSRF；他人任务统一 404。
- [x] 清理操作幂等；对象已不存在时仍可完成墓碑更新。
- [x] 不退回额度；删除作品不改变已完成创作的计费事实。

## L1.3 约定清单

| 约定 | 现状 | 我的选择 | 理由 |
|-----|-----|--------|------|
| 数据模型 | 一任务一作品，元数据在 `output_json` | 在任务行增加 `deleted_at`、`purge_after`、`purged_at` | 不提前拆新作品表 |
| 默认保留 | 成功作品展示在作品库 | 用户删除前保留 | 符合用户对作品库的预期 |
| 恢复窗口 | 文档约定 7 天恢复、最迟 30 天硬删除 | 精确 7 天后进入清理 | 简单、可解释且省存储 |
| 清理频率 | 无后台任务框架 | 启动执行一次，之后每 6 小时执行 | 不引入队列或新依赖 |
| 墓碑 | 幂等键必须稳定 | 清空 `output_json`，保留任务和删除时间 | 防止旧幂等键重新扣费生成 |

## L1.4 Return 语义

| return 形态 | caller 解读 | 测试 |
|-----------|-----------|------|
| 删除返回 soft-deleted task | 从正常列表移除，加入最近删除 | `soft deletes and restores only the owner's completed artwork` |
| 删除/恢复返回 `null` | 不存在、越权、非成功作品或已过期 | API 统一 404 |
| purge 成功 | 持有任务行锁时删除 R2，随后清空 `output_json` 并写 `purged_at` | `purges expired outputs only after storage deletion` |
| purge 失败 | 保持待清理行，下轮重试 | `keeps failed storage deletions pending` |

## L1.5 负向断言

| 输入 | 必须返回 | 断言 |
|-----|--------|------|
| 无 Session | 401 | 不查询任务、不删对象 |
| Origin 或 CSRF 不匹配 | 403 | 不改变任务 |
| 他人 task id | 404 | 不泄露任务是否存在 |
| running/failed 任务 | 404 | 不进入作品回收站 |
| 恢复已过 7 天任务 | 404 | `deleted_at` 不变化 |
| R2 DELETE 失败 | 任务仍 `purged_at IS NULL` | 下次清理可重试 |

## L1.6 回滚

| 类别 | 变更 | 回滚动作 | 顺序 |
|-----|-----|--------|------|
| 代码 | 删除/恢复 API、UI、清理循环 | 切回上一 PostgreSQL 兼容镜像 | 1 |
| 配置 | 无新增必填配置 | 无 | 2 |
| 数据 | migration 006 三个可空列和索引 | 保留；旧代码忽略新增列 | 3 |
| 对象 | 已过恢复期且已清理的 R2 对象 | 只能从 NAS/R2 备份恢复 | 4 |

回滚后可接受状态：旧镜像继续读取未删除任务；已经软删除的任务会再次出现在旧版作品库，因此生产回滚前应临时隐藏作品入口或继续使用支持软删除的镜像。

## L2.1 运行时假设

| 假设 | 验证路径 | 环境 | 假设不成立时 |
|-----|--------|-----|--------------|
| R2 DELETE 对不存在对象幂等成功 | 私有 R2 集成测试 | 测试 | Store 适配成 ENOENT 也视为已删除 |
| 单次待清理量首发很小 | `LIMIT 100` 查询与日志 | 测试/生产 | 超过阈值再做队列或分页 worker |
| Node 长时间运行 | 启动 + 6 小时 interval | 测试/生产 | 每次启动仍补跑，不丢清理任务 |

## L2.2 状态机

```text
succeeded + active
  -> 用户 DELETE：deleted_at=now, purge_after=now+7d，正常列表立即隐藏
  -> 7 天内恢复：deleted_at/purge_after 清空，回到 active
  -> 到期清理：outputs.remove(output)
       成功/对象已不存在 -> output_json=NULL, purged_at=now，保留墓碑
       失败 -> 数据库不变，下一轮重试
```

并发：删除与恢复都以当前列条件更新；清理用 `FOR UPDATE` 锁定单个到期任务，在同一数据库事务内先删对象、后写墓碑。恢复会等待该行锁，避免作品恢复成功后对象又被后台删除；R2 失败时事务回滚并在下一轮重试。

## L2.6 权限/安全

| 维度 | 回答 | 证据 |
|-----|-----|-----|
| 身份来源 | Studio HttpOnly Session | `studio-server/generationApp.mjs:22` |
| 授权边界 | SQL 同时匹配 `user_id` 与 `id` | `studio-server/generationTaskStore.mjs:96` |
| CSRF | DELETE/restore 与生成写请求相同的 Origin + double-submit Cookie | `studio-server/generationApp.mjs:64` |
| 对象泄漏 | 浏览器仍只拿同源作品 URL，不拿 R2 key | `studio-server/generationApp.mjs:138` |
| 计费 | 删除和恢复不调用 quota | generation API 测试断言 |

## L2-ops.1 可观测性

| 失败模式 | 日志 | 检查/告警 | 可区分状态？ |
|---------|-----|----------|-------------|
| R2 删除失败 | task id + bounded error，不记录 key/提示词 | 连续两轮仍 pending 告警 | 是：pending 未写 `purged_at` |
| 清理循环异常 | `Studio artwork retention cleanup failed` | 6 小时无成功运行告警后续接入 | 是 |
| 用户恢复过期 | 稳定 404，不记录敏感内容 | 产品提示 7 天期限 | 与权限失败对外不可区分 |

## 剩余风险登记

| 项 | 状态 | Owner | Follow-up ticket |
|----|------|------|-----------------|
| 当前无 R2 作品异机备份 | 生产阻断；PostgreSQL 已进 NAS，作品仍需独立只读 R2 Token 和 NAS 增量同步 | NanaFox ops | `studio-artwork-backup-restore` |
| 清理指标首发只用结构化日志 | 已知，首批真实用户后接监控 | NanaFox ops | `studio-retention-metrics` |

## 测试发布证据

- RED commit `086d5b5`，GREEN commit `8b025ff`；migration 006 已应用到独立 Studio 测试数据库。
- 前端 50 个文件、599 个测试通过；Studio 服务端本地 108 项零失败，测试服务器真实 PostgreSQL/R2 运行 108/108 且无跳过。
- 切换前 dump 位于 `/home/nio/backups/nanafox-studio-test/pre-artwork-retention-20260828T052636Z/`，大小 33,960 bytes，`pg_restore -l` 有 83 行，SHA-256 为 `c72bfaa9e7720d2b9f75ee9b6aa5d2a25b40f6e1550ac6c5d7e4bbf74d1cdc9b`。
- 8790 暗部署与公网 8788 的 health/readiness 均通过；迁移前后保持 2 个用户、1 个生成任务、0 个加额和 0 个支付订单。
- 公网未登录作品列表、最近删除、删除、恢复和运营接口均为 401；Studio 仍只监听 `127.0.0.1:8788`。
- 当前测试镜像为 `nanafox-studio:test-8b025ff-path`，上一版本保留为停止容器 `nanafox-studio-test-rollback-1a715b6-20260828`。
- Chrome 已确认现有 Studio 标签页，但刷新与 DOM 通道连续超时；本次不把登录后作品库视觉验收记为通过。
