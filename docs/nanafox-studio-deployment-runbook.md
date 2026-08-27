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

## 2. 发布前必须准备的资源

### 2.1 PostgreSQL

- [ ] 只读核对现有实例版本、磁盘、备份、`max_connections` 和当前连接峰值。
- [ ] 创建测试 database 与 role；role 只能连接 `nanafox_studio_test`。
- [ ] 创建生产 database 与 role；role 只能连接 `nanafox_studio`。
- [ ] 为两个 role 分别生成随机密码，写入服务器 Secret 文件，不复制到仓库或工单。
- [ ] 明确 PostgreSQL 容器/主机的备份目录和 NAS 加密同步目录。
- [ ] 先在测试 database 运行 migration；核对 `studio_schema_migrations` 和表数量。

不在 Studio migration 中创建 database/role；这些属于基础设施权限，由数据库管理员在发布时创建。Studio 应用只拥有自己数据库内 DML 和受控 DDL 权限。

### 2.2 Cloudflare R2

- [ ] 创建私有 Standard Bucket `nanafox-studio-artworks-test`，Location Hint 选 APAC。
- [ ] 确认 `r2.dev` 关闭、没有公共自定义域名、没有宽泛 CORS。
- [ ] 测试 Bucket 设置 30 天删除生命周期；默认 7 天清理未完成 multipart upload。
- [ ] 创建 Account API Token `nanafox-studio-test-app`：仅 `Object Read & Write`，仅测试 Bucket。
- [ ] 把 Access Key ID 与 Secret Access Key 直接写入测试服务器 Secret；Secret 只显示一次，不粘贴到聊天、文档或 Git。
- [ ] 真实执行 PUT/GET/条件覆盖失败/DELETE 测试，校验 PNG SHA-256。
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

Secret 文件权限必须为 `0600`，属主为 Studio 服务账号。不得使用 `Environment=` 把 Secret 展开进公开的进程列表、CI 输出或镜像层；部署完成后检查日志未回显连接串、Cookie 或 Key。

## 4. 构建和门禁

在 Studio worktree 执行：

```bash
npm install
npm run build:studio
npm test
npm run test:studio-server
```

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
7. 验证 `/api/health`、数据库 readiness、Router 身份接口和静态资源。
8. 打开真实生图，完成一笔最小生成：预占、Provider、R2、任务成功、额度确认全部一致。
9. 重启 Studio 服务，确认 Session、额度、任务和作品仍可读取。
10. 执行权限负向：未登录、CSRF、他人 task id、无额度、重复幂等键、R2 不存在对象。
11. 验证管理员可修改每日免费次数、套餐配置和单用户幂等加额。
12. 执行 PostgreSQL 恢复演练和 R2/NAS 抽样校验。
13. 观察至少 24 小时后再形成生产候选。

## 6. 真实验收矩阵

| 场景 | 通过标准 |
|-----|---------|
| 注册/登录 | 使用 Router 用户与验证码，浏览器获得 Studio Session；没有 ChatGPT 登录或 mock 身份 |
| 免费额度 | 默认 3 次且运营修改后生效；并发最后一次只能成功一个请求 |
| Plus/Pro/加量包 | 展示配置与后端 entitlement 一致；订阅用户不叠加每日免费次数 |
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
| PostgreSQL 代码迁移 | 已完成 | 创建隔离测试 database，运行未跳过的集成测试 |
| R2 Store 代码 | 已完成 | 创建测试 Bucket/Token，运行真实 PUT/GET/DELETE |
| Cloudflare R2 订阅 | 已完成 | 创建私有测试 Bucket |
| R2 API Token | 未创建 | 完成 Bucket 后在动作前向用户确认 |
| 测试服务器切换 | 未执行 | PostgreSQL/R2 资源就绪后部署 |
| NAS 自动备份 | 未执行 | 测试环境稳定后配置只读拉取和恢复演练 |
| 生产资源 | 未创建 | 测试验收通过后准备，不提前复用测试资源 |
| 生产发布 | 未授权 | 通过所有门禁后单独请求授权 |
