# NanaFox Studio 账户入口防刷计划

> 状态：2026-08-28 实施基线。限流由 Studio 自己的 PostgreSQL 承担，不修改 Router/Sub2API 接口或业务逻辑。

## L1.1 引用验证

| 符号 | 证据 (file:line) | 签名 | 用途 |
|-----|-----------------|-----|-----|
| `createStudioAuthApp` | `studio-server/authApp.mjs:7` | `(options) -> authApp` | 在转发 Router 前执行统一限流 |
| `createStudioDatabase` | `studio-server/database.mjs:7` | `(options) -> database` | 使用现有 PostgreSQL 事务与 migration |
| `createStudioRuntime` | `studio-server/server.mjs:199` | `(config) -> runtime` | 注入限流 Store，不增加 Router 依赖 |
| `normalizeEmail` | `studio-server/authApp.mjs:149` | `(value) -> email` | 标准化后再按邮箱限流，避免大小写绕过 |

## L1.2 同类路径对照

参考实现：`studio-server/paymentStore.mjs:33`

- [x] PostgreSQL 单事务更新计数，避免多进程内存计数不一致。
- [x] 只保存 HMAC 后的邮箱、IP、挑战令牌，不保存原值。
- [x] Router 只在 Studio 限流通过后被调用，原签名客户端保持不变。

## L1.3 约定清单

| 约定 | 现状 | 我的选择 | 理由 |
|-----|-----|--------|------|
| 部署形态 | 当前单实例，未来可横向扩容 | PostgreSQL 集中计数 | 重启和多实例不能绕过 |
| 客户端 IP | Studio 只监听本机，由 Caddy 代理 | 使用 Caddy 写入的 `X-Forwarded-For` 首个有效 IP | 8788 不对公网开放，信任边界明确 |
| 隐私 | 邮箱/IP 属于敏感信息 | 使用 Router 签名 Secret 做域隔离 HMAC | 不增加新 Secret，不保存可直接检索原值 |
| 响应 | Router 错误已有统一封装 | 429 + `Retry-After` + `RATE_LIMITED` | 前端可明确提示等待，不泄漏命中邮箱还是 IP |

## L1.4 Return 语义

| return 形态 | caller 解读 | 测试名 |
|-----------|-----------|--------|
| `{ allowed: true }` | 调用 Router 身份接口 | `forwards requests below the account and IP limits` |
| `RateLimitError` | 返回 429，不调用 Router | `rate limits verification by normalized email and client IP` |

## L1.5 负向断言

| 输入 | 必须返回 | 测试断言 |
|-----|--------|--------|
| 同邮箱不同大小写 | 共享同一计数桶 | 第四次验证码请求为 429 |
| 同 IP 批量不同邮箱 | 命中 IP 桶 | Router 调用次数不超过上限 |
| 伪造超长键或非法 scope | 400/内部校验失败 | PostgreSQL 无写入 |
| 限流命中 | 不说明邮箱或 IP | 统一 `RATE_LIMITED` 文案 |

## L1.6 回滚

| 类别 | 变更 | 回滚动作 | 顺序 |
|-----|-----|--------|------|
| 代码 | Auth App 注入限流 | `git revert`，切回上一 PostgreSQL 兼容镜像 | 1 |
| 配置 | 无新增必填配置 | 无 | 2 |
| 数据 | 新增限流桶表 | 保留；旧代码不会读取 | 3 |
| 告警 | 429 日志/指标待接入 | 继续用访问日志统计 | 4 |

回滚后可接受状态：登录注册恢复原行为；Router、Studio 用户、Session、额度和作品数据不变。

---

## L2.1 运行时假设

| 假设 | 验证路径 | 环境 | 假设不成立时行为 |
|-----|--------|-----|--------------|
| Studio PostgreSQL 可写 | `/api/ready` + 集成测试 | 测试/生产 | Auth fail closed 为 500/503，不绕过限流 |
| 8788 仅本机 Caddy 可达 | 监听与防火墙检查 | 测试/生产 | 不信任转发头，不开放生产 |
| Router 签名 Secret 至少 32 字节 | 现有启动校验 | 测试/生产 | 启动失败 |

## L2.2 状态机

```text
请求 -> 规范化账号/挑战令牌与客户端 IP
  -> 当前窗口未超限：原子增加邮箱桶与 IP 桶 -> 调用 Router
  -> 任一桶超限：整笔事务回滚 -> 429 + Retry-After
窗口过期 -> 下一次请求原子重置窗口和计数
并发点：同一邮箱/IP 的并发验证码或登录请求。
防护：PostgreSQL 主键 + UPSERT 行锁；所有桶在同一事务内提交或回滚。
```

## L2.6 权限/安全

| 维度 | 回答 | 证据 |
|-----|-----|-----|
| 身份来源 | 未登录公开入口，按规范化邮箱/挑战令牌和代理 IP | `studio-server/authApp.mjs:48` |
| 授权边界 | 限流只决定是否转发，不产生身份或 Session | `studio-server/authApp.mjs:64` |
| 凭证泄漏面 | HMAC Secret 沿用服务端 Router 签名 Secret，不写表/响应/日志 | `studio-server/server.mjs:28` |
| SSRF | Router host 仍由固定服务端配置控制 | `studio-server/routerAuthClient.mjs:13` |
| 租户隔离 | scope + HMAC key 作为联合主键 | migration 005 |
| 日志脱敏 | 429 不记录原始邮箱、IP、密码、验证码或挑战令牌 | Auth App 测试 |

## L2-ops.1 可观测性

| 失败模式 | 日志 | 指标/人工检查 | 告警规则 | 可区分状态？ |
|---------|-----|--------------|---------|-------------|
| 验证码刷取 | Caddy 429 访问日志 | 按 path 统计 429 | 10 分钟突增时检查 | 可区分 path，不区分邮箱/IP |
| PostgreSQL 不可用 | 现有 auth 500 + ready 503 | 容器健康 | 任意持续 5 分钟 | 与限流命中可区分 |
| 正常用户误伤 | 客服时间与 path | 429 比例 | 上线后按数据调阈值 | `Retry-After` 可见 |

## 剩余风险登记

| 项 | 接受/已知/待后续 | Owner | Follow-up ticket |
|----|----------------|------|-----------------|
| 首发不加 Turnstile/CAPTCHA | 接受；出现分布式滥用或邮件成本异常时增加 | NanaFox ops | `studio-auth-turnstile-trigger` |
| Caddy 转发 IP 信任依赖本机监听 | 测试/生产发布硬门禁 | NanaFox ops | `studio-loopback-listener-gate` |
