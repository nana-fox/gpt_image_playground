# NanaFox Studio 开发入口

NanaFox Studio 是本仓库中的独立 ToC 部署形态。它复用 Playground 的图像能力，但拥有独立前端、Node 服务、Session、额度、订单、PostgreSQL 数据和 R2 作品存储，不复用 Router 的余额或支付订单。

## 代码地图

| 层 | 入口 | 职责 |
|---|---|---|
| 前端装配 | `src/studio/StudioApp.tsx` | 登录后的页面路由、创作、灵感、作品与账户壳 |
| 额度与支付 UI | `src/studio/StudioQuotaPage.tsx` | 套餐、支付方式、二维码、订单轮询和到账反馈 |
| 通用弹层 | `src/studio/StudioModal.tsx` | Studio 弹层、Esc/遮罩关闭和页面滚动锁定 |
| 浏览器 API 客户端 | `src/lib/studio*.ts` | 同源请求、响应校验和对外类型 |
| 服务装配 | `studio-server/server.mjs` | 配置校验、数据库、Store、Service 和 HTTP App 组装 |
| 身份 | `studio-server/authApp.mjs`、`routerAuthClient.mjs` | Studio Session 与 Router 身份适配 |
| 生图 | `studio-server/generation*.mjs` | 幂等任务、额度预占、Provider 调用和恢复 |
| 作品 | `studio-server/artwork*.mjs`、`r2ArtworkStore.mjs` | 用户鉴权、R2 读写、删除和恢复 |
| 支付 | `studio-server/payment*.mjs`、`alipayClient.mjs`、`wxpayClient.mjs` | 套餐、订单、供应商配置、下单、验签和幂等履约 |
| 数据结构 | `studio-server/migrations/` | Studio 独立 PostgreSQL schema，按编号顺序迁移 |

依赖方向保持单向：`HTTP App -> Service -> Store/Client`。业务事务留在 Store/Service，第三方签名留在各自 Client，React 页面不接触商户私钥、Router Key 或数据库。

## 文档地图

- 产品和系统边界：[`../nanafox-studio-architecture.md`](../nanafox-studio-architecture.md)
- 支付架构与验收：[`payment.md`](payment.md)
- 部署和回滚：[`../nanafox-studio-deployment-runbook.md`](../nanafox-studio-deployment-runbook.md)
- PostgreSQL/R2：[`../nanafox-studio-postgres-r2-plan.md`](../nanafox-studio-postgres-r2-plan.md)
- UI 约束：[`../nanafox-studio-ui-guidelines.md`](../nanafox-studio-ui-guidelines.md)

`docs/nanafox-studio-*-plan.md` 中与专项能力相关的文件保留为历史设计和验收记录；当前代码和本目录文档优先级更高。

## 本地机密资料

支付宝测试环境完整记录保存在 `docs/private/alipay-test-config.md`。该目录由 `.gitignore` 排除，目录权限为 `0700`、文件权限为 `0600`，包含密钥和数据库密文，禁止提交、截图或复制到协作工具。

每次轮换支付宝应用、密钥、域名或 `STUDIO_PAYMENT_CONFIG_KEY` 后，都要同步更新本地文件，并重新核对：

1. App ID 与应用私钥派生的公钥匹配。
2. 支付宝公钥来自当前应用使用的密钥模式。
3. 回调地址包含当前 Studio base path 和 provider ID。
4. 数据库订单 `expires_at`、支付宝 `time_expire` 和页面显示使用同一绝对时间。

## 本地验证

```bash
npm run build
npm test
npm run test:studio-server
npm run build:studio
```

部署仍按 Runbook 执行；测试通过和 Git 提交不等于生产发布授权。
