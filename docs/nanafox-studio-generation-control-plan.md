# NanaFox Studio 生图服务运营控制计划

## L1.1 引用验证

| 符号 | 证据 (file:line) | 签名 | 用途 |
|-----|-----------------|-----|-----|
| `readStudioServerConfig` | `studio-server/server.mjs:29` | `(env) -> config` | 保持密钥只从服务端环境读取 |
| `createGenerationService` | `studio-server/generationService.mjs:10` | `(options) -> service` | 所有新生图任务的共同入口 |
| `createStudioAdminApp` | `studio-server/adminApp.mjs:7` | `(options) -> app` | 复用 Router 管理员和 CSRF 边界 |
| `createPaymentStore` | `studio-server/paymentStore.mjs:16` | `(options) -> store` | 对照单例配置、版本冲突与审计实现 |

## L1.2 同类路径对照

参考实现：`studio-server/paymentStore.mjs:25-82`

- [x] 读取单例配置并映射为公开状态
- [x] 更新时锁行、校验版本、写审计日志
- [x] 决策：生图控制只复制约束，不复用支付领域对象，避免两个业务开关耦合

## L1.3 约定清单

| 约定 | 现状 | 我的选择 | 理由 |
|-----|-----|--------|------|
| 密钥来源 | 服务端环境变量 | 保持不变 | 不扩大泄漏面 |
| 运营写接口 | Router admin + same-origin + CSRF | 保持不变 | 与现有运营模块一致 |
| 并发更新 | `expectedVersion` | 保持不变 | 防止两个管理员互相覆盖 |
| 暂停语义 | 尚无运营开关 | 仅拒绝新建任务 | 不破坏进行中任务和历史作品 |

## L1.4 Return 语义

| return 形态 | caller 解读 | 测试名 |
|-----------|-----------|--------|
| 公开状态对象 | 可展示且不含敏感配置 | `generation control exposes only safe runtime status` |
| `GENERATION_NOT_ACCEPTING` | 503，用户可稍后重试 | `paused generation rejects before every side effect` |
| `GENERATION_CHANNEL_VERSION_CONFLICT` | 409，运营端刷新后重试 | `generation channel rejects stale updates` |
| `GENERATION_DEPLOYMENT_DISABLED` | 409，必须由部署人员开启 | `deployment master cannot be bypassed by operations` |

## L1.5 负向断言

| 输入 | 必须返回 | 测试断言 |
|-----|--------|--------|
| 运营开关关闭时新建任务 | 503 `GENERATION_NOT_ACCEPTING` | task/quota/provider/storage 调用均为 0 |
| 旧版本更新 | 409 version conflict | 数据与审计均不改变 |
| 非管理员或缺失 CSRF | 403/401 | 不调用控制模块更新方法 |
| 部署总开关关闭时运营恢复 | 409 deployment disabled | 不能将 `available` 变为 true |

## L1.6 回滚

| 类别 | 变更 | 回滚动作 | 顺序 |
|-----|-----|--------|------|
| 代码 | Studio 服务和前端增加控制能力 | 回滚到部署前 Studio 镜像 | 1 |
| 配置 | 无新增 Secret | 保留现有服务端环境变量 | 2 |
| 数据 | 新增独立单例表 | 保留空闲表，代码回滚后不会读取 | 3 |
| 告警 | 无新增外部告警 | 通过 health/ready 和错误率观察 | 4 |

回滚后可接受状态：恢复为仅由 `STUDIO_GENERATION_ENABLED` 控制的现有生图流程，Router 与作品数据不变。

## L2.1 运行时假设

| 假设 | 验证路径 | 环境 | 假设不成立时行为 |
|-----|--------|-----|--------------|
| Studio PostgreSQL 可迁移 | migration 010 + ready | 测试/生产 | readiness 失败，不切流 |
| Router 管理员解析可用 | `GET /api/admin/me` | 测试/生产 | 失败关闭运营接口 |
| 服务端生图凭证完整 | 脱敏布尔值 | 测试/生产 | `available=false`，不显示凭证 |
| 旧镜像忽略新表 | 暗部署与回滚演练 | 测试 | 回滚应用，不回滚表 |

## L2.2 状态机

```
Enabled + Accepting
  → 管理员带当前版本暂停
Enabled + Paused
  → 新任务在写入前返回 GENERATION_NOT_ACCEPTING
  → 已有任务继续运行、确认或恢复
  → 管理员带当前版本恢复
Enabled + Accepting

Deployment disabled
  → 运营端不能恢复部署能力

并发点：两个管理员同时更新同一开关。
防护：事务 FOR UPDATE + expectedVersion；只有第一个更新成功。
```

## L2.6 权限/安全

| 维度 | 回答 | 证据 |
|-----|-----|-----|
| 身份来源 | Studio session 对应的 Router identity | `studio-server/adminApp.mjs:23-45` |
| 授权边界 | 每次请求重新确认 Router admin | `studio-server/adminApp.mjs:28-45` |
| 凭证泄漏面 | 仅返回 configured 布尔值 | `studio-server/server.mjs:58-78` |
| SSRF | 运营端不能修改 Base URL | 本计划 API schema |
| 租户隔离 | 全局 Studio 运营开关，仅管理员可写 | 单例表 + admin route |
| 日志脱敏 | 审计只记录开关前后值 | `studio-server/paymentStore.mjs:69-81` 对照实现 |

## 目标与边界

Studio 继续通过服务端配置调用 Router Images API。运营端只展示脱敏后的运行状态，并允许 Router 管理员暂停或恢复“接收新的创作任务”。

- 不修改 Router/Sub2API 的代码、表结构或鉴权逻辑。
- 不把 `ROUTER_IMAGE_API_KEY`、Router Base URL、R2 凭证或对象存储标识写入 PostgreSQL、接口响应或浏览器。
- 不做会触发真实生图、产生费用或污染任务记录的健康探测。
- `STUDIO_GENERATION_ENABLED` 仍是部署级总开关；运营开关不能绕过它。

## 当前依据

- 部署配置只在服务端读取，生图开启时才加载 Router 与对象存储凭证：[studio-server/server.mjs](../studio-server/server.mjs#L29)。
- 所有真实生图请求汇聚到 `createGenerationService`，任务创建发生在额度冻结和供应商调用之前：[studio-server/generationService.mjs](../studio-server/generationService.mjs#L10)。
- 运营接口会在每次请求时重新确认 Router 管理员角色，写请求还校验同源与 CSRF：[studio-server/adminApp.mjs](../studio-server/adminApp.mjs#L7)。
- 支付总开关已采用 PostgreSQL 单例配置、乐观版本和审计日志，可复用同一约束而不引入新框架：[studio-server/paymentStore.mjs](../studio-server/paymentStore.mjs#L16)。

## L1 产品状态

### 状态模型

生图可用性由两个独立条件共同决定：

1. `masterEnabled`：部署环境的 `STUDIO_GENERATION_ENABLED`，只能由部署人员改变。
2. `acceptingGenerations`：Studio PostgreSQL 中的运营开关，Router 管理员可改变。

`available = masterEnabled && acceptingGenerations && providerKeyConfigured`。

### 行为矩阵

| 部署总开关 | 运营开关 | 新建任务 | 历史任务/作品 | 运营端操作 |
|---|---|---|---|---|
| 开 | 开 | 正常 | 正常 | 可暂停 |
| 开 | 关 | 503 `GENERATION_NOT_ACCEPTING` | 正常 | 可恢复 |
| 关 | 任意 | 503 `GENERATION_UNAVAILABLE` | 由现有只读接口提供 | 不允许从运营端开启部署能力 |

关闭运营开关时，拒绝发生在任务写入、额度冻结、供应商调用和对象存储之前。已经进入运行或最终确认阶段的任务继续按现有恢复流程完成。

## L2 接口与数据

### PostgreSQL

新增单例表 `studio_generation_channel`：

- `id = 1`
- `accepting_generations BOOLEAN NOT NULL DEFAULT TRUE`
- `version INTEGER NOT NULL`
- `updated_at BIGINT NOT NULL`

默认 `TRUE` 保持测试环境当前行为。更新使用事务、`FOR UPDATE`、`expectedVersion`，并写入 `studio_admin_audit_log`，action 为 `generation_channel.update`。

### 运营接口

- `GET /api/admin/generation-channel`
- `PATCH /api/admin/generation-channel`

GET 只返回：

```json
{
  "masterEnabled": true,
  "acceptingGenerations": true,
  "providerKeyConfigured": true,
  "available": true,
  "model": "gpt-image-2",
  "storage": "r2",
  "version": 1
}
```

PATCH 只接受 `acceptingGenerations` 与 `expectedVersion`。继续复用现有 Router 管理员鉴权、同源、JSON、双提交 CSRF 和错误封装。部署总开关关闭时，尝试恢复运营开关返回 409 `GENERATION_DEPLOYMENT_DISABLED`。

### 错误语义

- 运营暂停：503 `GENERATION_NOT_ACCEPTING`，不创建任务、不冻结额度、不调用供应商。
- 部署禁用：保留现有 503 `GENERATION_UNAVAILABLE`。
- 版本冲突：409 `GENERATION_CHANNEL_VERSION_CONFLICT`。
- 数据库或权限检查异常：失败关闭，不泄漏内部配置。

## L3 实现切片

1. 添加失败测试：运营状态接口、前端客户端、运营页面入口，以及暂停时的零副作用断言。
2. 添加 migration 010 和一个最小 `generationControl` 模块，集中负责状态读取、更新、审计和暂停断言。
3. 在 `createStudioRuntime` 中始终创建控制模块；只把脱敏状态交给运营接口，把暂停断言交给生图服务。
4. 运营端新增“生图服务”模块，展示部署状态、模型、存储类型、服务端凭证是否就绪与版本；唯一可写字段是“接收新的创作任务”。
5. 运行针对性测试、全量测试、Studio 构建和服务端测试，再部署到正确测试服务器。

## 验证门槛

- 单测证明暂停请求没有 `createTask`、`reserve`、`images.generate` 或 `outputs.save` 调用。
- 单测证明响应中不存在 API Key、Base URL、R2 endpoint/bucket/access key。
- 单测证明只有管理员、同源且 CSRF 正确的 PATCH 可以更新，旧版本被拒绝。
- 前端测试证明请求体只有开关与版本，运营导航存在“生图服务”。
- `npm test`、`npm run build`、`npm run build:studio`、`npm run test:studio-server` 全部通过。
- 部署前备份测试 PostgreSQL；暗部署检查 migration 010、health/ready 和匿名 401；切流后验证真实生图仍成功。

## 回滚

- 应用回滚到部署前镜像；migration 010 为向前兼容的独立新表，无需破坏性回滚。
- 如运营开关误关，使用当前版本号恢复为 `TRUE`；如服务异常，保持失败关闭并回滚镜像。
- 任何回滚都不修改 Router/Sub2API，也不旋转或迁移现有密钥。
