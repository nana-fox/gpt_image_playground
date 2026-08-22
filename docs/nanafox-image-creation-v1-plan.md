# NanaFox 图像创作 V1 实施计划

状态：Slice 0–3 已完成本地实现与验证；当前仍不推送、不部署。Slice 4 的真实 PostgreSQL/Redis 联调待可用环境继续。

本文件是图像创作 V1 的单一实施依据。旧的嵌入适配基线仍由 `docs/nanafox-embedded-plan.md:1` 约束；模板、灵感库、用户状态、管理端、嵌入会话和服务端增量以本文件为准。

## 1. 产品边界

### 1.1 一个产品、两种身份

- 用户入口仍是 Sub2API 的“图像创作”自定义菜单；页面主体由本 React 项目提供。
- 普通用户看到“创作台”和“灵感库”。
- 管理员通过同一嵌入应用进入管理视图，看到“模板管理”和“首页精选”。
- Sub2API Vue 只负责宿主菜单、iframe、新窗口、签发启动票据；不复制一套模板管理页面。
- 后端权限是唯一安全边界。前端隐藏管理入口只改善体验，不代表授权。

### 1.2 V1 明确不做

- 不把模板、首页精选或素材配置放进 Sub2API `settings` 表。
- 不把用户生成历史上传到服务端；现有 IndexedDB 历史继续保留在用户浏览器。
- 不引入 OSS/S3 抽象、模板版本表、轮播配置表、标签表、收藏计数、定时发布、拖拽排序、自动轮播或模板变量引擎。
- 不从开源仓库运行时同步提示词；只允许人工筛选、改写、核对许可并生成自有封面。

## 2. 当前基线

| 仓库 | 基线提交 | 本地分支 | 结果 |
|---|---|---|---|
| Playground | `ab501b1` | `codex/image-creation-v1` | 普通/嵌入构建通过；37 个测试文件 / 543 项测试通过 |
| Sub2API | `8a82c104f` | `feature/image-creation-v1` 独立 worktree | `go test ./...`、`go vet ./...` 通过；前端 lint/typecheck/build、255 个测试文件 / 1743 项测试通过；本机未安装 `golangci-lint`，不将其记为已执行 |

Sub2API 功能工作树：`/Users/nio/project/nanafox/sub2api/.claude/worktrees/image-creation-v1`。原仓库的 `hotfix/ops-error-request-snapshots` 工作区保持不变。

当前实现检查点：

- Slice 0：一次性 fragment ticket、受限会话、按可信用户隔离本地存储已完成。
- Slice 1：4 张独立表、素材/模板/用户状态/首页精选、严格校验和 API 已完成。
- Slice 2：管理员模板列表、编辑器、发布状态、封面和首页精选已完成。
- Slice 3：创作台融合布局、灵感库、详情、收藏/最近使用、应用与撤销已完成。
- 浏览器验证已覆盖桌面与 390×844 移动端、普通用户与管理员视图、未保存保护、首页排序入口、应用模板与撤销；验证使用同源 mock API，不替代 Slice 4 的真实服务联调。

## 3. 页面与交互契约

### 3.1 创作台

从上到下固定为：页签、今日灵感横向架、我的创作网格、底部创作输入区。

- 今日灵感最多展示 6 个已发布且配置了 `home_position` 的模板，顺序由 1–6 决定。
- 我的创作继续读取当前用户作用域下的 IndexedDB，不因模板 API 失败而隐藏。
- 点击灵感卡片打开详情；卡片上的唯一主动作是“使用此灵感”。
- “使用此灵感”只把提示词和允许的生成默认值写入当前输入区，不自动生成，不改变 API Key、供应商、Base URL 或模型。
- 输入区已有内容时弹出“替换 / 取消”；替换成功后提供一次撤销。
- 最近创作卡片保留现有查看、下载、收藏/复用能力；V1 不把个人作品与公共模板拆成两个产品。

### 3.2 灵感库

- 桌面端：搜索、分类、标签、收藏、最近使用筛选；固定响应式网格；“加载更多”分页。
- 移动端：搜索常驻；分类和筛选收进底部抽屉；2 列或 1 列卡片取决于可用宽度。
- 桌面详情使用右侧抽屉；移动端使用全屏详情。
- 详情展示封面、标题、摘要、分类、标签、输入要求和推荐参数；提示词可预览但主路径仍是“使用此灵感”。
- 空态区分：无模板、筛选无结果、网络失败；网络失败只影响灵感区域。

### 3.3 管理端

模板管理列表支持搜索、状态筛选、新建、编辑、预览、发布、归档、恢复。

- 新建进入单页编辑器。
- 编辑器字段：标题、摘要、分类、标签、提示词、输入模式、默认尺寸/质量/格式、封面、封面替代文本、来源说明。
- 封面可上传，或从管理员当前浏览器中选择一张已生成作品再上传为模板素材。
- 保存草稿使用 `revision` 做乐观锁；冲突时不覆盖服务端，提示刷新后重试。
- 发布原子地复制草稿文档和草稿封面到发布快照。
- 编辑已发布模板时，用户仍看到上一次发布快照，直到再次发布。
- 归档原子地清空首页位置；恢复只回到草稿，不自动公开、不自动回首页。

首页精选页支持添加、移除、上移、下移、预览、发布：

- 最多 6 个已发布模板。
- 保存整组有序模板 ID，使用 ETag / `If-Match` 防止并发覆盖。
- 不做拖拽作为唯一操作，以保证键盘与触屏可用性。

## 4. 嵌入会话安全契约

现状 `../sub2api/.claude/worktrees/image-creation-v1/frontend/src/utils/embedded-url.ts:16` 会把用户 ID 和 JWT 放进查询参数，Playground 的 `src/lib/embeddedSession.ts:91` 再从 URL 读取。这在扩大模板和管理 API 前必须替换。

### 4.1 启动票据

- 宿主在普通 JWT 路由 `POST /api/v1/image-creation/embed-tickets` 签发普通用户票据。
- 宿主在管理员鉴权路由 `POST /api/v1/admin/image-creation/embed-tickets` 签发管理员票据。
- 请求体只包含 `surface: "user" | "admin"`；服务端身份始终来自已认证上下文，不接受 `user_id`。
- 票据为 32 字节加密安全随机数的 Base64URL；Redis 只存其 SHA-256 哈希键和最小会话声明。
- TTL 60 秒，只能消费一次；Redis 不可用时返回 503，禁止降级成 URL JWT。
- iframe 和每次“新窗口打开”都单独申请新票据。
- 宿主只把 `#launch=<ticket>`、主题和语言放入目标 URL；票据不得进入 query、日志、Referer 或持久化状态。

### 4.2 受限会话

- Playground 启动时先读取并立即清理 fragment，再 `POST /api/v1/image-creation/sessions` 交换。
- 返回 2 小时 opaque session token、可信 `viewer`、允许的 API Key 列表；原始 key 和 scoped token 只保存在内存。
- Redis 仍只保存 scoped token 的 SHA-256 哈希。
- 每个图像创作 API 请求都重新校验用户存在、active、TokenVersion；管理员端额外校验当前仍是管理员。
- scoped session 只允许 `/api/v1/image-creation/*`，不能访问普通面板、管理面或其他用户 API。
- 统一使用现有响应 envelope `code/message/reason/metadata/data`，证据见 `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/pkg/response/response.go:14`。

### 4.3 本地存储隔离

- 当前 Zustand 名称由 `src/store.ts:1020` 在模块加载时确定，IndexedDB 仍硬编码为 `src/lib/db.ts:3` 的全局名称。
- 嵌入构建必须在动态加载 App/store/db 之前完成可信 viewer bootstrap。
- 存储名格式为 `gpt-image-playground-nanafox-embedded-u-<userID>`；用户 ID 只能来自票据交换响应。
- 普通构建继续使用原名称，不迁移。
- 旧的无归属嵌入数据库不自动认领、不自动删除，避免把 A 用户历史送给 B 用户。

### 4.4 状态机

```
宿主已登录
  -> POST 签发 ticket
  -> iframe/new window 以 fragment 打开
  -> Playground 清理 fragment
  -> POST exchange
     -> 成功：配置用户作用域存储 -> 动态载入应用 -> ready
     -> 票据过期/已用：auth-error，展示“返回 NanaFox 重新打开”
     -> Redis/网络失败：load-error，可重试 exchange 仅在票据尚未消费时成立
  -> scoped API 请求
     -> 用户 active + TokenVersion 匹配 + scope 匹配：继续
     -> 失效：401/403，清空内存凭证，保留本地历史只读
```

并发点：同一 ticket 的并发 exchange 只能一个成功；首页精选和草稿保存分别用 ETag/revision 乐观锁。

## 5. 数据模型

所有表和 API 均位于独立 image creation 域，不依赖 `settings` 表。

### 5.1 `image_creation_assets`

| 字段 | 类型/约束 | 作用 |
|---|---|---|
| `id` | `varchar(64)` PK | 原始二进制 SHA-256 小写 hex，天然去重 |
| `content` | `bytea not null` | V1 管理员模板封面 |
| `content_type` | `varchar(32)` check png/jpeg/webp | 响应 MIME |
| `byte_size` | `integer` check 1..8MiB | 上传硬上限 |
| `width`,`height` | `integer` check 1..8192 | 尺寸保护 |
| `source_type` | `varchar(16)` check generated/uploaded/imported | 来源类别 |
| `source_provider`,`source_model` | nullable varchar | 可选来源说明，不参与执行 |
| `created_by` | bigint FK users | 管理员 |
| `created_at` | timestamptz | 创建时间 |

V1 不删除 asset；模板封面 FK 使用 RESTRICT。列表查询绝不读取 `content`。公开内容接口为 `GET /api/v1/image-creation/assets/:id/content`，响应包含正确 Content-Type/Length、`ETag: <id>`、`Cache-Control: public, max-age=31536000, immutable` 和 `X-Content-Type-Options: nosniff`。

### 5.2 `image_creation_templates`

| 字段 | 类型/约束 | 作用 |
|---|---|---|
| `id` | bigserial PK | 模板 ID |
| `state` | varchar check draft/published/archived | 生命周期 |
| `draft_data` | jsonb not null | 当前编辑文档 |
| `published_data` | jsonb nullable | 当前对用户可见快照 |
| `revision` | integer >= 1 | 草稿乐观锁 |
| `published_version` | integer >= 0 | 用户 apply 的并发校验 |
| `draft_cover_asset_id` | nullable FK assets RESTRICT | 草稿封面 |
| `published_cover_asset_id` | nullable FK assets RESTRICT | 发布封面快照 |
| `home_position` | nullable smallint check 1..6 | 首页精选位置 |
| `created_by`,`updated_by` | bigint FK users | 管理员审计 |
| `created_at`,`updated_at`,`published_at` | timestamptz | 生命周期时间 |

约束：`home_position` 建唯一 partial index（非空）；只有已发布模板允许非空首页位置。归档时同事务清空。

`TemplateDocumentV1` 严格字段：

```json
{
  "schema_version": 1,
  "title": "string <= 120",
  "summary": "string <= 300",
  "category": "controlled-code",
  "tags": ["最多 8 个"],
  "prompt": "string <= 12000",
  "input_mode": "text|reference_optional|reference_required",
  "cover_alt": "string <= 200",
  "defaults": {
    "size": "1024x1024|1536x1024|1024x1536",
    "quality": "low|medium|high",
    "output_format": "png|jpeg|webp"
  },
  "source": {
    "name": "optional",
    "url": "optional https URL",
    "license": "optional",
    "notes": "optional"
  }
}
```

文档中禁止 model、provider、API key、Base URL、n、moderation、timeout、proxy。未知字段拒绝，不静默保存。

### 5.3 `image_creation_user_template_states`

| 字段 | 类型/约束 | 作用 |
|---|---|---|
| `user_id` | bigint FK users | 用户 |
| `template_id` | bigint FK templates | 模板 |
| `favorited_at` | nullable timestamptz | 是否收藏 |
| `last_used_at` | nullable timestamptz | 最近使用排序 |

主键/唯一键为 `(user_id, template_id)`。无 `use_count`。用户软删除流程显式清理该表。

该表使用显式 SQL repository 实现复合主键及 upsert；其余三张表使用 Ent。这里不为迎合 Ent 的单列 ID 假造业务主键。

### 5.4 `image_creation_change_logs`

| 字段 | 类型/约束 | 作用 |
|---|---|---|
| `id` | bigserial PK | 日志 ID |
| `actor_user_id` | bigint FK users | 管理员 |
| `action` | varchar | create/update/publish/archive/restore/home_update/asset_create |
| `target_type` | varchar | template/home/asset |
| `target_id` | varchar | 目标 ID |
| `metadata` | jsonb | revision/version/位置等非敏感摘要 |
| `created_at` | timestamptz | 时间 |

只记管理员动作；禁止完整 prompt、完整模板 JSON、凭证和用户上传内容。

## 6. API 契约

### 6.1 会话

| 方法 | 路径 | 权限 | 输入/输出 |
|---|---|---|---|
| POST | `/api/v1/image-creation/embed-tickets` | 普通 JWT | 输入 surface=user；输出 ticket、expires_in |
| POST | `/api/v1/admin/image-creation/embed-tickets` | 管理员 | 输入 surface=admin；输出 ticket、expires_in |
| POST | `/api/v1/image-creation/sessions` | 一次性 ticket | 输入 ticket；输出 scoped token、viewer、API Key 列表、expires_in |

### 6.2 用户与公共读取

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/v1/image-creation/templates` | `q/category/tag/favorite/recent/home/page/page_size`；只返回已发布快照 |
| GET | `/api/v1/image-creation/templates/:id` | 只返回已发布详情 |
| GET | `/api/v1/image-creation/assets/:id/content` | 公开封面二进制；ID 不存在返回 404 |
| PUT | `/api/v1/image-creation/templates/:id/favorite` | 幂等收藏 |
| DELETE | `/api/v1/image-creation/templates/:id/favorite` | 幂等取消收藏 |
| POST | `/api/v1/image-creation/templates/:id/apply` | 输入 `published_version`；校验仍为当前发布版本，更新 last_used_at，返回 prompt/defaults |

列表 DTO 不含 prompt、draft、素材二进制；详情 DTO 才含 prompt。归档、草稿或过期 published version 均不得 apply。

### 6.3 管理员

| 方法 | 路径 | 行为 |
|---|---|---|
| GET/POST | `/api/v1/admin/image-creation/templates` | 列表 / 新建草稿 |
| GET | `/api/v1/admin/image-creation/templates/:id` | 草稿与发布快照详情 |
| PUT | `/api/v1/admin/image-creation/templates/:id/draft` | `If-Match: revision` 保存，成功 revision+1 |
| POST | `/api/v1/admin/image-creation/templates/:id/publish` | 原子发布草稿和封面 |
| POST | `/api/v1/admin/image-creation/templates/:id/archive` | 归档并清首页位置 |
| POST | `/api/v1/admin/image-creation/templates/:id/restore` | archived -> draft |
| POST | `/api/v1/admin/image-creation/assets` | multipart 单图上传，校验真实格式、尺寸、大小；超 8 MiB 统一返回 413 |
| GET/PUT | `/api/v1/admin/image-creation/home-featured` | 获取 / 整组替换，ETag + If-Match |

### 6.4 错误语义

| 场景 | HTTP | reason |
|---|---:|---|
| 缺少/无效/过期 scoped session | 401 | `IMAGE_CREATION_SESSION_INVALID` |
| 普通 session 调管理 API | 403 | `IMAGE_CREATION_ADMIN_REQUIRED` |
| Redis 不可用 | 503 | `IMAGE_CREATION_SESSION_UNAVAILABLE` |
| revision/ETag/published_version 冲突 | 409 | `IMAGE_CREATION_CONFLICT` |
| 模板/素材不存在或对当前身份不可见 | 404 | `IMAGE_CREATION_NOT_FOUND` |
| DTO、图片格式、尺寸或大小无效 | 400/413 | `IMAGE_CREATION_INVALID_INPUT` / `IMAGE_CREATION_ASSET_TOO_LARGE` |

错误响应不回显 ticket、scoped token、prompt、原始 key 或 Redis 键。

## 7. 实施切片与测试门禁

### Slice 0：安全地基和计划

1. 当前文件和旧计划链接。
2. 一次性 ticket、scoped session、宿主 fragment 启动和新窗口 fresh ticket。
3. Playground 可信 bootstrap 与每用户 Zustand/IndexedDB 名称。
4. 严格 DTO/error contract 的两端类型。

门禁：RED 测试证明 URL 不再出现 JWT/user_id；ticket 只能消费一次；Redis 失败关闭；普通/管理员 scope 隔离；A/B 用户存储名不同；旧无归属库未迁移。随后普通/嵌入构建和双仓库相关测试全绿。

### Slice 1：后端领域

1. 4 张增量表、Ent schema 和 SQL migration。
2. 素材上传/读取、模板 CRUD/发布状态机、首页精选、收藏和 apply。
3. 严格文档校验、乐观锁、事务和 change log。

门禁：migration 往返/约束、repository/service/handler、权限负向、8MiB/8192 边界、BYTEA 列表不加载、并发冲突测试全绿；Sub2API 全量门禁重跑。

### Slice 2：管理员嵌入页面

实现模板管理、编辑器、封面、预览、发布/归档/恢复和首页精选；桌面、平板、移动端验证全部按钮和键盘路径。

### Slice 3：用户产品页面

实现创作台融合布局、灵感库、详情、收藏、最近使用和应用模板；模板 API 失败隔离于本地创作历史。

### Slice 4：本地完整验收

在本地 Sub2API + Playground 环境验证普通用户、管理员、切换账号、iframe、新窗口、刷新、过期/撤销、移动端、深浅色和真实生成兼容。

当前边界：真实 PostgreSQL 集成测试已保留为 `integration` 测试，但本机 Docker 不可用时会明确跳过；在可用联调环境中必须补跑，不以 mock 浏览器验证代替。

### Slice 5：发布

不在当前授权内。只有用户再次明确授权后，才编写测试环境发布记录并部署；生产继续需要独立授权和发布分支。

## L1.1 引用验证

| 符号 | 证据 | 签名 | 用途 |
|---|---|---|---|
| `buildEmbeddedUrl` | `../sub2api/.claude/worktrees/image-creation-v1/frontend/src/utils/embedded-url.ts:16` | `(baseUrl, userId?, authToken?, theme?, lang?) => string` | 替换 JWT/user_id 查询参数入口 |
| `CustomPageView.embeddedUrl` | `../sub2api/.claude/worktrees/image-creation-v1/frontend/src/views/user/CustomPageView.vue:176` | Vue computed URL | iframe 与新窗口分别申请 fresh ticket |
| `NewJWTAuthMiddleware` | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/server/middleware/jwt_auth.go:14` | JWT + active + TokenVersion | 普通 ticket 签发身份来源 |
| `validateJWTForAdmin` | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/server/middleware/admin_auth.go:156` | JWT + active + TokenVersion + admin | 管理 ticket 签发身份来源 |
| `redissession.Store.TryConsume` | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/pkg/redissession/store.go:96` | `(ctx, id) => (bool, error)` | 对照单次消费语义；新域不复用 OAuth namespace |
| `RegisterUserRoutes` | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/server/routes/user.go:12` | 注册 JWT 用户路由 | ticket 用户路由接入点 |
| `RegisterAdminRoutes` | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/server/routes/admin.go:14` | 注册管理员路由 | ticket 管理路由接入点 |
| `response.Response` | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/pkg/response/response.go:15` | code/message/reason/metadata/data | 保持 Sub2API envelope |
| `initializeEmbeddedContext` | `src/lib/embeddedSession.ts:91` | 同步解析 URL query | 改为 fragment ticket 的异步 bootstrap |
| `getDeploymentStorageName` | `src/lib/deploymentFlavor.ts:16` | `(flavor?) => string` | 增加可信用户作用域 |
| `openDB` | `src/lib/db.ts:15` | `() => Promise<IDBDatabase>` | 使用 bootstrap 后的作用域名 |
| Zustand persist | `src/store.ts:1020` | `name: getDeploymentStorageName()` | 动态 import 前配置作用域 |
| App bootstrap | `src/main.tsx:12` | 初始化后同步 render | 改为先 exchange/配置，再动态 import |

## L1.2 同类路径对照

参考实现：Sub2API `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/pkg/redissession/store.go:40`。

- [x] Redis JSON + TTL：复用同类最小模式，但使用独立 `image_creation:` namespace。
- [x] 单次消费：要求原子领取；不能用“先 Get 再 Delete”。
- [x] 用户 JWT/admin middleware：仅用于 ticket 签发，scoped session 使用独立中间件。
- [x] 响应：复用 `response` envelope，不新增第二套全局响应框架。

## L1.3 约定清单

| 约定 | 现状 | 我的选择 | 理由 |
|---|---|---|---|
| API 前缀 | `/api/v1` | `/api/v1/image-creation` | 领域隔离 |
| 数据迁移 | 顺序 SQL + Ent | 新增下一号 migration + 4 个 schema | 跟随仓库 |
| 前端宿主 | Vue custom page | 只改启动 ticket | 不复制业务 UI |
| 产品 UI | React embedded build | 在现有应用增量实现 | 保留生成与历史能力 |
| 图片存储 | 无模板素材后端 | PostgreSQL BYTEA + 稳定内容 API | V1 通用、无需先开 OSS |

## L1.4 Return 语义

| return 形态 | caller 解读 | 测试名 |
|---|---|---|
| ticket/session + nil | 可继续 bootstrap | `exchange consumes ticket once` |
| nil + not found/expired | 401，不透露是否曾存在 | `exchange rejects expired or reused ticket` |
| nil + Redis error | 503 fail closed | `ticket store failure does not fall back` |
| template + nil | 可见发布快照 | `published template detail excludes draft` |
| nil + conflict | 409，客户端保留本地编辑 | `draft update rejects stale revision` |

## L1.5 负向断言

| 输入 | 必须返回 | 测试断言 |
|---|---|---|
| URL 含旧 `token/user_id` | 不采信、不带入请求 | visible URL/请求头均无旧 JWT |
| 重复消费 ticket | 401 | 第二次 exchange 失败 |
| user scope 调 admin API | 403 | 无任何写入 |
| 未知 TemplateDocument 字段 | 400 | 不静默丢弃 |
| 超 8MiB 或伪造 MIME | 413/400 | DB 无 asset |
| stale revision/ETag/version | 409 | 原数据不变 |
| archived template apply | 404 | last_used_at 不变 |

## L1.6 回滚

| 类别 | 变更 | 回滚动作 | 顺序 |
|---|---|---|---|
| 代码 | 两仓库功能提交 | 各仓库按切片 `git revert` | 1 |
| 配置 | 无新 settings 键 | 无 | 2 |
| 数据 | 4 张增量表 | 回滚代码后保留表；确认无生产数据时才执行显式 down SQL | 3 |
| 告警 | image_creation 日志/指标 | 随代码回滚停止 | 4 |

回滚后可接受状态：原图像创作生成和按用户本地历史仍可用；灵感与管理入口隐藏；旧表数据保留但不被读取。

## L2.1 运行时假设

| 假设 | 验证路径 | 环境 | 不成立时行为 |
|---|---|---|---|
| Redis 可用于安全会话 | ticket/session 集成测试 + 健康探测 | 本地/测试 | 503 fail closed |
| PostgreSQL 可承受少量封面 BYTEA | 8MiB 边界和列表 query 检查 | 本地/测试 | 限制上传；未来只迁移 asset 内容实现 |
| 同源静态页能访问 API | iframe/standalone E2E | 本地/测试 | 显示会话错误，不泄漏凭证 |
| 用户浏览器支持 IndexedDB | 浏览器 E2E | Chromium/Safari | 明确本地存储失败，禁止跨用户 fallback |

## L2.2 兼容灰度

| 维度 | 处理 |
|---|---|
| 老调用方 | 普通构建和非图像 custom page URL 保持原逻辑；只对图像创作菜单申请 ticket |
| shape 漂移 | 双端严格 V1 DTO；schema_version 不支持则明确错误 |
| feature flag | V1 不新增全局 settings flag；菜单是否配置本身就是入口开关 |
| 新旧对比 | 普通/嵌入构建、现有生成、iframe/new-window 并行回归 |
| 回滚污染 | 新表独立保留；旧业务不读取 |

## L2.3 权限与安全

| 维度 | 回答 | 证据 |
|---|---|---|
| 身份来源 | ticket 由现有 JWT/admin middleware 签发；viewer 来自服务端 | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/server/middleware/jwt_auth.go:71` |
| 授权边界 | scoped session scope + 每请求 active/TokenVersion/admin 校验 | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/server/middleware/admin_auth.go:176` |
| 凭证泄漏面 | fragment 立即清理；Redis 只存哈希；内存持有 scoped/raw key | `src/lib/embeddedSession.ts:138` |
| SSRF | 模板 source URL 只存元数据、不由服务端抓取 | DTO 验证测试 |
| 租户隔离 | user_id 取 auth context；用户状态复合键；本地 DB 按可信用户 | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/server/middleware/auth_subject.go:12` |
| 日志脱敏 | 不记录 ticket/session/prompt/key；错误走现有脱敏路径 | `../sub2api/.claude/worktrees/image-creation-v1/backend/internal/pkg/response/response.go:89` |

## L2.4 可观测性

| 失败模式 | 日志 | 指标/告警 | 可区分状态 |
|---|---|---|---|
| ticket 签发/交换 Redis 失败 | `image_creation.session_store_unavailable` error，无 token | 5 分钟 > 3 告警 | 是 |
| ticket 过期/重复 | `image_creation.ticket_rejected` info，仅 reason | 只做计数 | 是 |
| scoped session 被撤销 | `image_creation.session_revoked` info，仅 user id/reason | 1h 异常升高告警 | 是 |
| 模板冲突 | `image_creation.template_conflict` info | 只做计数 | 是 |
| 素材拒绝 | `image_creation.asset_rejected` info，大小/类型不含内容 | 只做计数 | 是 |

## L2.5 性能与容量

| 维度 | 新开销 | 基线对比 | 上界 | 验证 |
|---|---|---|---|---|
| 请求 fan-out | bootstrap 1 次 exchange | 旧版分页取 keys | ticket 只交换一次 | 请求计数测试 |
| Body 内存 | 管理封面上传 | 原无此路径 | 8MiB + 小常数 | 超限测试 |
| DB 热路径 | 模板列表 + 用户状态 join | 独立新域 | page_size <= 48，索引覆盖 | query/EXPLAIN 检查 |
| P99 延迟 | session 每请求 Redis + user lookup | 旧 JWT 也查 user | 2 次有界依赖 | 测试环境观察 |
| 并发 | 首页/草稿写竞争 | 原无 | revision/ETag 乐观锁 | 并发测试 |

## 剩余风险登记

| 项 | 状态 | Owner | Follow-up ticket |
|---|---|---|---|
| PostgreSQL BYTEA 体积随模板增长 | 接受：V1 最多小规模精选素材，8MiB 硬限 | NanaFox backend | V2 asset storage migration trigger |
| Safari fragment/new-window 行为 | 待 Slice 4 实机验证 | NanaFox frontend | Slice 4 Safari acceptance |
| 开源提示词许可逐条核对 | 待内容导入前完成 | NanaFox product | V1 content provenance checklist |
| 用户软删除清理接点 | 待 Slice 1 随现有删除流程验证 | NanaFox backend | Slice 1 user cleanup contract |
