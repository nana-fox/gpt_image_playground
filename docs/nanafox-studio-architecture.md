# NanaFox Studio 产品与技术架构

> 状态：2026-08-27 基线。本文是 Studio 的架构决策记录；部署步骤见 `docs/nanafox-studio-deployment-runbook.md`，PostgreSQL/R2 实施证据见 `docs/nanafox-studio-postgres-r2-plan.md`。

## 1. 最终结论

NanaFox Studio 是独立 ToC 产品，不是 Router 的一个皮肤，也不把 Router 的 API 额度直接当成产品额度。

- 前端：继续复用当前 GPT Image Playground 的成熟创作能力，并以已确认 Demo 的页面、导航和闭环为产品界面。
- 后端：放在当前仓库的 `studio-server/`，独立部署、独立配置、独立数据库。
- 用户身份：注册、验证码和身份主记录由 Router 提供；Studio 通过服务端身份适配接口校验，建立自己的 Session 和 `identity_subject` 映射。不是浏览器跳转式 SSO。
- 业务数据：Studio 自己保存免费次数、订阅、加量包、额度流水、生成任务、作品元数据和运营配置。
- 模型调用：只有 Studio 后端持有 Router 生图 Key，前端不接触 Key、Base URL、供应商和模型路由细节。
- 数据库：复用现有 PostgreSQL 服务实例，但使用独立 database、role 和连接串，不共享 Sub2API 业务表。
- 图片文件：生产使用 Cloudflare R2 私有 Bucket；PostgreSQL 只保存对象键和元数据，不保存图片二进制。
- 图片读取：首发由日本 Studio 后端鉴权并从 R2 代理返回，不让中国内地浏览器直连 R2 S3 域名。
- NAS：只做异地备份和恢复演练，不做在线源站。

## 2. 项目边界

| 系统 | 负责 | 明确不负责 |
|-----|-----|-----------|
| Router/Sub2API | 注册、登录、验证码、身份校验；模型路由和上游账号 | Studio 套餐、每日免费次数、作品库、订单、运营配置 |
| NanaFox Studio 前端 | 创作、灵感、作品、套餐、账号和运营页面 | API Key、供应商选择、直接模型调用、长期凭证 |
| NanaFox Studio 后端 | Session、额度、订阅、任务状态机、作品鉴权、R2、管理 API | 修改 Router 原有用户表或复用 Router API 额度语义 |
| PostgreSQL | 结构化业务数据、事务和幂等 | 图片二进制 |
| Cloudflare R2 | 原图及后续缩略图对象 | 用户身份、套餐和额度判断 |
| NAS | PostgreSQL 与 R2 的异地恢复副本 | 实时请求、公开访问、应用数据库 |

这套划分允许 Studio 独立迭代和回滚，同时只给 Router 增加窄接口，不修改它原有登录、Key、计费和模型路由逻辑。

## 3. 运行时架构

```text
用户浏览器
  │ HTTPS: studio.nanafox.com
  ▼
Caddy
  ├─ Studio 静态前端
  └─ /api/* → Studio Node 服务
                 ├─ Router 身份适配接口
                 ├─ Router Images API（服务端 Key）
                 ├─ PostgreSQL / nanafox_studio
                 └─ Cloudflare R2 私有 Bucket

NAS（非在线链路）
  ├─ 拉取 PostgreSQL 加密备份
  └─ 拉取 R2 对象增量副本
```

测试环境与生产环境使用不同数据库、Bucket、Token、静态制品指针和配置文件。Router 生产容器、Router 数据库和既有 Playground 路由不参与 Studio 部署。

## 4. 核心流程

### 4.1 注册和登录

1. 浏览器在 Studio 页面输入邮箱和验证码。
2. Studio 后端把请求转给 Router 的窄身份接口。
3. Router 返回稳定 `identity_subject` 和必要的用户资料，不返回 Router Session 给浏览器。
4. Studio 在 `studio_users` 建立或更新映射，并签发自己的 HttpOnly Session Cookie。
5. 后续 Studio API 只认 Studio Session；账号封禁或身份失效通过适配接口同步。

这样既复用 Router 用户池和验证码能力，又避免把两个产品耦合成一个共享 Cookie/共享 Session 系统。

### 4.2 生成图片

1. 前端只提交提示词、比例和画质，并携带 CSRF 与 Idempotency-Key。
2. PostgreSQL 创建幂等任务并在事务中预占免费次数或付费额度。
3. Studio 后端调用 Router Images API。
4. 返回图片通过条件写入保存到 R2；相同任务不能覆盖不同内容。
5. PostgreSQL 的任务 `output_json` 写入对象元数据，随后确认额度并把任务置为成功。
6. Provider 或 R2 失败时释放预占；数据库最终确认暂时失败时由启动恢复流程补偿。

前端永远不决定扣哪一种额度，也不能传入模型名、供应商或 API 地址。

### 4.3 查看作品

1. 浏览器访问同源 `/api/artworks/{taskId}`。
2. Studio 后端用当前 Session 查询该用户的任务；不存在或不属于本人时返回 404。
3. 授权通过后，后端用最小权限 R2 Token 获取对象并返回 PNG。

首发不返回 R2 预签名 URL。原因不是预签名技术不安全，而是 R2 预签名只能使用 `*.r2.cloudflarestorage.com` S3 域名；Cloudflare 官方不保证普通全球网络在中国内地的延迟与可靠性。本地网络对本账号 R2 端点的 3 次只读 TLS 探测也全部在 5 秒超时。后端代理增加一次中转，但把用户访问面收敛到 `studio.nanafox.com`，更适合当前规模。

### 4.4 管理员操作

- 每日免费次数：运营端可启停、修改默认值和时区，默认每天 3 次。
- 套餐：运营端配置 Free、Plus、Pro 与加量包的展示、价格、额度、有效期和销售状态。
- 单用户加额：管理员通过幂等 `reference` 发放额度，保留操作者、原因和时间；不能直接改余额数字。
- 任务排障：查看任务状态、失败原因、额度预占和对象元数据，不显示 Router/R2/PostgreSQL Secret。
- 灵感内容：独立配置分类、封面、提示词模板、上下线和排序，不从外部仓库运行时同步。

## 5. PostgreSQL 设计

### 5.1 隔离方式

首发复用现有 PostgreSQL 实例以减少运维面，但必须满足：

- 测试：独立 database `nanafox_studio_test`、独立 role `nanafox_studio_test_app`。
- 生产：独立 database `nanafox_studio`、独立 role `nanafox_studio_app`。
- role 只拥有对应数据库权限，不拥有 Sub2API database/schema 权限。
- Studio migration 使用 advisory lock，允许多个实例同时启动但只执行一次迁移。
- 应用连接池首发上限 10；上线前按共享实例的 `max_connections` 重新核算。

如果共享实例的连接数、磁盘、备份窗口或故障域不满足要求，再迁移到独立 PostgreSQL；现在不提前增加一套数据库集群。

### 5.2 数据归属

| 数据 | 保存位置 | 说明 |
|-----|---------|-----|
| 用户映射、Session | PostgreSQL | 只存 Router 稳定 subject，不复制密码和验证码 |
| 免费策略、订阅、额度包、预占 | PostgreSQL | 必须事务化、可审计、可幂等 |
| 提示词、比例、画质、状态、失败原因 | PostgreSQL | 支持作品列表与客服排障 |
| R2 object key、ETag、SHA-256、字节数、MIME | PostgreSQL `output_json` | V1 直接随任务保存，避免提前增加一张只被单路径使用的表 |
| 图片二进制 | R2 | 不进 PostgreSQL，不进日志 |
| 支付流水 | PostgreSQL（支付接入阶段新增） | 与额度发放使用支付方事件 ID 幂等关联 |

当一个任务需要多张图、派生缩略图、分享状态或独立删除状态时，再把 `output_json` 演进为 `studio_artworks` 表；当前一任务一作品无需提前拆表。

## 6. 对象存储方案调研与取舍

对象存储行业通用做法并不是“所有图片都走后端”或“所有图片都直传”，而是按网络和权限边界组合：私有 Bucket、最小权限角色、数据库保存对象元数据；大流量时用短时签名或 CDN 把文件流量从应用服务器移开；用生命周期、版本/锁或跨区域副本处理成本和误删。

| 方案 | 优点 | 问题 | 当前决定 |
|-----|-----|-----|---------|
| PostgreSQL BYTEA | 事务直观 | 数据库膨胀、备份慢、带宽和成本不合适 | 不采用 |
| 日本服务器本地盘 | 实现最简单 | 磁盘不足、单机故障、扩容和迁移困难 | 仅本地开发回退 |
| R2 私有桶 + 浏览器预签名直读 | 无 R2 egress 费、应用服务器省带宽 | 内地浏览器必须直连 R2 S3 域名，当前不可作为可靠依赖 | 首发不采用 |
| R2 私有桶 + Studio 后端代理 | 权限简单、同源、内地用户不直连 R2 | 日本服务器承担图片带宽和内存 | **首发采用** |
| R2 + Worker/自定义媒体域名 | 可在边缘鉴权和缓存 | 增加服务；R2 在 Cloudflare 中国网络也有产品限制 | 有规模后评估 |
| 阿里内地 OSS 主存储 | 内地用户访问更好 | 日本服务写入跨境；自定义域名需要 ICP；内容合规和双云运维增加 | 暂不作为主存储 |
| R2 主存储 + 内地 OSS 热副本 | 兼顾全球成本与内地体验 | 一致性、删除、合规、回源和费用最复杂 | 达到触发条件再做 |
| NAS 主存储 | 容量自有 | 家庭网络、可用性、安全和上行不适合在线服务 | 只做备份 |

参考依据：

- AWS 建议默认阻断公开访问、禁用 ACL、最小权限，并结合版本、复制、生命周期和审计；预签名 URL 是常见的短时授权桥接方式。
- 阿里 OSS 建议私有 Bucket、RAM/STS 临时授权和服务端签名直传；私有对象可用签名 URL 读取，内地 OSS 自定义域名需要 ICP 备案。
- Cloudflare R2 默认私有、S3 兼容、Standard 无 egress 费，支持生命周期和条件写入；但 R2 不能在中国内地创建桶，普通 China Network 也不包含完整 R2 本地能力。

官方资料：

- [AWS S3 安全最佳实践](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [AWS 预签名 URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [阿里 OSS 权限与访问控制](https://help.aliyun.com/zh/oss/user-guide/permissions-and-access-control-overview)
- [阿里 OSS 服务端签名直传](https://help.aliyun.com/zh/oss/user-guide/obtain-signature-information-from-the-server-and-upload-data-to-oss)
- [阿里 OSS 跨区域复制](https://help.aliyun.com/zh/oss/user-guide/cross-region-replication-overview/)
- [Cloudflare R2 定价](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare R2 数据位置](https://developers.cloudflare.com/r2/reference/data-location/)
- [Cloudflare China Network 产品边界](https://developers.cloudflare.com/china-network/reference/available-products/)

## 7. R2 对象规则

- Bucket：测试 `nanafox-studio-artworks-test`，生产 `nanafox-studio-artworks-prod`。
- 存储级别：Standard。当前图片会被频繁查看，Infrequent Access 有读取费和 30 天最低存储期，不合适。
- 位置：APAC location hint；它是性能提示，不是日本数据驻留保证。
- 公开访问：关闭 `r2.dev` 和公共自定义域名。
- 对象键：`{studio_user_id}/{generation_task_id}.png`；ID 均为服务端生成的不透明值。
- 写入：`If-None-Match: *`，相同任务的重试只接受完全相同字节。
- 元数据：`Content-Type=image/png`、SHA-256；数据库另存 key、ETag、hash、bytes、MIME。
- 凭证：测试和生产分别创建 Bucket-scoped `Object Read & Write` Account API Token；不授予 Bucket 管理权限。
- 删除：业务先记录删除状态，再删对象；删除失败进入重试，不静默丢失数据库记录。

## 8. 保留、隐私与成本

首发默认规则：

- 成功作品：用户删除前保留。产品页明确告知用于作品库和再次下载。
- 参考图：当前产品尚未上传到后端；接入时使用 `references/` 前缀并在 24 小时后自动删除，除非用户明确保存为素材。
- 失败任务临时对象：最多保留 24 小时。
- 用户删除：界面立即不可见；对象进入 7 天恢复窗口，最迟 30 天硬删除。实现删除 API 时再启用，不用 Bucket 全局规则误删正常作品。
- 测试 Bucket：可设置 30 天生命周期，测试数据不作为用户长期资产。

R2 Standard 当前包含 10 GB-month 免费额度、每月 100 万 Class A 和 1000 万 Class B 请求，超出后按存储和操作计费且无 egress 费。真正的首发成本风险不是 R2 egress，而是 Studio 日本服务器代理读取的出口带宽；必须记录图片 GET 次数和字节量。

## 9. 备份与恢复

高耐久对象存储不能替代备份：它防硬件丢失，不防应用误删、凭证泄漏或错误生命周期规则。

- PostgreSQL：每 6 小时一次逻辑备份；保留 7 个每日、4 个每周、6 个每月；备份加密后复制到 NAS。
- R2：每天由 NAS 使用独立只读 Token 做增量同步；删除传播延迟至少 7 天，避免线上误删立即污染备份。
- 内地 OSS：暂不进入在线链路；如 NAS 外网稳定性不足，可作为加密冷备第二目标。
- 恢复演练：每月随机恢复一个 PostgreSQL 备份到隔离数据库，并抽样校验 R2/NAS 对象 SHA-256。
- RPO：数据库不超过 6 小时；作品在生成成功后下一次日备份前仅依赖 R2 自身耐久性。
- RTO：测试目标 4 小时；生产初期目标 8 小时，实际演练后再收紧。

## 10. 安全边界

- 所有 Bucket 私有；前端代码、HTML、日志和错误响应中不得出现长期 Key。
- R2、Router 和 PostgreSQL 凭证只存在服务器 Secret 环境文件，权限 `0600`，不进入 Git、Docker 镜像或构建日志。
- 测试/生产凭证、数据库和 Bucket 完全分离。
- 作品读取同时匹配 Session user id 和 task id；他人作品统一返回 404。
- 上传内容校验 MIME、PNG signature、Base64 canonical form 和最大 50 MiB。
- 日志记录 request id、task id、状态码和耗时，不记录提示词全文、签名 URL、Cookie 和 Secret。
- 管理员加额、套餐变更和删除操作必须有审计记录与幂等 reference。

## 11. 演进触发条件

以下条件出现前，不增加 Worker、CDN 鉴权或双存储：

- Studio 图片代理流量持续占服务器出口带宽 30% 以上；
- 中国内地真实用户图片加载 P95 超过 3 秒或失败率超过 1%；
- 月作品存储超过 500 GB；
- 出现明确的内地数据驻留、ICP 或内容合规要求；
- 单任务多图、分享链接或团队素材库使 `output_json` 无法有效查询。

届时按数据判断：海外优先 Worker/R2 自定义域名，内地优先备案后的 OSS/CDN 热副本；不同时引入两套方案。

## 12. 当前实现状态

| 能力 | 状态 |
|-----|-----|
| Studio 前端创作闭环、独立 Session、每日免费额度、真实生成 | 已实现并部署公网测试环境；真实 Router 账户的端到端人工验收待用户执行 |
| PostgreSQL Store、migration、并发额度保护 | 已切换公网测试容器，真实 PostgreSQL 集成测试通过 |
| R2 私有 Store、条件写入、后端代理读取 | 已切换公网测试容器，真实 R2 合约与供应商生成读回探针通过 |
| 管理员套餐/策略/单用户加额 | Store 方法已存在；受保护管理 API 与真实前端闭环尚未实现，现有管理页不得视为完成 |
| PostgreSQL/R2 测试环境部署 | `9b7ce84` 已部署；旧 SQLite 容器和数据备份保留为测试回滚点 |
| 订阅支付、用户删除恢复、NAS 自动备份 | 待实现或待部署配置 |
| 生产发布 | 未授权、未执行 |
