# NanaFox Studio 支付架构与验收

> 当前状态：2026-08-31。Studio 支持微信 Native 和支付宝电脑网站支付二维码模式。支付宝测试环境已经完成真实 0.01 元下单、扫码、异步通知、订单完成和额度只发放一次的闭环。微信仍保持未配置、未启用。

## 系统边界

- Studio 独立保存套餐、供应商、订单、支付事件、订阅和额度流水。
- Router/Sub2API 只提供身份适配和模型路由；不复用它的余额、订单、回调或支付配置。
- `STUDIO_PAYMENT_ENABLED` 是部署总开关，运营端 `accepting_orders` 是接新单开关。任一关闭都不能创建订单，但历史订单仍可查单和接收回调。
- 金额在数据库和 API 中始终使用人民币分整数。
- 前端只收到公开套餐、Studio 订单号、二维码内容或支付宝收银台地址，不接触商户密钥。

## 代码职责

| 模块 | 职责 |
|---|---|
| `src/studio/StudioQuotaPage.tsx` | 套餐、支付方式、二维码、订单轮询和到账反馈 |
| `src/lib/studioPayment.ts` | 支付 API 调用、返回值校验和公开类型 |
| `studio-server/paymentApp.mjs` | Session、CSRF、请求大小、路由和 webhook 入口 |
| `studio-server/paymentService.mjs` | 套餐、供应商选择、订单创建、查单补偿和履约编排 |
| `studio-server/paymentStore.mjs` | 订单快照、状态迁移、事件幂等和额度事务 |
| `studio-server/paymentProviderStore.mjs` | 供应商配置加密、版本控制和运营审计 |
| `studio-server/paymentProviders.mjs` | 按 provider 构造微信/支付宝客户端 |
| `studio-server/alipayClient.mjs` | RSA2 下单签名、回调验签和支付宝字段校验 |
| `studio-server/wxpayClient.mjs` | 微信 APIv3 下单、验签、解密和查单 |

依赖方向为 `Payment App -> Payment Service -> Store/Provider Client`。HTTP 层不写业务事务，Store 不生成第三方签名，React 不判断订单是否应履约。

## 配置与密钥

| 配置 | 说明 |
|---|---|
| `STUDIO_PAYMENT_ENABLED` | 支付总开关；生产首次发布默认 `false` |
| `STUDIO_PAYMENT_CONFIG_KEY` | Base64 编码的 32 字节主密钥，用 AES-256-GCM 加密数据库中的供应商配置 |
| `STUDIO_PUBLIC_ORIGIN` | 生成回调和返回地址的公开 origin |
| `STUDIO_PUBLIC_BASE_PATH` | 子路径部署时必须参与回调和返回地址计算 |

微信和支付宝商户资料通过 Studio 运营端录入。浏览器和运营读取接口只返回 App ID、商户号及密钥是否已配置，不返回私钥、公钥正文、APIv3 Key 或数据库密文。

测试环境的完整支付宝资料保存在本机 `docs/private/alipay-test-config.md`，包括 App ID、应用私钥、支付宝公钥、配置主密钥、数据库密文、回调/返回地址、套餐和最近订单。该目录被 Git 忽略，权限要求为目录 `0700`、文件 `0600`。

## 下单流程

```text
登录用户
  -> GET /api/payments/plans
  -> POST /api/payments/orders
       -> 校验 Session、CSRF、Origin、Idempotency-Key
       -> 读取已启用套餐和供应商
       -> 固化金额、额度、期限和供应商身份快照
       -> 创建 pending 订单，绝对有效期为当前时间加 15 分钟
       -> 调用微信 Native 或支付宝 page.pay
  -> 前端显示二维码并每 2 秒查询 Studio 订单
  -> 支付平台异步通知，或查询接口补偿漏通知
  -> PostgreSQL 事务完成订单、记录事件并发放额度
```

相同用户和 `Idempotency-Key` 只返回原订单，不重复向支付平台下单。

## 支付宝契约

- API：`alipay.trade.page.pay`
- 产品码：`FAST_INSTANT_TRADE_PAY`
- 二维码模式：`qr_pay_mode=4`
- 二维码宽度：`qrcode_width=220`
- 签名：`RSA2` / RSA-SHA256
- 字符集：`utf-8`
- Studio 在受限 iframe 中内嵌支付宝二维码收银台，不把 page.pay URL 当成二维码文本再次编码。
- 订单只计算一次绝对过期时间；数据库 `expires_at` 和支付宝 `time_expire` 使用同一个值。
- 不发送 `timeout_express`，避免相对时间与绝对时间产生两套截止点。
- 页面显示到秒：`订单有效至 HH:mm:ss`。

支付宝回调只有在 RSA2 签名、App ID、交易状态、订单金额和币种全部匹配时才进入履约。回调成功响应固定为纯文本 `success`。

## 微信契约

- 下单模式：微信 Native。
- 通知：平台公钥验签、五分钟时间窗、AES-256-GCM 解密。
- 履约前核对 App ID、商户号、金额、币种和订单号。
- 浏览器将 `code_url` 生成为二维码；不提供模拟支付成功入口。

微信当前未配置，不能因支付宝已通过验收而视为微信渠道可用。

## 状态与幂等

```text
pending -> completed
pending -> expired
pending -> failed
```

- `pending`：等待支付，可由 webhook 或主动查单完成。
- `completed`：支付确认和额度发放已在同一事务完成。
- `expired`：Studio 订单超过绝对有效期，不能继续履约为新订单。
- `failed`：下单阶段失败，保存稳定错误原因，不暴露第三方原文。

支付事件 ID、支付平台交易号和额度 `reference=payment:<orderId>` 都有唯一约束。重复通知、并发通知或查单与通知同时到达时，只能完成一次、发放一次。

## 失败关闭与安全

- 缺少部署总开关、配置主密钥、完整供应商凭证或接单开关时，不创建订单。
- 配置解密失败返回服务不可用，不使用空配置或旧环境变量降级。
- 日志不记录私钥、公钥正文、主密钥、二维码内容、签名 URL、Cookie 或通知原文。
- webhook 不依赖用户 Session，但必须通过供应商验签和订单快照校验。
- 停止接单不阻断历史订单的 webhook 和主动查单。
- Caddy 仅为 Studio 路径允许支付宝 iframe 域名，不扩大 Router 或其他站点的 CSP。

## 测试环境验收

已完成：

- 真实支付宝网关下单和二维码展示。
- 真实 0.01 元扫码付款。
- 异步通知入库，订单从 `pending` 进入 `completed`。
- 一笔支付事件只产生一次额度发放。
- 数据库绝对过期时间与支付宝 `time_expire` 完全一致。
- iframe 尺寸、二维码安静区和页面到秒显示通过浏览器检查。
- Router/Sub2API 代码、数据库和支付配置未参与 Studio 支付改动。

尚未完成：微信真实商户配置和小额付款、退款自动化、生产商户与正式套餐验收。

## 发布门禁

1. `npm test`、`npm run test:studio-server`、`npm run build` 和 `npm run build:studio` 全部通过。
2. 测试与生产使用不同数据库、配置主密钥和支付应用。
3. 备份数据库与 `STUDIO_PAYMENT_CONFIG_KEY`，并验证能够解密供应商配置。
4. 暗部署完成 health、ready、未登录 401 和支付关闭状态检查。
5. 保持接单关闭完成 0.01 元真实支付、回调、查单和幂等检查。
6. 用户明确授权生产发布后，才启用正式套餐和接单开关。

回滚时先关闭接单，再切回数据库兼容的旧镜像。不得删除订单、事件或额度流水；迟到回调至少观察 24 小时。
