# NanaFox Studio 支付实施计划

> 状态：2026-08-28 实施基线。首发只做微信支付 Native 扫码；Studio 独立保存套餐、订单、订阅和额度，中转站仅作为已验证实现参考，不承载 Studio 余额或履约。

## L1.1 引用验证

| 符号 | 证据 (file:line) | 签名 | 用途 |
|-----|-----------------|-----|-----|
| `createQuotaStore` | `studio-server/quotaStore.mjs:11` | `(options) -> quotaStore` | 复用已有订阅、额度和幂等 grant 语义 |
| `grantCredits` | `studio-server/quotaStore.mjs:109` | `(userId, grant, audit) -> creditGrant` | 加量包和订阅履约落点 |
| `createStudioApp` | `studio-server/server.mjs:68` | `(options) -> app` | 注册独立 billing 与 webhook 路由 |
| `createStudioAdminApp` | `studio-server/adminApp.mjs:7` | `(options) -> adminApp` | 复用运营鉴权、CSRF 和审计边界 |
| `QuotaPage` | `src/studio/StudioApp.tsx:383` | `({ quota, navigate }) -> JSX` | 从占位套餐升级为真实套餐和扫码状态 |
| `StudioAdminPage` | `src/studio/StudioAdminPage.tsx:14` | `({ admin, onExit }) -> JSX` | 增加套餐价格、额度和销售状态配置 |

## L1.2 同类路径对照

参考实现：`studio-server/quotaStore.mjs:109`

- [x] 加量包：支付完成后以 `source=pack`、`reference=payment:<orderId>` 发放一次性额度。
- [x] 订阅：同一数据库事务内更新 `studio_subscriptions`，并以 `source=subscription` 发放当期额度。
- [x] 重复回调：订单已 `completed` 时返回成功，不重复发放。
- [x] 金额或商户不匹配：拒绝履约并保留可审计错误，不修改额度。

## L1.3 约定清单

| 约定 | 现状 | 我的选择 | 理由 |
|-----|-----|--------|------|
| 金额 | 尚无支付表 | 数据库和 API 全程使用人民币分整数 | 避免浮点金额误差 |
| 订单归属 | Studio 用户已有本地 ID | 订单只关联 `studio_users.id` | 不把 Router 钱包或用户余额引入 Studio |
| 套餐配置 | 前端有 Plus/Pro 占位 | PostgreSQL 保存名称、类型、价格、额度、期限、启用状态和版本 | 运营端可改且支付订单保存不可变快照 |
| 支付渠道 | 尚未接入 | 首发仅微信 Native | 浏览器扫码无需微信 OAuth/OpenID；渠道最少 |
| 商户凭证 | 尚未配置 | 只从服务端 secret/file 读取 | 不入数据库、不下发前端、不进镜像 |
| SDK | Node 无已采用官方依赖 | 使用 Node `crypto`/`fetch` 实现 APIv3 最小协议面 | 不引入非官方支付 SDK；保留可测试边界 |

## L1.4 Return 语义

| return 形态 | caller 解读 | 测试名 |
|-----------|-----------|--------|
| `{ status: 'pending', codeUrl, expiresAt }` | 展示真实扫码入口并轮询本地订单 | `creates one native order from the server-side plan snapshot` |
| `{ status: 'completed' }` | 刷新额度并关闭支付层 | `fulfills a paid pack exactly once` |
| `PAYMENT_NOT_CONFIGURED` | 套餐可浏览，购买按钮说明暂未开放 | `never creates an order when payment is disabled` |
| `PAYMENT_AMOUNT_MISMATCH` | 回调失败、无额度变更 | `rejects a paid notification with a changed amount` |
| `PAYMENT_SIGNATURE_INVALID` | HTTP 401、无数据库写入 | `rejects an unsigned or stale WeChat callback` |

## L1.5 负向断言

| 输入 | 必须返回 | 测试断言 |
|-----|--------|--------|
| 前端自带价格或额度 | 忽略/拒绝，只按服务端 plan 快照下单 | provider 收到数据库金额与额度 |
| 已停用或版本冲突套餐 | 409，订单数不变 | `disabled plans cannot be purchased` |
| 非本人订单查询 | 404 | 不泄漏订单是否存在 |
| 重复创建键、参数一致 | 返回原订单 | provider 只调用一次 |
| 重复创建键、套餐不同 | 409 | 原订单不变 |
| 回调 appid/mchid/currency/amount 不符 | 401/409 | 订阅和额度不变 |
| 超过 1 MiB 回调 | 413 | 不验签、不落库 |

## L1.6 回滚

| 类别 | 变更 | 回滚动作 | 顺序 |
|-----|-----|--------|------|
| 配置 | `STUDIO_PAYMENT_ENABLED=true` | 先改为 `false` 并重启，停止新下单 | 1 |
| 代码 | billing 路由与 UI | `git revert` 对应提交并重建镜像 | 2 |
| 数据 | 新增套餐、订单表 | 保留订单审计数据，不做破坏性降级 | 3 |
| 告警 | 支付失败日志 | 回滚后继续观察迟到回调至少 24 小时 | 4 |

回滚后可接受状态：用户仍可登录、使用免费/已有额度和查看作品；不能创建新订单；已支付未履约订单由运营核对后使用现有管理员加额补偿。

---

## L2.1 运行时假设

| 假设 | 验证路径 | 环境 | 假设不成立时行为 |
|-----|--------|-----|--------------|
| PostgreSQL 可用且迁移 003 已完成 | `/api/ready` + schema migration | 测试/生产 | 实例不就绪，不接流量 |
| 外部回调可到达 `${STUDIO_PUBLIC_ORIGIN}${STUDIO_PUBLIC_BASE_PATH}api/payments/webhooks/wechat` | 微信商户平台回调测试 | 测试/生产 | 保持支付关闭 |
| 服务端时间与 NTP 同步 | 主机时钟监控 | 测试/生产 | 拒绝超时签名并告警 |
| 微信 API 可从日本服务器访问 | 预下单探针 | 测试/生产 | 下单返回渠道不可用，不创建第二份额度 |
| 商户私钥和平台公钥只读挂载 | 容器内权限检查 | 测试/生产 | 启动失败，不降级为跳过验签 |

## L2.2 状态机

```text
create: none -> pending
  -> Native 预下单成功：pending + code_url + expires_at
  -> 渠道失败：failed（不履约）
pending
  -> 已验签 SUCCESS，商户/金额一致：paid -> completed
  -> 本地轮询查询微信确认成功：paid -> completed
  -> 超时未付：expired
completed
  -> 重复回调/查询：保持 completed，返回成功
并发点：重复创建、微信重试回调、用户轮询与回调同时到达。
防护：创建幂等键唯一约束；订单行 `FOR UPDATE`；履约和订单状态在一个 PostgreSQL 事务；额度 reference 唯一约束。
```

## L2.3 微信 APIv3 契约

| 操作 | 请求 | 成功解析 | 失败处理 |
|-----|-----|---------|---------|
| Native 预下单 | `POST /v3/pay/transactions/native`；服务端签名；金额为分 | 验证微信响应签名后读取 `code_url` | 非 2xx、无效签名或无 code_url 均标记 failed |
| 商户订单查询 | `GET /v3/pay/transactions/out-trade-no/{out_trade_no}?mchid=...` | 验签后仅接受 `trade_state=SUCCESS` | 其他状态保持 pending/按过期时间 expired |
| 支付通知 | 原始 body + `Wechatpay-*` headers | 验签、时间窗校验、AES-256-GCM 解密 | 任何不一致均不履约；未知订单返回成功并记录 warning |

请求不接受浏览器传入 `notify_url`、`mchid`、`appid`、金额、额度或描述。微信响应和回调最大 1 MiB；日志只记录订单号、状态和 reason，不记录私钥、APIv3 key、完整回调或用户 email。

## L2.6 权限/安全

| 维度 | 回答 | 证据 |
|-----|-----|-----|
| 身份来源 | 下单/查单来自 Studio HttpOnly session；回调来自微信 RSA 签名 | `studio-server/authApp.mjs:15` |
| 授权边界 | 用户只读写自己的订单；套餐修改沿用管理员 subject + CSRF | `studio-server/adminApp.mjs:20` |
| 凭证泄漏面 | 商户私钥、APIv3 key、平台公钥仅服务端文件挂载 | `studio-server/server.mjs:20` |
| SSRF | 微信 API host 固定为 `api.mch.weixin.qq.com`，无用户 URL | 新客户端单元测试固定请求 host |
| 租户隔离 | 所有用户订单查询同时限定 `id` 与 `user_id` | PostgreSQL 查询测试 |
| 日志脱敏 | 不输出 request body、签名、证书和密钥 | webhook 负向测试 + 日志 review |

## L2-ops.1 可观测性

| 失败模式 | 日志 | 指标/人工检查 | 告警规则 | 可区分状态？ |
|---------|-----|--------------|---------|-------------|
| 预下单失败 | `studio_payment_create_failed` warn | 订单 failed 数 | 15 分钟连续 5 次 | 是，含 reason/plan/order |
| 回调验签失败 | `studio_payment_webhook_rejected` warn | 401 数 | 5 分钟 > 10 | 是，区别签名/时间/解密 |
| 已支付但履约失败 | `studio_payment_fulfillment_failed` error | paid 非 completed | 任意 1 条立即告警 | 是，保留订单可重试 |
| 订单过期 | `studio_payment_order_expired` info | expired 比例 | 仅异常升高告警 | 是，不等同渠道失败 |

## L2-ops.2 兼容灰度

| 维度 | 问题 | 处理 |
|-----|-----|-----|
| 老调用方 | 现有 auth/quota/generation 是否零变化 | 新 `/api/payments/*` 路由早分流；原接口回归门禁 |
| 第三方 shape 漂移 | 微信字段增减 | 只读取必需字段；必需字段缺失 fail closed |
| feature flag | 是否灰度 | `STUDIO_PAYMENT_ENABLED=false` 默认关闭；套餐读取和管理不依赖开关 |
| 新旧对比 | 无旧支付 | 测试环境真实一分钱套餐验收后再启用正式套餐 |
| 回滚污染 | 已有 pending/paid 订单 | 保留；关闭新下单；迟到回调仍继续验签与幂等履约 |

## 开发与验收切片

1. migration 003 + plan/order store + 管理 API；测试套餐版本冲突、订单快照和创建幂等。
2. 微信 Native client；使用固定 RSA/AES 向量测试请求签名、响应验签和回调解密。
3. billing app + 事务履约；测试加量包与订阅重复回调只发放一次。
4. 前端真实套餐、扫码弹层、状态轮询和运营套餐编辑；禁止模拟成功入口。
5. 测试环境默认关闭渠道；配置测试商户后，以一分钱隐藏套餐完成真支付、额度到账、重复回调和过期回收验收。

## 剩余风险登记

| 项 | 接受/已知/待后续 | Owner | Follow-up ticket |
|----|----------------|------|-----------------|
| 尚无微信商户号/证书，无法完成真实资金验收 | 待用户提供 secret 后测试 | NanaFox owner | `studio-wxpay-test-merchant` |
| 更换商户时旧订单回调仍需旧平台公钥/APIv3 key | 已知；首发先等 pending 订单过期再切换 | NanaFox ops | `studio-wxpay-key-rotation` |
| JSAPI 需要公众号 AppID、OpenID 和微信内 OAuth | 接受；首发不做 | NanaFox product | `studio-wxpay-jsapi` |
| 退款、自动续费、支付宝 | 接受；有真实订单需求后再做 | NanaFox product | `studio-payment-phase-2` |
| Sub2API PostgreSQL/Redis 以 `0.0.0.0` 发布宿主端口 | 已知；非本次引入，不阻塞 Studio 支付开发 | NanaFox ops | `sub2api-private-db-ports` |
