# NanaFox Studio 部署准备与发布 Runbook

> 适用范围：NanaFox Studio 独立 ToC 产品。每次先部署隔离测试环境，完成真实登录、额度、生图、R2 和恢复验证后，才可以请求生产发布授权。本文不构成生产发布授权。

## 1. 环境清单

| 资源 | 测试 | 生产 |
|-----|-----|-----|
| 公网入口 | `https://router-test.nanafox.com/tools/image-studio/` | `https://studio.nanafox.com/` |
| PostgreSQL database | `nanafox_studio_test` | `nanafox_studio` |
| PostgreSQL role | `nanafox_studio_test_app` | `nanafox_studio_app` |
| R2 Bucket | `nanafox-studio-artworks-test` | `nanafox-studio-artworks-prod` |
| R2 Token | test Bucket scoped | prod Bucket scoped |
| 静态制品指针 | test 独立 current | prod 独立 current |
| Secret 文件 | test 专用 `0600` | prod 专用 `0600` |

生产采用 `studio.nanafox.com`，避免继续把独立产品部署在 Router path 下。测试阶段保留现有 path 是为了复用已验收的隔离入口，不代表生产架构仍嵌入 Router。

测试环境发布前必须先做 DNS 与 SSH 双重核对：`router-test.nanafox.com` 当前解析到 `108.160.133.141`，发布用户为该主机上的 `root` 或 `nio`。`jpq`/`114.55.14.204` 不是 NanaFox Studio 测试服务器，不得用于 Studio 构建、部署或验收。若 DNS 解析变化，以当次 `dig` 结果和目标机现有 `nanafox-studio-test` 容器同时匹配为准，不能只依赖 SSH alias。

## 2. 发布前必须准备的资源

### 2.1 PostgreSQL

- [ ] 只读核对现有实例版本、磁盘、备份、`max_connections` 和当前连接峰值。
- [x] 创建测试 database `nanafox_studio_test` 与 role `nanafox_studio_test_app`；role 只拥有 Studio database 内对象，不拥有 Sub2API 表权限。
- [ ] 创建生产 database 与 role；role 只能连接 `nanafox_studio`。
- [ ] 为两个 role 分别生成随机密码，写入服务器 Secret 文件，不复制到仓库或工单。
- [ ] 明确 PostgreSQL 容器/主机的备份目录和 NAS 加密同步目录。
- [ ] 先在测试 database 运行 migration；核对 `studio_schema_migrations` 和表数量。

不在 Studio migration 中创建 database/role；这些属于基础设施权限，由数据库管理员在发布时创建。共享实例保留 PostgreSQL 默认 `PUBLIC CONNECT`，不为一句“只能连接”全局撤权影响 Sub2API；安全边界是 Studio role 不拥有其他 database/schema/table 对象权限。

### 2.2 Cloudflare R2

- [x] 创建私有 Standard Bucket `nanafox-studio-artworks-test`；Cloudflare 自动位置确认为亚太地区。
- [x] 确认 Bucket 未公开；应用只使用 S3 endpoint，不给浏览器返回 R2 地址。
- [ ] 配置未完成 multipart upload 清理。暂不设置 Bucket-wide 30 天删除规则，避免误删用户成功作品；用户级保留策略完成后由应用按任务状态删除。
- [x] 创建 Account API Token `nanafox-studio-test-app`：仅 `Object Read & Write`，仅测试 Bucket。
- [x] 把 Access Key ID 与 Secret Access Key 直接写入测试服务器 Secret；Secret 只显示一次，不粘贴到聊天、文档或 Git。
- [x] 真实执行 PUT/GET/条件覆盖失败/DELETE 测试，校验 PNG SHA-256。
- [ ] 生产发布前重复创建生产 Bucket 与独立 Token；不复用测试 Token。
- [ ] 为 NAS 备份另建只读 Token，只允许对应 Bucket 的 `Object Read`。

R2 Account ID：`e5615995e2b05ee8817d18517b70c106`。

S3 endpoint：`https://e5615995e2b05ee8817d18517b70c106.r2.cloudflarestorage.com`。

创建 Token 是长期访问凭证操作，必须在实际创建前单独确认。任何输出和日志都不得回显 Secret Access Key。

### 2.3 DNS、TLS 与反向代理

- [ ] `studio.nanafox.com` DNS 指向当前日本应用入口。
- [ ] Caddy 获得有效 TLS 证书。
- [ ] `/api/*` 反向代理到 Studio Node 服务；其他路径由 Studio 自己服务静态资源和 SPA fallback。
- [ ] 请求体限制、超时和安全响应头与测试环境一致。
- [ ] 不把 R2 Bucket 设为公开源站，不给浏览器返回 R2 S3 预签名地址。
- [ ] Router root、health、登录、API Key 管理、Playground 和 Sub2API 服务不重启、不改路由。

## 3. 服务器环境变量

下列变量只写名称和用途，真实值进入服务器 Secret 管理：

| 变量 | 必填 | 说明 |
|-----|-----|-----|
| `STUDIO_PUBLIC_ORIGIN` | 是 | 测试为 `https://router-test.nanafox.com`，生产为 `https://studio.nanafox.com` |
| `STUDIO_PUBLIC_BASE_PATH` | 是 | 测试 `/tools/image-studio/`，生产 `/` |
| `STUDIO_STATIC_ROOT` | 是 | 当前不可变 Studio 静态制品目录 |
| `STUDIO_HOST` | 是 | 默认 `127.0.0.1` |
| `STUDIO_PORT` | 是 | 默认 `8788`，不得与现有服务冲突 |
| `STUDIO_DATABASE_URL` | 是 | 对应环境的独立 PostgreSQL role/database |
| `ROUTER_AUTH_BASE_URL` | 是 | Router 身份适配服务地址 |
| `ROUTER_AUTH_KEY_ID` | 是 | 当前身份签名 Key ID |
| `ROUTER_AUTH_CURRENT_SECRET` | 是 | Router 身份签名 Secret |
| `STUDIO_GENERATION_ENABLED` | 是 | 完成依赖验证后才设为 `true` |
| `ROUTER_IMAGE_BASE_URL` | 生图时 | Router Images API 服务地址 |
| `ROUTER_IMAGE_API_KEY` | 生图时 | 仅服务器使用的 Studio 专用 Key |
| `STUDIO_IMAGE_MODEL` | 生图时 | 默认 `gpt-image-2` |
| `STUDIO_OBJECT_STORAGE` | 生图时 | 生产与测试均设为 `r2` |
| `STUDIO_R2_ENDPOINT` | R2 | 账号级 S3 endpoint |
| `STUDIO_R2_BUCKET` | R2 | 对应环境 Bucket |
| `STUDIO_R2_ACCESS_KEY_ID` | R2 | Bucket-scoped Token 的 Access Key ID |
| `STUDIO_R2_SECRET_ACCESS_KEY` | R2 | Bucket-scoped Token 的 Secret Access Key |
| `STUDIO_R2_REGION` | R2 | 固定 `auto` |
| `STUDIO_ARTWORK_ROOT` | 仅本地回退 | filesystem 模式目录；R2 模式不使用 |
| `STUDIO_PAYMENT_ENABLED` | 支付 | 默认 `false`；测试小额支付验收完成前不得开启 |
| `STUDIO_PAYMENT_CONFIG_KEY` | 支付配置 | `openssl rand -base64 32` 生成；用于加密 Studio PostgreSQL 内的供应商配置，测试/生产独立且必须备份 |

微信和支付宝凭证在 Studio 运营端录入，不再通过 `STUDIO_WXPAY_*` 环境变量配置。微信填写 AppID、商户号、商户证书序列号、商户私钥、微信支付公钥、公钥 ID 和 APIv3 Key；支付宝填写应用 AppID、应用私钥和支付宝公钥。

Secret 文件权限必须为 `0600`，商户私钥文件可进一步设为 `0400`，属主为 Studio 服务账号。不得使用 `Environment=` 把 Secret 展开进公开的进程列表、CI 输出或镜像层；部署完成后检查日志未回显连接串、Cookie 或 Key。

测试回调地址由运营端按供应商显示，例如 `https://router-test.nanafox.com/tools/image-studio/api/payments/webhooks/wxpay/wxpay-default` 和 `.../alipay/alipay-default`；生产域名对应 `https://studio.nanafox.com/api/...`。不要填写 Router 的 `/api/v1/payment/webhook/*`。商户资料更换时先关闭新下单并核对待支付订单，再整体替换同一商户身份的一组配置。

测试服务器当前使用用户级 Secret，避免要求 `nio` 获得免密 sudo：

- `/home/nio/.config/nanafox/secrets/nanafox-studio-test.env`：R2 配置，`0600`。
- `/home/nio/.config/nanafox/secrets/nanafox-studio-test-db.env`：PostgreSQL 连接串，`0600`。
- `/home/nio/.config/nanafox/secrets/nanafox-studio-test-runtime.env`：Router 身份、生图和非 Secret 运行参数，`0600`。

Docker 使用三个 `--env-file` 读取；不得复制到 `/srv`、仓库或镜像。生产应由正式服务账号或主机 Secret 管理接管。

`STUDIO_GENERATION_ENABLED` 是部署级总开关，运营端不能修改或绕过。部署开启后，Router 管理员可以在“生图服务”中暂停或恢复接收新任务；页面只返回模型、存储类型和凭证是否就绪，不返回 Key、Base URL、R2 endpoint、Bucket 或 Access Key。暂停前确认没有需要新建的验收任务；暂停不会中断已经开始的任务。

## 4. 构建和门禁

在 Studio worktree 执行：

```bash
npm install
npm run build:studio
npm test
npm run test:studio-server
```

测试 path 部署必须把 Vite base path 烘焙进静态制品，不能只设置服务端 Cookie Path：

```bash
docker build \
  --build-arg STUDIO_BASE_PATH=/tools/image-studio/ \
  -f deploy/studio.Dockerfile \
  -t nanafox-studio:test-<commit>-path .
```

生产域名根路径使用默认 `STUDIO_BASE_PATH=/`，不得直接复用测试 path 静态制品。

门禁要求：

- normal/studio TypeScript 构建通过；不得手改 `dist/`。
- 前端全量测试通过。
- Studio server 全量测试通过，语句覆盖不低于 80%。
- PostgreSQL 集成测试连接隔离测试 database 后通过；不能只因没有测试连接串而跳过。
- R2 真实集成测试在测试 Bucket 完成，且不打印凭证。
- 构建制品记录 commit、文件清单和 SHA-256；测试与生产使用同一不可变制品，使用不同配置。

## 5. 测试环境部署顺序

1. 记录测试和生产现状：容器/进程、监听端口、Caddy 配置、静态指针、数据库和健康状态。
2. 备份现有测试 SQLite 和本地作品目录；只读统计用户、Session、额度、任务和作品数量。
3. 创建 `nanafox_studio_test` 与测试 role，运行 migration。
4. 如果现有测试数据需要保留，执行一次性导入并逐表核对数量；否则明确记录为可丢弃测试数据。
5. 创建 R2 测试 Bucket 与 Token，写入测试 Secret。
6. 暗部署新 Studio 服务到独立端口，先保持 `STUDIO_GENERATION_ENABLED=false`。
7. 验证 `/api/health` 进程存活、`/api/ready` PostgreSQL readiness、Router 身份接口和静态资源。
8. 打开真实生图，完成一笔最小生成：预占、Provider、R2、任务成功、额度确认全部一致。
9. 重启 Studio 服务，确认 Session、额度、任务和作品仍可读取。
10. 执行权限负向：未登录、CSRF、他人 task id、无额度、重复幂等键、R2 不存在对象。
11. 验证 Router 当前管理员可修改每日免费次数、给单用户幂等加额、编辑套餐并暂停/恢复新生图任务；普通用户为 403，降权后立即失效，所有写操作有同事务审计记录。暂停时确认没有新增任务、额度预占、Provider 调用或 R2 对象。
12. 支付默认保持关闭；取得测试商户资料后创建隐藏一分钱套餐，验证真实下单、扫码、异步通知、主动查单补偿、只履约一次和错误金额拒绝。
13. 执行 PostgreSQL 恢复演练和 R2/NAS 抽样校验。
14. 观察至少 24 小时后再形成生产候选。

## 6. 真实验收矩阵

| 场景 | 通过标准 |
|-----|---------|
| 注册/登录 | 使用 Router 用户与验证码，浏览器获得 Studio Session；没有 ChatGPT 登录或 mock 身份 |
| 免费额度 | 默认 3 次且运营修改后生效；并发最后一次只能成功一个请求 |
| Plus/Pro/加量包 | 展示配置与后端 entitlement 一致；订阅用户不叠加每日免费次数 |
| 微信扫码支付 | 金额来自后端套餐快照；通知与主动查单均可完成一次且仅一次履约；伪造/重复/错金额通知不发额度 |
| 管理员加额 | 指定用户增加额度；相同 reference 重试不重复发放 |
| 真实生成 | Router 返回真实图片；R2 有对象；PostgreSQL 有任务和 metadata；额度只扣一次 |
| 失败补偿 | Provider/R2 失败释放预占；页面明确显示未扣额度 |
| 作品权限 | 本人可读，他人或未登录为 404/401；Bucket 保持私有 |
| 重启 | 重启后 Session、额度、任务、作品仍存在 |
| 中国内地网络 | 浏览器只访问 Studio 域名；不出现 `r2.cloudflarestorage.com` 请求 |
| 其他产品隔离 | Router、Sub2API、Playground 的 root/health/login/keys 和现有图像入口无回归 |

只有 URL/HTTP 200 不等于视觉和业务验收。桌面、移动端、登录、完整生成、作品显示和管理员操作都要在真实浏览器复验。

## 7. 备份计划

### 7.1 PostgreSQL

- 每 6 小时 `pg_dump -Fc` 对单独 Studio database 做逻辑备份。
- 每份备份生成 SHA-256，并使用独立备份密钥加密。
- 服务器短期保留最近 2 天；NAS 保留 7 个每日、4 个每周、6 个每月。
- 每月用 PostgreSQL 容器内 `pg_restore` 恢复到隔离 database，运行表数量、用户/额度/任务抽样检查。
- 不用“备份文件存在”代替恢复成功证据。

测试环境当前状态：`nanafox-db-backup.timer` 每日 19:30 UTC 运行并带最多 10 分钟随机延迟，已包含 `sub2api`、`sub2api_test`、`nanafox_studio_test` 和 globals。NAS Bucket 返回的对象过期时间约为 31 天，因此当前只是每日 31 天滚动备份，不等于上面的 6 小时与分层保留目标。

### 7.2 R2

- NAS 使用独立只读 Token 每日增量拉取。
- NAS 端保留删除文件至少 7 天，不立即镜像云端删除。
- 每日对新增对象校验大小和抽样 SHA-256；每月随机恢复对象到隔离目录。
- R2 默认耐久性不是误删备份；Bucket 管理和应用写入凭证分离。

NAS 不能从公网暴露管理端口，也不能成为 Studio 在线依赖。若家庭网络无法稳定完成备份，再增加内地 OSS 加密冷备，不直接把它变成在线双写。

## 8. 生产发布门禁

执行任何生产写操作前必须全部满足：

- [ ] 用户明确授权“执行 NanaFox Studio 生产发布”。
- [ ] 测试环境使用 PostgreSQL + R2 连续观察至少 24 小时无未解释错误。
- [ ] 测试完整验收矩阵通过，并有真实浏览器截图/记录。
- [ ] 生产 database/role、Bucket/Token、DNS/TLS、Secret、备份目录均已准备。
- [ ] 当前分支推送到可定位的远端 ref；制品 SHA-256 可追溯。
- [ ] 生产 PostgreSQL 与 Caddy 配置备份可读，恢复命令已演练。
- [ ] R2 与数据库容量、费用和错误告警已配置。
- [ ] 生产回滚镜像/制品与上一版本明确，Router 不在发布范围。

## 9. 生产发布顺序

1. 记录生产基线和回滚点。
2. 运行 PostgreSQL migration；不删除或重命名旧列。
3. 暗部署 Studio 新服务，不切 DNS。
4. 用 localhost/Host header 验证 health、登录、静态资源和数据库。
5. 切 `studio.nanafox.com` 到新服务，仅管理员可见。
6. 完成一次受控真实生图与作品读取；禁止自动重试或双发。
7. 开放普通用户，复验免费额度和购买入口。
8. 观察 1 小时、24 小时；核对 5xx、R2 错误、额度 pending、数据库连接和出口带宽。

## 10. 回滚

### 测试环境

测试切换阶段可回到已备份的 SQLite/本地作品版本；PostgreSQL 和 R2 保留只读排障，不立即删除。

### 生产环境

生产一旦接受 PostgreSQL/R2 写入，**不回退到 SQLite**，否则会隐藏新用户、额度和作品数据。生产回滚只允许：

1. 隐藏 Studio 普通用户入口。
2. 切回上一版 PostgreSQL 兼容的 Studio 镜像/静态制品。
3. 恢复上一版配置和 Caddy 指针。
4. 保留新 PostgreSQL 行和 R2 对象，不做破坏性清理。
5. Router/Sub2API 不回滚、不重启，因为不在本次发布范围。

如 migration 向后不兼容，则不得上线；首发 migration 必须 additive。

## 11. 当前待办状态

| 项目 | 状态 | 下一步 |
|-----|-----|-------|
| PostgreSQL 代码迁移 | 已完成并部署测试环境 | migration 001..009 已应用；生成可靠性、作品保留、灵感和支付供应商表均通过真实 PostgreSQL 验证 |
| R2 Store 代码 | 已完成并部署测试环境 | 私有 PUT/GET/幂等/冲突/DELETE 合约通过 |
| Cloudflare R2 订阅与测试 Bucket | 已完成 | 补未完成 multipart upload 清理，不设置全桶 30 天删除 |
| R2 API Token | 已创建并安全写入测试服务器 | 保持单 Bucket 最小权限，生产另建 Token |
| 测试 PostgreSQL database/role | 已创建并完成 migration | 继续监控连接与备份，不共享 Sub2API 业务表 |
| 切换前备份 | 已完成 | SQLite/本地作品约 9 MB；共享 PostgreSQL cluster dump 已校验 SHA-256 |
| 测试服务器切换 | 已完成 | `nanafox-studio:test-e4e3dd1-path` 运行于 8788；`751d0fd` 容器保留为唯一直接回滚点 |
| 真实供应商/R2 探针 | 已完成 | 真实生成约 1.03 MB PNG，R2 写入/读回一致后删除测试对象 |
| 浏览器验收 | 公网桌面创作页与运营总览曾用真实 Router 管理员 Session 复验；390×844 移动创作、登录和找回页无横向溢出 | `e4e3dd1` 的账户菜单修复已部署，当前浏览器控制通道超时；待人工复验该菜单，并补真实 3 次额度、删除/恢复作品和各运营写操作 |
| 管理员受保护 API/真实页面 | 已部署测试环境 | Router 当前 `admin` 自动获得入口和权限；公网真实管理员 200、普通用户 403 已验证。CSRF、每日免费次数、用户查询、幂等加额和同事务审计保持不变 |
| 支付、订阅与加量包 | 代码与测试环境部署已完成 | Plus/Pro/加量包已上架展示，但接单开关关闭，微信/支付宝供应商均停用且未配置；完成真实小额验收后才能开放 |
| 灵感运营配置 | 已部署测试环境 | PostgreSQL 保存 9 条首批内容；运营端可新增、编辑、上下架、推荐和排序。收藏仍只在页面状态，首发不承诺跨设备同步 |
| Studio 账户入口防刷 | 已部署测试环境 | 验证码、注册、登录和 2FA 已在调用 Router 前按账号/IP 集中限流；生产前补 429 告警，出现分布式滥用再启用边缘规则或 Turnstile |
| PostgreSQL/Redis 公网暴露 | 高风险待整改；2026-08-29 已从外部网络确认 5432/6379 可建立 TCP 连接 | 属于 Sub2API 共享基础设施，另开维护窗口收紧到 localhost 或云防火墙白名单；Studio 不擅自修改 |
| PostgreSQL 备份 | 部分完成，生产仍阻断 | 每日 NAS 任务已包含 Studio 测试库，同机隔离恢复通过；频率仍非 6 小时，NAS 端异机恢复和长期分层保留未完成 |
| 测试服务器磁盘 | 观察项 | `e4e3dd1` 发布并清理本次临时源码后根盘为 91%、约 4.4 GB 可用；保留当前与 `751d0fd` 回滚镜像，生产前配置阈值告警并单独清理可重建缓存 |
| Caddy Studio 路由持久化 | 已核对 | `/etc/caddy/Caddyfile` 含测试 path 路由；普通用户可完成 Caddyfile adapt，完整 validate 因无权写现有日志文件而不能代替 root 发布检查 |
| NAS 自动备份 | 数据库已启用，R2 作品未启用 | 为 R2 创建独立只读 Token 后配置 NAS 增量拉取；不得复用应用写 Token |
| 生产资源 | 未创建 | 测试验收通过后准备，不提前复用测试资源 |
| 生产发布 | 未授权 | 通过所有门禁后单独请求授权 |

### 11.1 2026-08-27 测试发布证据

- Git commit：`9b7ce84`；容器镜像：`nanafox-studio:test-9b7ce84-path`。
- 生产依赖审计：0 个已知漏洞；前端：48 个文件、586 个测试通过。
- Studio 服务：71/71 通过，包含真实 PostgreSQL 和私有 R2 合约；部署约束另测 1/1 通过。
- 公网：页面、子路径静态资源、`/api/health`、`/api/ready` 均为 200；未登录 Session/生图均为 401。
- Caddy 持久配置包含 `/tools/image-studio/*` 到 `127.0.0.1:8788` 的 `handle_path`；生产 vhost 仍保持该旧 path 为 410，没有修改生产路由。
- 重启后 PostgreSQL readiness、页面和子路径资源继续通过；Sub2API test/prod、PostgreSQL、Redis 容器保持 healthy，Router test root 与 `/health` 为 200。
- Playwright 在 1440×1000 与 390×844 检查登录和注册页面。两条外部字体 CSS 被 CSP 主动阻止并回退系统字体；未登录 Session 的 401 为预期，不是业务 5xx。
- 旧 SQLite/本地作品没有导入 PostgreSQL/R2；测试备份保留在 `/home/nio/backups/nanafox-studio-test/pre-postgres-r2-20260827/`。因此旧测试 Session 会失效，旧测试作品暂不显示，但可回滚恢复。

### 11.2 2026-08-27 管理端与安全修正版

- Git commit：`9cb4617`；容器镜像：`nanafox-studio:test-9cb4617-path`；上一候选 `33202772` 与旧版 `9b7ce84` 容器保持停止状态，可用于测试回滚。
- 前端 normal/studio 构建通过，49 个文件、590 个测试通过；Studio 服务 79/79 通过，真实 PostgreSQL 与私有 R2 未跳过，行覆盖率 92.39%。
- PostgreSQL migration 已到 `1,2`，`studio_admin_audit_log` 存在；当次版本仍使用 `STUDIO_ADMIN_SUBJECTS`。该机制已在后续版本被 Router 当前角色解析替代，本段只保留历史发布证据。
- 公网页面、静态资源、`/api/health`、`/api/ready` 为 200；未登录 `/api/admin/me`、`/api/auth/session` 为 401；容器以 `studio` 非 root 用户运行。
- 真实浏览器在 1280×720 与 390×844 验证登录和注册布局；无效外部字体请求已删除，控制台只保留未登录 Session 探测的预期 401。
- 管理员真实 Session 的页面级 200、一次每日额度修改和一次幂等加额仍需人工验收；当次版本未包含支付和套餐管理。后续版本即使代码已实现，在真实商户小额支付验收前仍不得声称商业闭环已完成。

### 11.3 2026-08-28 支付基础版测试发布证据

- Git commit：`25eb8d3`；容器镜像：`nanafox-studio:test-25eb8d3-path`；切换前版本保存为停止容器 `nanafox-studio-test-rollback-9cb4617-20260828`。
- 切换前 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-payment-20260828-1645/`；SHA-256 与 `pg_restore -l` 校验通过。
- 前端 normal/studio 构建通过，50 个文件、594 个测试通过；Studio 服务 95 个通过、1 个本地 R2 合约跳过，真实 PostgreSQL 行覆盖率 91.34%；运行镜像生产依赖审计为 0 个已知漏洞。
- 暗部署先在 8790 完成 migration 003、健康/就绪、未登录权限和套餐草稿检查；真实 R2 PUT/GET/冲突/DELETE 合约 1/1 通过后才切换 8788。
- 切换后原有 2 个测试用户、1 个生成任务、0 个额度记录保持不变；支付订单为 0，Plus/Pro/加量包均为停用草稿，`STUDIO_PAYMENT_ENABLED=false`。
- 公网页面和静态资源、`/api/health`、`/api/ready` 为 200；未登录 Session、套餐和运营接口为 401；关闭渠道的微信回调为 503。Sub2API test/prod、PostgreSQL、Redis 未重启且保持 healthy。
- Chrome 已确认目标 URL 与 `NanaFox Studio` 标题；扩展的截图/DOM 通道连续超时，因此本次不把桌面、移动和登录后套餐页记为视觉通过。真实商户小额支付及该视觉复验仍是开放收费前门禁。

### 11.4 2026-08-28 Router 角色自动授权测试发布证据

- Studio Git commit：`c8a130a`，测试镜像：`nanafox-studio:test-c8a130a-path`；Sub2API 测试部署 commit：`df127d246`，测试镜像：`sub2api:test-studio-df127d246`。
- 切换前 `sub2api_test` 与 `nanafox_studio_test` 的 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-router-role-20260828T013344Z/`，两个 dump 均通过 `pg_restore -l` 和 SHA-256 校验。
- Sub2API 新增签名 `/internal/v1/studio-auth/resolve`，按 stable subject 与邮箱读取当前账户状态和 `admin/user` 角色；无签名请求为 401，响应不含 Router access/refresh token。
- Studio 移除 `STUDIO_ADMIN_SUBJECTS` 固定白名单。每个运营 API 请求都实时解析 Router 角色；管理员为 200、普通用户为 403、身份服务不可用或协议异常时为 503，不使用前端菜单作为授权边界。
- 暗部署和公网切换后均使用真实 Router 测试库角色与临时 Studio Session 验证管理员 200、普通用户 403；探针 Session 与临时用户映射已清理。
- 前端 50 个文件、594 个测试通过；Studio 服务端 96 个用例无失败；normal/studio 构建和 Sub2API handler/server 相关 Go 包通过。公网页面、静态资源、健康和就绪接口均为 200，生产 Router 未更新且保持 healthy。
- 切换后根盘曾因构建缓存达到 93%；只清理了 4.95 GB 可重建 Docker build cache，数据库卷、作品、运行镜像与两个明确回滚容器未删除，根盘回落至 82%。

### 11.5 2026-08-28 运营台与产品闭环修正版

- Studio Git commit：`49dc3ba`；测试镜像：`nanafox-studio:test-49dc3ba-path`；上一版保存为停止容器 `nanafox-studio-test-rollback-c8a130a-20260828`，并复用原 `/data` 卷。
- 切换前 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-ui-20260828T024944Z/`，dump 已通过 `pg_restore -l` 和 SHA-256 校验。
- 前端 50 个文件、597 个测试通过；Studio 服务端在测试服务器使用真实 PostgreSQL 与私有 R2 运行 96/96，通过且无跳过，行覆盖率 91.73%；运行镜像生产依赖审计为 0 个已知漏洞。
- 运营端改为任务型控制台，包含运营总览、每日免费额度、用户查询与确认加额、Plus/Pro/加量包列表及编辑对话框；高风险写入保留确认与后端审计，普通用户不显示入口且服务端返回 403。
- 公网真实 Router 角色联动验证：管理员对运营身份、额度策略、套餐列表和用户查询均为 200，普通用户均为 403；登录态、额度、作品列表和公开套餐对两种角色均为 200。临时 Session 与用户映射已清理。
- 公网页面、静态资源、健康和就绪接口均为 200；未登录 Session、作品、套餐和运营接口为 401。Sub2API test/prod、PostgreSQL、Redis 均保持 healthy，生产 Router `/health` 为 200，未修改生产容器、配置或路由。
- 真实浏览器验证桌面登录、注册切换和 390×844 移动注册页；移动端无横向溢出，页面无浏览器错误日志。登录后的创作、灵感、作品、额度、账户和运营页面已用同一构建制品完成本地视觉验收；仍不把公网真实账户的 3 次生成、真实作品历史或微信小额支付记为已验收。

### 11.6 2026-08-28 支付渠道运营配置测试发布证据

- Studio Git commit：`c05054c`；测试镜像：`nanafox-studio:test-c05054c-path`；上一版保存为停止容器 `nanafox-studio-test-rollback-49dc3ba-20260828`。
- 切换前 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-payment-ops-20260828T045555Z/`，dump 已通过 `pg_restore -l` 和 SHA-256 校验。
- migration 004 新增单例支付渠道状态，默认 `accepting_orders=false`；运营更新使用版本号和审计事务。商户号、私钥、平台公钥和 APIv3 Key 仍只从服务器 Secret 读取，不进入运营 API、浏览器或 PostgreSQL。
- 服务端在测试服务器使用真实 PostgreSQL 与私有 R2 运行 100/100，通过且无跳过，行覆盖率 91.74%；前端 50 个文件、598 个测试和 Studio 构建通过。
- 暗部署和公网均验证：真实 Router 管理员读取支付渠道为 200、普通用户为 403；凭证未配置时尝试开放接单返回 409，保持关闭可成功写入且生成审计记录。
- 停止接单只阻止新订单；既有订单主动查单和已验签微信回调继续履约，避免用户已付款但额度不到账。真实资金支付仍需测试商户资料后验收。
- 公网页面、静态资源、健康和就绪接口均为 200；浏览器登录页无视觉回归，线上 Studio 制品包含支付渠道运营页面。Sub2API test/prod、PostgreSQL、Redis 和生产 Router 均保持 healthy，未修改或重启生产服务。

### 11.7 2026-08-28 账户入口防刷测试发布证据

- RED commit：`6881b0b`；GREEN commit：`1a715b6`；测试镜像：`nanafox-studio:test-1a715b6-path`；上一版保存为停止容器 `nanafox-studio-test-rollback-c05054c-20260828`。
- 切换前 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-auth-rate-20260828T051048Z/`；dump 为 31,971 bytes，`pg_restore -l` 有 79 行，SHA-256 为 `84c3800a8a454fa5428731cb1308c9047798679517bae98dc6101b6c310d0650`。
- migration 005 新增账号/IP HMAC 限流桶；不保存原始邮箱、IP 或 2FA challenge。验证码、注册、登录和 2FA 均在调用 Router 前限流，命中后统一返回 429 与 `Retry-After`。
- 测试服务器使用真实 PostgreSQL 与私有 R2 运行 104/104，通过且无跳过；服务端行覆盖率 91.86%，限流模块行覆盖率 100%、分支覆盖率 81.25%；前端 50 个文件、598 个测试与 Studio 构建通过。
- 8790 暗部署和公网 8788 都验证：同一账号前 10 次错误登录由 Router 返回 401，第 11 次由 Studio 返回 429 且 `Retry-After=900`；PostgreSQL 只出现长度 64 的 HMAC，Caddy 公网请求未产生 `unknown` IP 桶。
- Studio 仍只监听 `127.0.0.1:8788`。公网前端、健康和就绪接口为 200；未登录 Session、运营与生成接口为 401。Sub2API test/prod、PostgreSQL、Redis 和 Router test/prod `/health` 均保持 healthy/200，Router/Sub2API 代码、配置和容器均未修改或重启。

### 11.8 2026-08-28 作品删除与恢复测试发布证据

- RED commit：`086d5b5`；GREEN commit：`8b025ff`；测试镜像：`nanafox-studio:test-8b025ff-path`；上一版保存为停止容器 `nanafox-studio-test-rollback-1a715b6-20260828`。
- 切换前 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-artwork-retention-20260828T052636Z/`；dump 为 33,960 bytes，`pg_restore -l` 有 83 行，SHA-256 为 `c72bfaa9e7720d2b9f75ee9b6aa5d2a25b40f6e1550ac6c5d7e4bbf74d1cdc9b`。
- migration 006 在现有任务表增加可空删除、清理期限和已清理时间；删除后进入 7 天“最近删除”，恢复不重新扣额，到期先删除私有 R2 对象再写墓碑，失败保留待重试状态。
- 前端 50 个文件、599 个测试通过；Studio 服务端本地 108 项零失败，测试服务器真实 PostgreSQL/R2 为 108/108 且无跳过。
- 8790 暗部署应用 migration 后，原有 2 个测试用户、1 个生成任务、0 个加额和 0 个支付订单保持不变；公网前端、健康和就绪为 200，未登录作品、最近删除、删除、恢复和运营接口均为 401。
- Studio 仍只监听 `127.0.0.1:8788`；Sub2API test/prod、PostgreSQL、Redis 和 Router test/prod 均保持 healthy/200，Router/Sub2API 代码、配置和容器均未修改或重启。
- Chrome 已确认现有 Studio 页面标签，但刷新和 DOM 通道连续超时，因此本次不把登录后作品库“全部作品/最近删除”的视觉验收记为通过。

### 11.9 2026-08-28 PostgreSQL 备份与恢复证据

- 发布前 dump 已恢复到临时隔离数据库：migration 为 `1..5`，2 个用户、1 个生成任务、0 个加额、0 个支付订单和 14 张 Studio 表均与备份时一致；验证后临时库已删除。
- 服务器既有 `/usr/local/sbin/nanafox-db-backup` 仅备份 `sub2api` 和 `sub2api_test`；本次只增加 `dumpDatabase 'nanafox_studio_test'`，原脚本保留为 `/usr/local/sbin/nanafox-db-backup.bak-20260828T053432Z`。
- `nanafox-db-backup.service` 手动完整运行成功：Sub2API、Sub2API test、Studio test 和 globals 均先通过 `pg_restore --list`/内容校验，再上传 NAS MinIO 并逐文件 `mc stat`。
- NAS 上 `nanafox_studio_test-20260828T053439Z.dump` 为 34,504 bytes，配套 SHA 文件为 108 bytes；对象可读元数据确认成功。
- 当前 timer 是每日任务而非 6 小时；NAS 对象显示约 31 天后过期。数据库异机恢复、7 日/4 周/6 月分层保留和 R2 作品备份仍是生产门禁，不能因本次上传成功而标记完成。
- 备份期间 Studio 保持 healthy，公网 readiness 为 200；没有修改或重启 Router/Sub2API/PostgreSQL/Redis 容器。

### 11.10 2026-08-28 灵感内容运营测试发布证据

- RED commits：`45ba4d7`、`f948e62`；GREEN commit：`0e19078`；测试镜像：`nanafox-studio:test-0e19078-path`；上一版保存为停止容器 `nanafox-studio-test-rollback-8b025ff-20260828`。
- migration 007 新增 Studio 自有灵感表和 9 条现有内容种子；运营端可新增、编辑、上下架、设置首页推荐和排序，写入使用乐观版本并与管理员审计同事务完成。前端不再硬编码内容。
- 前端 601 项测试、normal/studio 构建通过；测试服务器真实 PostgreSQL/R2 服务端测试为 111/111、无跳过，行覆盖率 92.24%。
- 暗部署后 schema migration 为 `1..7`；原有 2 个用户、1 个生成任务、0 个加额和 0 个支付订单保持不变。切换前 dump 位于 `/home/nio/backups/nanafox-studio-test/pre-inspirations-20260828T055846Z/`，大小 34,504 bytes，`pg_restore -l` 有 84 行，SHA-256 为 `d8898c9dca827563ed0b3d0c46010e3ca62923dd916004990ba7f7906ba3c649`。
- 公网页面、静态资源、健康和就绪接口为 200；未登录 Session、灵感、运营和作品接口为 401。桌面灵感库、编辑弹窗和 390×844 移动布局用隔离 mock 数据完成同制品视觉自审，无横向溢出或控制台错误；公网真实管理员写操作仍需登录态验收。
- 本次没有修改 Router/Sub2API 代码、配置或容器；支付渠道开关、套餐价格和额度仍由 Studio 运营端配置，商户 Secret 仍只存在服务器环境。Router test/prod health 为 200，Sub2API test/prod、PostgreSQL、Redis 保持 healthy。

### 11.11 2026-08-28 生成可靠性与 CI 测试发布证据

- Studio Git commit：`476a9c7`；测试镜像：`nanafox-studio:test-476a9c7-path`；上一版保存为停止容器 `nanafox-studio-test-rollback-0e19078-20260828`。
- 切换前 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-reliability-20260828T1109Z/`，dump 为 37,398 bytes、`pg_restore -l` 为 88 行，SHA-256 为 `d0d85cfc1f05b5cc093cc5e06ed24ca8eef28f84ad9f23df306d15a197f4d203`。
- migration 008 从现有 migration 7 升级；切换前后均为 2 个用户、1 个任务、0 个活跃任务、0 个 reserved reservation 和 0 个支付订单。partial unique index 已存在，支付接单仍为关闭。
- 前端 51 个文件、603 个测试通过；Studio 服务端使用临时 PostgreSQL 为 116 通过、0 失败、1 个 R2 live 用例跳过，行覆盖率 91.91%；normal/studio 双构建通过。服务器 R2 另行完成真实 PUT/GET/同内容幂等/冲突/DELETE 探针，运行镜像生产依赖审计为 0 个已知漏洞。
- 8790 暗部署先完成 migration、health/ready、静态资源、未登录 401 和 R2 探针，再切换 8788。切换后完成容器重启，公网页面、静态资源、`/api/health`、`/api/ready` 均为 200。
- Chrome 使用现有真实 Router 管理员 Session 验证创作首页、3/3 免费额度、已有作品和 `#/admin` 运营总览；运营入口自动出现，页面无 `role=alert` 错误且桌面无横向溢出。本次没有消耗额度、提交运营写操作或测试真实支付。
- 新增 Studio 专用 CI：强制 PostgreSQL 测试、80% 行覆盖率、normal/studio 构建、真实 Dockerfile 构建及容器 health/ready/首页冒烟；本地合同已通过，仍需首次 GitHub runner 验证 Docker 阶段。PR 不加载 R2 Secret，R2 保留为测试部署门禁。
- 清理了 10 个旧停止的 Studio 回滚容器、10 个旧可重建镜像、本次暗部署容器和临时源码；只保留当前镜像与上一版回滚。另清理 839.4 MB 可重建 Docker build cache，根盘由构建后的 89% 回到 86%。
- Router/Sub2API 代码、配置和容器未修改或重启；Router test/prod health 为 200，Sub2API test/prod、PostgreSQL、Redis 保持 healthy。

### 11.12 2026-08-28 账户找回测试发布证据

- Studio Git commit：`f40e582`，测试镜像：`nanafox-studio:test-f40e582-path`，回滚容器：`nanafox-studio-test-rollback-476a9c7-20260828`。Sub2API test Git commit：`01dc0d6a2`，测试镜像：`sub2api:test-studio-01dc0d6a2`，回滚容器：`sub2api-test-rollback-df127d246-20260828`。
- 切换前备份位于 `/home/nio/backups/nanafox-studio-test/pre-account-recovery-20260828T1225Z/`：Studio dump 37,885 bytes、`pg_restore -l` 89 行、SHA-256 `c048338919657eee8a06143443c8b1fb93796beabfa187f6fe3f9bbd617e3e41`；Sub2API test dump 90,053,286 bytes、`pg_restore -l` 1,249 行、SHA-256 `1b29aaf7fed0cfcb6c5409381edc39089e27734a6895e914b8616905f291c742`。
- Sub2API 新增两条 HMAC 签名内部 adapter，复用现有邮件、token 和改密 service；reset token 改为 Redis WATCH 下的原子 compare-and-delete，并发仅一次成功。受影响 Go package 全量测试通过，暗启动 health 为 200，两条 adapter 未签名请求均为 401。
- Studio 新增品牌内找回/重置页、账号与 IP 独立限流、固定服务端 reset base URL、`Referrer-Policy: no-referrer` 和改密后全部 Studio Session 撤销。前端 52 文件/604 测试通过；服务端 119 项中 118 通过、1 项仅因本地无真实 R2 Secret 跳过，行覆盖率 92.03%；normal/studio 构建和真实 Dockerfile 构建通过。
- 8790 暗部署的 health、ready、首页、子路径静态资源和安全头通过。Studio 使用签名 adapter 已到达 Router 业务层；测试 Router 当前关闭密码找回，因此返回 `PASSWORD_RESET_DISABLED`。未擅自打开邮件能力，真实邮件和旧 Session 失效仍是配置启用后的测试环境验收项。
- 公网首页、静态资源、health 和 ready 均为 200；未登录 Session、作品和运营接口均为 401。Chrome 使用真实 Router 管理员 Session 复验创作首页、自动运营入口、每日 3 次、3/3 套餐和 9/9 灵感；支付仍为未开放且凭证未完整。隔离会话验证找回/重置页无溢出、无控制台错误，reset token 在页面读取后立即从 URL 清除；390×844 移动创作、登录和找回页也无横向溢出。
- 只替换 `sub2api-test` 和 `nanafox-studio-test`；`sub2api-prod` 未重启、未替换，Router test/prod 为 200，PostgreSQL/Redis 保持 healthy。清理了本次临时源码、可重建 build cache 和多余旧回滚容器/镜像，两个系统各保留一个直接回滚点，根盘由 97% 恢复到 85%。

### 11.13 2026-08-29 Studio 多支付供应商测试发布证据

- Studio Git commit：`751d0fd`，测试镜像：`nanafox-studio:test-751d0fd-path`，直接回滚容器：`nanafox-studio-test-rollback-f40e582-20260829`。本次没有修改 Router/Sub2API 仓库、配置、数据库或容器。
- 切换前 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-payment-providers-20260829T022418Z/`；dump 为 38,119 bytes、`pg_restore -l` 为 89 行，SHA-256 为 `8ba36af0df9799483a1f72929194a98db6b262af6661c03e5909c67c7c312bba`。
- migration 009 新增 Studio 自有支付供应商表，并为订单增加供应商实例和支付宝跳转地址。升级后 migration 为 `1..9`，原有 2 个用户、1 个生成任务和 0 个支付订单保持不变；微信、支付宝各有一个默认停用且未配置的供应商实例。
- 供应商敏感配置使用 `STUDIO_PAYMENT_CONFIG_KEY` 进行 AES-256-GCM 加密后保存在 Studio PostgreSQL；浏览器、运营读取接口和审计记录只返回掩码状态。加密主钥只存在 Studio 测试服务器的 `0600` runtime Secret 文件，不进入数据库、镜像或前端。
- 前端 52 个文件、605 个测试通过；服务端使用真实 PostgreSQL 和私有 R2 运行 131/131、无跳过，行覆盖率 92.06%；生产依赖审计为 0 个已知漏洞。真实 R2 PUT/GET/同内容幂等/冲突/DELETE 合约通过。
- 8790 暗部署发现未配置供应商回调曾返回 500，因此未切流；`751d0fd` 在供应商构造入口统一 fail-closed，回归测试和第二次暗部署确认返回 `503 PAYMENT_NOT_CONFIGURED` 后才切换 8788。
- 公网页面、静态制品、`/api/health` 和 `/api/ready` 均为 200；未登录运营和套餐接口为 401。临时 Studio Session 验证真实 Router 管理员读取 `/api/admin/me` 与 `/api/admin/payment-providers` 均为 200，Session 随后删除。
- 同一公网构建制品使用隔离响应完成支付渠道页和支付宝配置弹窗视觉自审：无横向溢出、无控制台错误；截图位于 `output/playwright/studio-payment-admin.png` 和 `output/playwright/studio-alipay-provider-modal.png`。Chrome 与应用内浏览器的截图/DOM 通道连续超时，因此不把它们记为真实登录态视觉证据。
- `STUDIO_PAYMENT_ENABLED=false`、运营收款开关关闭且两个供应商均未配置；没有创建订单、提交商户凭证或发生真实资金交易。开放收费前仍需完成真实商户凭证录入、回调平台配置和小额支付/重复回调/退款门禁。

### 11.14 2026-08-29 账户菜单 UI 修正版测试发布证据

- 发布前重新核对 `router-test.nanafox.com -> 108.160.133.141`，目标机现有 `nanafox-studio-test`、Secret 文件和 8788 监听均匹配；明确排除 `jpq`/`114.55.14.204`。
- Studio Git commit：`e4e3dd1`；测试镜像：`nanafox-studio:test-e4e3dd1-path`；直接回滚容器：`nanafox-studio-test-rollback-751d0fd-20260829-ui`。
- 8790 暗部署先通过容器 health/ready、未登录 Session 401 和新旧菜单 CSS 选择器核对，再切换 8788。切换后容器 health、`/api/health`、`/api/ready` 及对应公网 path 均通过，容器 restart count 为 0。
- 公网制品为 `assets/index-Uti0L1wS.js` 与 Studio chunk `StudioApp-DHdfNrgJ.css`；账户菜单桌面宽度为 280px，移动端使用 `min(320px, calc(100vw - 24px))`，旧 226px/`min-width: 320px` 规则已不在当前制品。
- `sub2api-prod` 保持 `sub2api:prod-image-creation-v1-6966a8f5c`、healthy、restart count 0；Router/Sub2API 代码、配置和容器均未修改或重启。
- Chrome 与应用内浏览器的刷新、截图和 DOM 通道连续超时，因此本次只记录部署、接口与静态制品证据，不把真实登录态的最终视觉验收记为通过。

### 11.15 2026-08-31 生图服务运营控制测试发布证据

- 发布前重新核对 `router-test.nanafox.com -> 108.160.133.141`，目标机现有 Studio 容器、8788 监听和三组 `0600` Secret 均匹配；没有进入或修改 `jpq`。
- RED commit：`4e08d76`；GREEN/部署 commit：`97b1cac`；测试镜像：`nanafox-studio:test-97b1cac-path`；直接回滚容器：`nanafox-studio-test-rollback-e4e3dd1-20260831`。
- 切换前 PostgreSQL 备份位于 `/home/nio/backups/nanafox-studio-test/pre-generation-control-20260831T0059Z/`；dump 为 40,686 bytes，`pg_restore -l` 为 94 行，SHA-256 为 `480cb3e175e7ed9d9a6553bc7849d05a94a9cd3f1cdf1aad2491b2729410275c`，目录与三个文件均为仅管理员可读。
- GitHub Studio CI run `33346163988` 全绿：依赖审计、608 个前端测试、normal/studio 双构建、真实 PostgreSQL 服务端门禁、容器构建和 smoke test 均通过。
- migration 010 新增 Studio 自有单例生图开关；升级后 migration 为 `1..10`，原有 2 个用户、1 个生成任务、0 个加额和 0 个支付订单保持不变。Router Key、Base URL 和 R2 凭证仍只在服务端 Secret，运营接口只返回模型、存储类型与凭证就绪布尔值。
- 8790 暗部署完成 `运行中 -> 暂停 -> 恢复运行中`，版本从 1 到 3，暂停返回 `GENERATION_NOT_ACCEPTING`，产生 2 条同事务审计记录且生成任务数保持 1；没有调用 Provider、写入 R2 或消耗用户额度。
- 切换 8788 后容器 healthy、restart count 0；内网与公网 health/ready、首页均为 200，未登录运营和生图接口为 401。Sub2API test/prod、PostgreSQL、Redis 均保持 healthy，没有修改或重启 Router/Sub2API。
- Chrome 能发现并接管现有 Studio 标签，但刷新连续超时，因此不把真实登录态“生图服务”页面的最终视觉验收记为通过；同一线上制品已确认包含该模块，用户刷新页面后可直接验收。
- 清理了本次暗部署容器和两个过期 Studio 回滚容器/镜像，只保留当前 `97b1cac` 与直接回滚 `e4e3dd1`。根盘仍为 91%，这是独立容量风险，未用本次发布扩大清理范围。

### 11.16 2026-08-31 Studio 支付宝二维码测试发布证据

- 本次只修改 NanaFox Studio；Router/Sub2API 代码、配置、数据库和容器均未修改或重启。支付宝供应商使用 App ID `2021006193624355`，私钥与应用公钥指纹一致，只读交易查询由支付宝返回 `ACQ.TRADE_NOT_EXIST`，确认应用和私钥匹配；另一应用 ID 与该私钥不匹配，未写入 Studio。
- 切换前备份位于 `/home/nio/backups/nanafox-studio-test/pre-alipay-config-20260831T1112Z/`：PostgreSQL dump 为 42,128 bytes、`pg_restore -l` 为 97 行，并保存了只读权限的运行配置副本和 SHA-256。支付宝私钥和平台公钥通过现有 `STUDIO_PAYMENT_CONFIG_KEY` 加密进入 Studio PostgreSQL，运营读取与审计仍只返回掩码状态。
- Studio commits 为 `80cfdbc`（内嵌二维码）和 `f52761f`（网页支付请求签名包含 `sign_type=RSA2`）；当前测试镜像为 `nanafox-studio:test-f52761f-path`，直接回滚镜像为 `nanafox-studio:test-80cfdbc-path`。前端 608/608、服务端 136 项 0 失败、Studio 构建和 8790 暗部署通过。
- Caddy 仅在测试域名的 `/tools/image-studio/*` 策略增加 `frame-src https://*.alipay.com`，候选配置先经 `caddy validate --adapter caddyfile` 通过再 reload；原配置备份为 `/etc/caddy/Caddyfile.before-alipay-20260831`。公网 health/ready 和 Router test health 均为 200。
- 测试环境启用支付宝供应商和部署级支付开关，微信仍未配置且停用；复用 `pack-60` 为 0.01 元、1 次额度、7 天有效的“支付闭环测试”套餐，避免新增只用一次的套餐结构。支付渠道已开放测试接单。
- 首笔测试订单暴露出手写请求签名错误，已关闭接单、将该订单标记 failed、增加回归测试并修复；修正版支付宝真实网关返回 200、无 `invalid-signature`、包含二维码内容且无禁止 iframe 的响应头。新 Studio 订单为 pending，回调地址为 `https://router-test.nanafox.com/tools/image-studio/api/payments/webhooks/alipay/alipay-default`。真实付款、回调入库、幂等事件和 1 次额度到账仍待用户本人扫码后核验，未记为完成。
