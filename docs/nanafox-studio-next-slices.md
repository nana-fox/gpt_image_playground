# NanaFox Studio 后续开发切片

> 范围：Studio 产品功能、可靠性和测试部署。ICP备案、微信支付申请、商户 Secret 与真实资金验收由其他任务处理；本计划不修改 Router 的用户、额度或支付语义。

## L1.1 引用验证

| 符号 | 证据 (file:line) | 签名 | 用途 |
|-----|-----------------|-----|-----|
| `StudioAuthPage` | `src/studio/StudioApp.tsx:91` | React component | 保持 NanaFox Studio 品牌内的登录、找回和重置交互 |
| `createStudioAuthApp` | `studio-server/authApp.mjs:10` | `(options) => { handle(request) }` | 同源输入校验、限流和 Router adapter 调用 |
| `createRouterAuthClient` | `studio-server/routerAuthClient.mjs:16` | `(options) => RouterAuthClient` | 复用现有 HMAC 签名通道，不让浏览器直接调用 Router |
| `createSessionStore` | `studio-server/sessionStore.mjs:5` | `(options) => SessionStore` | 重置成功后撤销该用户全部 Studio Session |
| `ForgotPassword` | `../../../../sub2api/backend/internal/handler/auth_handler.go:583` | Gin handler | 公开找回流程的现有行为对照 |
| `RequestPasswordResetAsync` | `../../../../sub2api/backend/internal/service/auth_service.go:1246` | Go service method | 复用邮件和 token 逻辑，不在 Studio 重写 |
| `ResetPassword` | `../../../../sub2api/backend/internal/service/auth_service.go:1270` | Go service method | 复用密码更新和 Router 会话撤销逻辑 |
| `createGenerationService` | `studio-server/generationService.mjs:10` | `(options) => GenerationService` | 已完成的超时恢复和额度释放入口 |
| `createGenerationTaskStore` | `studio-server/generationTaskStore.mjs:13` | `(options) => GenerationTaskStore` | 已完成的单用户活跃任务数据库约束 |

## L1.2 同类路径对照

参考实现：`../../../../sub2api/backend/internal/server/routes/auth.go:58`

- [x] 注册、登录继续走 Studio 同源 API 和 Router 内部签名 adapter。
- [x] 找回、重置复用 Router service，但不复用 Router 前端页面；decision: 避免用户跳出 Studio，同时不复制账户核心逻辑。
- [x] Router adapter 只接收固定 Studio reset base URL；decision: 浏览器不能提交任意回跳地址。

## L1.3 约定清单

| 约定 | 现状 | 我的选择 | 理由 |
|-----|-----|--------|------|
| 用户主数据 | Router 管理密码、邮件和 2FA | 继续由 Router 唯一负责 | 避免双写和密码数据复制 |
| Studio Session | PostgreSQL 独立保存 | 重置成功后按用户全部撤销 | Router 改密不能自动删除 Studio Session |
| 错误文案 | 找回不得枚举邮箱 | 已注册、未注册和禁用邮箱返回同形态成功 | 防账户枚举 |
| 限流 | Studio 已有 PostgreSQL 账号/IP bucket | 为 forgot/reset 增加独立 bucket，故障时 fail-close | 不新增 Redis 或第二套限流框架 |
| 生图并发 | migration 008 partial unique index | 每用户最多一个 `created/reserved/running` | 数据库约束比进程内锁可靠 |
| CI | PR 不持有 R2 Secret | PostgreSQL 必跑，R2 保留测试部署门禁 | 避免 Secret 暴露给 PR |

## L1.4 Return 语义

| return 形态 | caller 解读 | 测试名 |
|-----------|-----------|--------|
| forgot `200 { accepted: true }` | 无论邮箱是否存在都提示检查邮件 | `forgot password does not enumerate accounts` |
| reset `200 { reset: true }` | 清除 URL token，返回登录模式 | `reset password returns to Studio login` |
| `429 AUTH_RATE_LIMITED` + `Retry-After` | 留在当前页面并显示剩余时间 | `password recovery fails closed behind account and IP limits` |
| `4xx INVALID_RESET_TOKEN` | 不创建 Session，不泄漏 Router 内部错误 | `invalid reset tokens stay bounded` |
| `429 GENERATION_BUSY` | 不调用 Provider、不预占第二份额度 | `a concurrent generation returns a stable busy response without leaking database details` |
| `503 GENERATION_RECOVERY_TIMEOUT` | 已释放预占，允许用户重新提交新幂等键 | `startup recovery expires only stale active tasks and preserves output finalization` |

## L1.5 负向断言

| 输入 | 必须返回 | 测试断言 |
|-----|--------|--------|
| 未注册或禁用邮箱请求找回 | 与有效邮箱相同的状态和正文 | 不出现 `USER_NOT_FOUND` |
| 任意浏览器回跳 URL | `400 VALIDATION_ERROR` 或字段被忽略 | Router 只使用服务端固定 base URL |
| 过期、错误或已消费 token | 统一无效提示 | 不改密码、不创建 Session |
| 同 token 并发提交 | 仅一次成功 | token consume 必须原子化且 fail-close |
| 重置成功后的旧 Studio Cookie | `401 UNAUTHENTICATED` | 该 subject 的 Studio Session 全部删除 |
| 同用户第二个活跃生成 | `429 GENERATION_BUSY` | Provider 调用和额度预占次数不增加 |

## L1.6 回滚

| 类别 | 变更 | 回滚动作 | 顺序 |
|-----|-----|--------|------|
| 代码 | Studio UI/API 与 Router 两条 adapter 路由 | 分别 `git revert` 对应提交 | 1 |
| 配置 | Studio reset base URL | 关闭 adapter 路由配置，保留现有登录注册 | 2 |
| 数据 | migration 008 唯一索引 | 保留失败任务和额度修复结果；只在旧镜像无法启动时删除该索引 | 3 |
| 告警 | recovery/429 计数 | 保留日志，移除失效规则 | 4 |

回滚后可接受状态：现有登录、注册、2FA、创作和作品不受影响；暂时隐藏“忘记密码”入口，不回滚已安全释放的过期额度。

---

## L2.1 运行时假设（横切 feature 必填）

| 假设 | 验证路径 | 环境 | 假设不成立时行为 |
|-----|--------|-----|--------------|
| Router 邮件服务和 reset token 可用 | 有效邮箱完成一笔找回 | 隔离测试 | 保持入口但显示服务不可用，不降级为 Studio 自建 token |
| Caddy 覆盖客户端提供的转发头 | 伪造 `X-Forwarded-For` 负向请求 | 测试公网 | 未确认前不把 IP bucket 作为唯一防线 |
| migration 008 升级不丢数据 | 007 数据样本升级测试 | 临时 PostgreSQL + 测试库备份 | 迁移失败不切换容器 |
| Docker 运行镜像可读 PostgreSQL | `/api/ready` | CI + 暗部署 | health 成功但 ready 失败仍禁止切换 |
| R2 合约保持私有 | PUT/GET/冲突/DELETE 探针 | 测试 Bucket | 不开放公网 Bucket，不跳过测试部署门禁 |

## L2.2 状态机（多账号/重试/并发必填）

```text
Login: 登录页
  → ForgotRequested: 提交邮箱并统一返回 accepted
  → ResetLink: 用户从邮件进入 Studio 固定 reset 路由
  → Resetting: 提交邮箱、token、新密码
    分支 A: 成功 → Router 撤销 refresh session + Studio 删除该用户 Session → Login
    分支 B: token 无效/过期 → 留在 ResetLink，允许重新申请
    分支 C: 限流/依赖失败 → 留在当前页，按 Retry-After 重试

GenerationIdle
  → Active(created/reserved/running)
    分支 A: 第二请求 → 429 GENERATION_BUSY
    分支 B: 15 分钟内完成 → output_stored → succeeded
    分支 C: 启动发现超时 → release reservation → failed
并发点：同一用户的任务创建与同一 reset token 的消费。
防护：PostgreSQL partial unique index；reset token 原子 compare-and-delete。
```

## L2.6 权限/安全

| 维度 | 回答 | 证据 |
|-----|-----|-----|
| 身份来源 | 密码与邮箱归 Router；Studio 仅保存 subject 映射 | `studio-server/sessionStore.mjs:32` |
| 授权边界 | 浏览器只访问 Studio 同源接口；Router adapter 必须 HMAC 验签 | `studio-server/routerAuthClient.mjs:28` |
| 凭证泄漏面 | reset token 不进日志，页面读取后立即清除 query | `src/studio/StudioApp.tsx:91` |
| SSRF | reset base URL 只能来自 Router 服务端配置 | `../../../../sub2api/backend/internal/service/auth_service.go:1215` |
| 租户隔离 | Session 删除按 Router subject 对应的 Studio user | `studio-server/sessionStore.mjs:32` |
| 日志脱敏 | 仅记录 reason/request id，不记录密码、token、邮箱全文 | `studio-server/authApp.mjs:124` |

## L2-ops.1 可观测性

| 失败模式 | 日志 | 指标 | 告警规则 | 可区分未触发 / 触发失败 / 成功空? |
|---------|-----|-----|--------|--------------------------------|
| 找回依赖失败 | `studio.auth.recovery_failed`，不含 token | 5xx 计数 | 15 分钟 >= 5 | 是，reason 区分 Router/邮件依赖 |
| 找回被限流 | 现有 rate limit reason | 429 计数 | 单 IP 15 分钟持续超限 | 是，scope 区分账号/IP |
| 旧 Session 撤销失败 | `studio.auth.session_revoke_failed` | 失败计数 | 任意一次 | 是，成功必须记录删除数量 |
| 生图超时恢复 | `GENERATION_RECOVERY_TIMEOUT` | 任务数 | 1 小时 >= 3 | 是，与 Provider 失败分开 |
| readiness 失败 | 容器 health + `/api/ready` | 503 计数 | 连续 3 次 | 是，`/api/health` 仍可区分进程存活 |

## L2-ops.2 兼容灰度

| 维度 | 问题 | 处理 |
|-----|-----|-----|
| 老调用方 | 现有登录、注册、2FA 是否变化 | 只新增路径和 UI mode，原路径契约零变化 |
| 第三方 shape 漂移 | Router 错误结构变化 | 沿用 `RouterAuthError` 的有界解析 |
| feature flag | 是否需要灰度开关 | Router adapter 配置未启用时 Studio 隐藏找回入口 |
| 新旧对比 | 如何比较 | 测试环境同时验证 Router 公开流程和 Studio adapter 结果一致 |
| 回滚污染 | 已写入的数据 | 找回不新增业务表；Session 撤销不可逆但安全可接受 |

## 执行顺序

1. 发布 `72820ea`、`de4d160`、`5fcc370` 到测试环境：先备份，再在暗端口应用 migration 008，验证真实 PostgreSQL/R2 和 Router/Studio 健康。
2. 公开测试 URL 验证额度失败重试、作品失败重试、同用户并发生图 `429` 和重启后无 stale reservation。
3. 在 Sub2API 独立 worktree 实现 reset token 原子消费和两条 Studio adapter；定向 Go 测试全绿后才修改 Studio。
4. 在 Studio 实现 branded forgot/reset 页面、独立限流、全部 Session 撤销和同源客户端测试。
5. 再次走备份、暗部署、真实邮件找回和旧 Session 失效验收；生产发布仍单独授权。

## 剩余风险登记

| 项 | 接受/已知/待后续 | Owner | Follow-up ticket |
|----|----------------|------|-----------------|
| GitHub CI 尚未在真实 runner 构建容器 | 已知，首次 push 后确认 | Studio maintainer | STUDIO-CI-001 |
| PR CI 不运行 R2 live Secret | 接受，测试部署强制运行 | Studio maintainer | STUDIO-R2-GATE |
| Router reset token 原子消费 | 已完成，并发二次消费返回失败 | Router maintainer | ROUTER-AUTH-RESET-001 closed |
| 测试环境密码找回开关未启用 | 已知，签名 adapter 已达 Router 业务层并返回 `PASSWORD_RESET_DISABLED` | Infrastructure owner | ROUTER-TEST-RECOVERY-CONFIG |
| PostgreSQL/Redis 端口整改属于共享基础设施 | 待独立维护窗口，不在本切片改 Sub2API | Infrastructure owner | INFRA-NET-001 |
| 真实微信支付与备案 | 已拆分到其他任务 | Product owner | EXTERNAL-PAYMENT-ICP |
