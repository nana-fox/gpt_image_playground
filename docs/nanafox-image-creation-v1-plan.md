# NanaFox 图像创作 V1 实施计划

状态：Slice 0–4 已按“融合版 1.1”完成纠偏、全量回归和隔离测试环境复验。用户入口与管理员入口已在路由、票据、菜单和页面职责上分离。未推送、未部署生产。

本文件是图像创作 V1 的单一实施依据。旧的嵌入适配基线仍由 `docs/nanafox-embedded-plan.md:1` 约束；模板、灵感库、用户状态、管理端、嵌入会话和服务端增量以本文件为准。

## 1. 产品边界

### 1.1 一个产品、两个明确入口

- 用户入口是 Sub2API 的“图像创作”自定义菜单：`/custom/image-creation`，固定签发 `surface=user`，展示“融合版 1.1”创作首页。即使当前登录者是管理员，从这个入口进入也只能看到用户创作页。
- 管理入口是管理员侧栏中的“模板管理”自定义菜单：`/admin/custom/image-creation-admin`，路由本身要求管理员并固定签发 `surface=admin`，展示“模板管理”和“首页精选”。
- 两个菜单项都由现有自定义菜单设置承载，使用不同 `id` 和 `visibility`，但可指向同一份 `/tools/image-playground/` 静态制品；身份由宿主路径和服务端签发接口决定，不由静态 URL 或当前账号角色猜测。
- Sub2API Vue 只负责两类宿主菜单、iframe、新窗口、签发启动票据；不复制模板管理业务页面。
- 后端权限是唯一安全边界。前端隐藏管理入口只改善体验，不代表授权。

### 1.2 V1 明确不做

- 不把模板、首页精选或素材配置放进 Sub2API `settings` 表。
- 不把用户生成历史上传到服务端；现有 IndexedDB 历史继续保留在用户浏览器。
- 不引入 OSS/S3 抽象、模板版本表、轮播配置表、标签表、收藏计数、定时发布、拖拽排序、自动轮播或模板变量引擎。
- 不从开源仓库运行时同步提示词。隔离测试环境可以导入人工筛选的案例验证流程，但必须记录原案例、原作者链接和“商业权利未核验”；生产发布前仍需逐项复核、替换或取得授权。

## 2. 当前基线

| 仓库 | 基线提交 | 本地分支 | 结果 |
|---|---|---|---|
| Playground | `aa7dde7` | `codex/image-creation-v1` | 普通/嵌入构建通过；40 个测试文件 / 558 项测试通过；工作流修复版已发布测试环境 |
| Sub2API | `387f3d30f` | `feature/image-creation-v1` 独立 worktree | Go 全量测试及前端 257 个测试文件 / 1748 项测试通过；筛选与双入口切换修复版已发布测试环境 |

Sub2API 功能工作树：`/Users/nio/project/nanafox/sub2api/.claude/worktrees/image-creation-v1`。原仓库的 `hotfix/ops-error-request-snapshots` 工作区保持不变。

当前实现检查点：

- Slice 0：一次性 fragment ticket、受限会话、按可信用户隔离本地存储已完成。
- Slice 1：4 张独立表、素材/模板/用户状态/首页精选、严格校验和 API 已完成。
- Slice 2：管理员模板列表、编辑器、发布状态、封面和首页精选已完成。
- Slice 3：创作台融合布局、灵感库、详情、收藏/最近使用、应用与撤销已完成。
- Slice 4：修正版已在 `router-test.nanafox.com` 完成双入口、双角色、权限负向、桌面和移动端复验；旧部署记录仅用于追溯。

## 3. 页面与交互契约

### 3.1 融合版 1.1 创作首页

首页不再使用“我的创作 / 探索灵感”双页签。从上到下固定为：`从灵感开始` 精选架、`最近创作` 网格、现有底部创作输入区。

- 精选架最多展示 4 个已发布且配置了 `home_position` 的模板，顺序由 `home_position` 决定；第 1 个只增加“本周精选”标识，不再占用独立的大卡槽位。
- 精选架在桌面端和移动端统一使用等高、横向滑动的 snap 卡片；卡片宽度按封面原始长宽比计算，横图更宽、竖图更窄，不裁切、不拉伸，也不强制填入固定横竖槽位。
- 精选架和灵感库的发现卡片完整显示原图，标题压在图片底部渐变层内；详情页仍遵守管理员配置的 `cover_fit`，以兼容既有模板的预览意图。
- “探索全部灵感”在当前产品内打开全屏工作区覆盖层；关闭后原首页、历史筛选和输入内容保持不变，不跳转到另一个顶级产品页面。
- 最近创作放在独立的轻量内容容器中，继续读取当前用户作用域下的 IndexedDB，并完整复用已有搜索、状态筛选、查看、下载、收藏和复用能力；模板 API 失败不能隐藏本地历史。
- 点击灵感卡片打开详情；卡片上的唯一主动作是“使用此灵感”。
- “使用此灵感”只把提示词和允许的生成默认值写入当前输入区，不自动生成，不改变 API Key、供应商、Base URL 或模型。
- 输入区已有内容时弹出“替换 / 取消”；替换成功后提供一次撤销。
- V1 不把个人作品与公共模板拆成两个顶级页面。

### 3.2 灵感库

- 桌面端：搜索、分类、标签、收藏、最近使用筛选；使用等宽列、图片高度按原始长宽比变化的瀑布流；“加载更多”分页。卡片标题压在底部渐变上，预览和“使用”动作在 hover / focus 时出现，不额外增加白色文字底座。
- 移动端：搜索常驻；分类和筛选收进底部抽屉；小于 460px 为 1 列，达到 460px 为 2 列；每列仍保持等宽和原图比例，触屏不依赖 hover，标题常驻且主动作可聚焦、可点击。
- 桌面详情使用右侧抽屉；移动端使用全屏详情。
- 详情展示封面、标题、摘要、分类、标签、输入要求和推荐参数；提示词可预览但主路径仍是“使用此灵感”。
- 空态区分：无模板、筛选无结果、网络失败；网络失败只影响灵感区域。

### 3.3 管理端

模板管理列表支持搜索、状态筛选、新建、编辑、预览、发布、归档、恢复。

- 新建进入单页编辑器。
- 编辑器字段：标题、摘要、分类、标签、提示词、输入模式、默认尺寸/质量/格式、封面、封面展示方式、封面替代文本、来源说明。
- 封面可上传，或从管理员当前浏览器中选择一张已生成作品再上传为模板素材。
- 保存草稿使用 `revision` 做乐观锁；冲突时不覆盖服务端，提示刷新后重试。
- 发布原子地复制草稿文档和草稿封面到发布快照。
- 编辑已发布模板时，用户仍看到上一次发布快照，直到再次发布。
- 归档原子地清空首页位置；恢复只回到草稿，不自动公开、不自动回首页。

首页精选页支持添加、移除、上移、下移、预览、发布：

- 最多 4 个已发布模板，与用户首页的 4 个有序横滑卡片对应；前端禁用第 5 个，服务端同时拒绝超过 4 个的请求。
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
  "cover_fit": "cover|contain",
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

实现独立管理员入口 `/admin/custom/image-creation-admin`、模板管理、编辑器、封面、预览、发布/归档/恢复和首页精选；桌面、平板、移动端验证全部按钮和键盘路径。普通 `/custom/image-creation` 入口不得因登录者是管理员而切换成管理视图。

### Slice 3：用户产品页面

实现“融合版 1.1”首页、覆盖层灵感库、详情、收藏、最近使用和应用模板；模板 API 失败隔离于本地创作历史。

### Slice 4：测试环境完整验收

在隔离的 Sub2API 测试环境验证普通用户、管理员、iframe、新窗口、一次性票据、权限负向、移动端和真实生成兼容。验收结果见“测试环境部署与验收记录”。

### Slice 5：发布

测试环境重新发布和验收已完成。生产发布不在当前授权内，必须重新制定生产门禁、数据迁移备份和回滚窗口，并由用户单独授权。

## L1.1 引用验证

| 符号 | 证据 | 签名 | 用途 |
|---|---|---|---|
| `buildEmbeddedUrl` | `../sub2api/.claude/worktrees/image-creation-v1/frontend/src/utils/embedded-url.ts:16` | `(baseUrl, userId?, authToken?, theme?, lang?) => string` | 替换 JWT/user_id 查询参数入口 |
| `CustomPageView.surface` | `../sub2api/.claude/worktrees/image-creation-v1/frontend/src/views/user/CustomPageView.vue:165` | `user \| admin` route prop | iframe 与新窗口都按入口 surface 申请 fresh ticket，不读取 `isAdmin` 猜页面 |
| `CustomPage` / `AdminCustomPage` | `../sub2api/.claude/worktrees/image-creation-v1/frontend/src/router/index.ts:426` | `/custom/:id` / `/admin/custom/:id` | 普通入口与管理员入口在路由层分离，后者要求管理员 |
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
| 前端宿主 | Vue custom page | 复用同一宿主组件，但用两条 route 和两个菜单项固定 surface | 不复制业务 UI，也不让账号角色改变入口语义 |
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
| 老调用方 | 普通构建和非图像 custom page URL 保持原逻辑；`/custom/:id` 保持用户语义，新增 `/admin/custom/:id` 只承载管理员可见菜单 |
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

## 8. 测试环境部署与验收记录（2026-08-23）

本节 8.1–8.5 是旧制品的历史记录；因 8.6 所列入口与产品结构缺陷，不能作为当前修正版通过的证据。

### 8.1 发布边界

| 项目 | 测试环境结果 | 生产边界 |
|---|---|---|
| Sub2API | 从本地 `bc3e85482` 以 `git archive` 传入独立构建目录，镜像 `sub2api:test-image-creation-v1-bc3e85482`，容器 `sub2api-test` 健康 | 生产容器、镜像和配置未修改 |
| Playground | `20e8a95` 的 embedded 制品发布到 `releases/20e8a95`；完整树 SHA-256 为 `dda4760cf8200360d1dc763a76e672b52f97059fcb44da7f0870330875417788` | `prod-current` 继续指向 `releases/70aa5a5` |
| 服务端 Git | `/data/service/sub2api` 保持 `main`、`b56d0a7a`、工作区干净 | 未切分支、未提交、未推送 |
| NAS | 不再承担 V1 验收；旧临时入口无监听，测试数据保留 | 无依赖 |

测试菜单只使用已有 `custom_menu_items` 作为宿主导航，测试值为 `图像创作` → 测试静态地址。模板、首页精选、素材和用户状态仍只在 4 张独立 `image_creation_*` 表中，不复用 settings 作为产品数据。

### 8.2 隔离证明

| 检查 | 结果 |
|---|---|
| PostgreSQL | 测试库 `sub2api_test` 有 4 张 `image_creation_*` 表；生产库 `sub2api` 为 0 张 |
| Redis | 测试使用 DB 1；生产使用 DB 0 |
| 容器 | `sub2api-test` 与 `sub2api-prod` 均为 healthy；生产容器未重建 |
| 静态指针 | 测试 `current` → `releases/20e8a95`；生产 `prod-current` → `releases/70aa5a5` |
| 公网探测 | 测试 health/playground 为 200、旧 `/tools/image-studio/` 为 410；生产 health/playground 保持 200 |
| 日志 | 测试容器自本次启动后的 fatal/panic/migration fail/error 匹配数为 0 |

### 8.3 验收证据

| 流程 | 当前运行结果 |
|---|---|
| 会话安全 | ticket 二次交换 401；普通 scoped session 调管理员 API 403；普通 JWT 直接调 scoped API 401；新窗口最终 URL 无 query/fragment |
| 普通用户 API | 首页模板、详情、素材、收藏/取消收藏、apply、最近使用全部通过；素材响应有 immutable cache 和 `nosniff` |
| 管理员 API | 真实 PostgreSQL 中完成封面上传、模板创建、发布和首页精选整组保存 |
| 普通用户浏览器 | 菜单、iframe、灵感详情、应用模板、撤销、新窗口均通过 |
| 管理员浏览器 | 模板管理、预览、编辑器关闭、未保存保护、首页精选、新窗口均通过；宿主工具栏不再拦截编辑器按钮 |
| 多端 | 桌面和 390×844 移动端的宿主与 iframe 均无横向溢出 |
| 真实生成 | 合成测试用户绑定测试 `gpt-pro` 分组后，`gpt-image-2` 返回 HTTP 200、1 张 PNG，耗时 23.3 秒，约 1.38 MB |

验收只使用两名 `example.test` 合成账号。合成管理员的合规确认、合成用户的一日测试订阅和模板数据仅写入测试数据库，不使用真实用户凭证。

本轮联调发现并在部署前修复 3 个边界问题：DTO JSON 字段序列化、素材超限错误码一致性、图像创作宿主按钮与 iframe 内容重叠。对应 Sub2API 提交为 `8c9fe1cd9`、`8a82c104f`、`bc3e85482`。

### 8.4 测试环境回滚

1. 将测试 `custom_menu_items` 恢复为发布前的空数组，先关闭入口。
2. 将测试静态 `current` 原子切回 `releases/70aa5a5`。
3. 停止并保留当前测试容器，将 `sub2api-test-rollback-b56d0a7a` 恢复为 `sub2api-test`。
4. 保留 4 张增量表，不执行 destructive down migration；旧代码不会读取它们。
5. 回滚不包含任何生产操作。

### 8.5 嵌入布局回归修复（2026-08-23）

管理员页在宽屏下同时出现 Sub2API 页头、独立“新窗口打开”工具栏和 Playground 内页头，造成纵向层级重复、控件位置松散；问题不是内容横向溢出，也不是 Sub2API 侧栏重复渲染。

修复保持宿主与 Playground 的职责边界：

- Sub2API 将“新窗口打开”复用到现有页头标题旁，图像创作页不再生成独立工具栏；普通自定义页面继续使用原有悬浮按钮，不受本次改动影响。
- Playground 在管理员 iframe 中隐藏重复页头；普通用户 iframe 仍展示 API Key 状态，独立窗口仍展示完整标题、API Key 状态和操作指南。
- 管理列表仅收紧为 `max-w-6xl` 并缩小顶部留白，没有引入动态高度同步、额外滚动容器或新的布局依赖。

| 项目 | 提交 / 制品 | 验证结果 |
|---|---|---|
| Playground | `22f7266`；测试 `current` → `releases/22f7266` | normal build、embedded build、37 个测试文件 / 543 项测试通过 |
| Sub2API | `a30628595`（页头插槽与回归测试）、`8a5d1f880`（Docker 前端构建堆上限 2048MiB） | 前端 build、256 个测试文件 / 1744 项测试通过；测试容器 healthy |
| 管理员界面 | 1830×1155、390×844 | 页头只保留一个新窗口入口；列表、筛选、操作按钮无重叠或横向溢出 |
| 普通用户界面 | 1440×900、390×844 | API Key 状态、灵感卡片、创作输入区和新窗口入口无重叠 |
| 独立窗口 | 管理员、普通用户 | 一次性票据交换后 URL 清理为 `/tools/image-playground/`；页面职责完整 |
| 隔离复查 | 测试库 4 张 `image_creation_*` 表；生产库 0 张 | `sub2api-test` 与 `sub2api-prod` 均 healthy；生产 `prod-current` 仍指向 `releases/70aa5a5` |

本次测试环境回滚点为 Playground `releases/20e8a95` 和停止保留的容器 `sub2api-test-rollback-bc3e85482`。两个仓库均未推送，生产未部署。

### 8.6 入口与产品结构纠偏（2026-08-23）

旧实现错误地用 `authStore.isAdmin` 决定图像创作 ticket：管理员从普通 `/custom/image-creation` 入口进入时被切换到模板管理页。旧计划又把“融合版 1.1”误写成双页签结构，导致实现与已选定页面方向不一致。两项均属于验收结论错误，不作为后续依据。

本轮根因修复：

- Sub2API：普通 `/custom/:id` 固定 `surface=user`；新增受管理员路由守卫保护的 `/admin/custom/:id` 并固定 `surface=admin`；侧栏按菜单 `visibility` 分别生成两类路径；iframe 和新窗口使用相同 surface。
- 菜单设置：测试环境需要两个导航项。用户项 `image-creation` / “图像创作” / `visibility=user`；管理项 `image-creation-admin` / “模板管理” / `visibility=admin`。两项均可指向同一静态制品，产品数据仍只存在 `image_creation_*` 表。
- Playground：用户首页恢复“从灵感开始 → 最近创作 → 底部创作输入区”；“探索全部灵感”改为覆盖层工作区；管理员页面仍由 admin surface 单独加载。

修正版按以下最低验收矩阵重新验证：

| 登录身份 | 入口 | 必须看到 | 必须看不到 |
|---|---|---|---|
| 普通用户 | `/custom/image-creation` | 融合版创作首页 | 模板管理、首页精选 |
| 管理员 | `/custom/image-creation` | 与普通用户相同的融合版创作首页 | 模板管理、首页精选 |
| 管理员 | `/admin/custom/image-creation-admin` | 模板管理、首页精选 | 用户最近创作首页 |
| 普通用户 | 直接访问 `/admin/custom/image-creation-admin` | 管理员路由拒绝或重定向 | admin ticket、管理 API 数据 |

以上四项分别覆盖 iframe 和新窗口；当前测试环境均通过。

### 8.7 纠偏版测试环境发布与复验（2026-08-23）

| 项目 | 当前测试环境 | 回滚点 |
|---|---|---|
| Playground | `current` → `releases/6fbe8aa` | `releases/2bbd09a` |
| Sub2API | `sub2api:test-image-creation-v1-8b17bf4f4`，容器 healthy | 停止保留的 `sub2api-test-rollback-766e738ba` |
| 生产隔离 | `sub2api-prod` 仍为原生产镜像且 healthy；`prod-current` 仍指向 `releases/70aa5a5` | 无生产操作 |

纠偏后的实现与验收结论：

- 路由职责：`/custom/image-creation` 固定用户 surface；`/admin/custom/image-creation-admin` 由管理员路由守卫保护并固定 admin surface。管理员从普通入口进入时仍只看到融合版创作首页。
- 菜单职责：管理员侧栏同时出现管理区“模板管理”和个人区“图像创作”；普通用户只出现“图像创作”。设置中用两个独立菜单项表达这两个入口，不再依赖登录角色推断页面职责。
- 用户页面：与选定参考同一结构，固定为“从灵感开始 → 最近创作 → 创作输入区”；灵感库为当前页面覆盖层；应用模板直接写入当前输入区并支持撤销。
- 管理页面：只包含模板列表、编辑器和首页精选；首页精选最多 4 个，顺序就是用户首页展示顺序。
- 权限负向：普通用户请求 admin ticket 返回 403；user scoped session 请求管理 API 返回 403；错误 surface 返回 400；ticket 重放返回 401。
- 多端：桌面与 390×844 移动端完成实际页面检查；宿主导航、精选卡片、历史区、灵感覆盖层和底部输入区无横向溢出或控件重叠。
- 公网与日志：测试 health 和 `/tools/image-playground/` 为 200，旧 `/tools/image-studio/` 为 410；新测试容器启动后未发现 fatal、panic、migration fail 或 error 日志。

该轮验收时测试库只有 1 个已配置首页位置的模板；该数据边界已被 8.8 的测试素材导入取代。个人历史仍按当前用户浏览器的 IndexedDB 数据自然展示。

### 8.8 图片优先视觉版与测试素材导入（2026-08-23）

| 项目 | 当前测试环境 | 回滚点 |
|---|---|---|
| Playground | `current` → `releases/c242a4c`；静态树 SHA-256 `b6c509960d98e6816a66d50ad741b68ddd8635fda5dc1d4ec15012fe7c1a5efa` | `releases/6fbe8aa` |
| Sub2API | `sub2api:test-image-creation-v1-64b6ffd6b`，容器 healthy | 停止保留的 `sub2api-test-rollback-8b17bf4f4` |
| 生产隔离 | `sub2api-prod` 仍为原生产镜像且 healthy；`prod-current` 仍指向 `releases/70aa5a5` | 无生产操作 |

本轮新增 `cover_fit` 文档字段并保持 JSONB 增量兼容：旧模板缺省按 `cover` 展示；管理员可以明确选择“裁切填满”或“完整显示”。用户首页改为桌面 1+3、移动横向滑动；全部灵感统一 4:5 图片卡、底部渐变标题和 hover / focus 操作层。

隔离测试库通过正式管理 API 导入 `awesome-gpt-image-2` / `gpt-image2.canghe.ai` 中人工筛选的 12 个案例，覆盖信息图、商品、电商、摄影、插画、海报和城市地图。导入后测试库有 25 个模板，其中 24 个已发布、4 个首页精选；原有模板未删除。首页顺序为：高端肉类海鲜品牌英雄图、景德镇青花瓷全景解说图谱、曼哈顿公园水彩旅行插画、体积激光黑场海报。

每个导入模板均保存案例页、原始来源、来源标签和“测试素材，商业权利未核验”说明。仓库 MIT 许可不能推导出第三方案例图片和提示词可商用，因此这些素材只用于测试环境视觉与流程验收，不进入生产发布清单。

API 实测：普通用户 scoped session 返回 4 个首页模板和 24 个已发布模板；封面 `cover` / `contain` 顺序正确；详情来源、素材 immutable cache、模板 apply 全部通过。公网 `/tools/image-playground/` 为 200，旧 `/tools/image-studio/` 为 410。生产数据库仍没有 `image_creation_templates` 表。

### 8.9 比例自适应视觉调整与测试发布（2026-08-23）

| 项目 | 当前测试环境 | 回滚点 |
|---|---|---|
| Playground | `current` → `releases/5fb735c`；静态树 SHA-256 `8cb50a7819ffe73649cedfbe48c43a862e8bf1cc5c1ac8242cf88c40b1fdd96c` | `releases/c242a4c` |
| Sub2API | `sub2api:test-image-creation-v1-64b6ffd6b`，容器 healthy，本轮未重启或修改 | 保持当前测试容器 |
| 生产隔离 | `sub2api-prod` healthy；`prod-current` 仍指向 `releases/70aa5a5` | 无生产操作 |

- 精选区由固定“1 主 + 3 次”槽位改为统一等高横滑；每张卡片读取封面原始尺寸后按比例确定宽度，避免竖图被放大裁切、横图被压窄。
- 全部灵感改为响应式等宽瀑布流，卡片高度跟随原图比例；底部渐变标题、hover / focus 操作层、详情和应用流程保持不变。
- 最近创作只增加轻量内容容器，继续复用现有 `TaskGrid`、IndexedDB 和全部作品操作，不引入第二套历史组件。
- 本轮只修改 Playground 用户 UI、布局契约测试和本文档；未修改 API、数据库、管理端、Sub2API 或部署配置。
- 发布检查点 `5fb735c`：全量 39 个测试文件 551/551、普通构建和 NanaFox embedded 构建均通过。embedded 制品共 63 个文件，归档 SHA-256 为 `c332e037109fa8562ed00f1b99ab98ad73886b29033afaf32700e4a027bd19fd`，服务器解包后的文件清单与本地逐项一致。
- 公网复验：测试首页、health、JS 和 CSS 资源均为 200；旧 `/tools/image-studio/` 为 410；测试容器最近 15 分钟未发现 fatal、panic、migration fail 或 error。生产首页与 health 均为 200，生产指针和容器未变化。
- 已登录 Chrome 测试页保持可见，但自动视觉控制连续中断。为避免读取或复制登录凭证，本轮不绕过登录态；桌面、移动端、深色模式和“全部灵感”的最终视觉确认保留为测试环境人工验收项，未把自动化中断误记为视觉通过。

### 8.10 百条素材、容量回归与发布审计（2026-08-23）

本轮只向逻辑独立的测试库补充数据并更新 Playground 静态制品；生产数据库、生产静态指针和 Sub2API 源码均未修改。测试库与生产库当前仍共享同一个 PostgreSQL 实例，因此数据隔离成立，连接与资源隔离不成立。

| 项目 | 结果 |
|---|---|
| 模板规模 | 100 个已发布、1 个已归档、4 个首页精选；101 个素材，共 55,914,202 bytes |
| 新增来源 | 从 `VigoZhao/AI-Visual-Prompt-Cookbook` 人工配额筛选 76 个案例，经正式管理 API 完成素材上传、草稿创建和发布；没有直接写数据库 |
| 数据备份 | 导入前备份 `/srv/nanafox/image-playground/backups/test-image-creation-pre-100-20260823T122307Z.sql.gz` |
| 数据完整性 | 100 个已发布文档均有标题与提示词；用户 API 为 5 页（24/24/24/24/4），ID 无重复 |
| 静态制品 | 测试 `current` → `releases/c0eee02`；63 个文件，内容树 SHA-256 `977c9eea72f8a4817b22fc23cf30607843c2237e0251f70b8499726d8963bd1a`；生产 `prod-current` 仍为 `releases/70aa5a5` |
| 前端门禁 | 40 个测试文件、553/553；普通构建和 embedded 构建通过；管理员 101 个列表项完整渲染，无失败素材请求和横向溢出 |
| 后端门禁 | `go test ./...` 通过；此前前端 lint、typecheck、build 和 257 个测试文件 / 1747 项测试均通过 |
| 实机页面 | 管理员 1440×1000 显示 101 条；用户 390×844 深色首页、同宽度全部灵感均无横向溢出；票据交换后 query/fragment 清空，用户页看不到管理功能 |

百条容量回归发现并修复了一个前端边界：管理端原先固定只请求第一页 100 条，测试库达到 101 条后会静默遗漏最后一条。修复在共享 API 层聚合全部管理分页，同时覆盖“模板管理”和“首页精选”；对应 TDD 提交为 `27e2bba`（RED）和 `62c2b12`（GREEN）。当前规模下管理页会请求 2 个列表页；达到 500 条前不增加虚拟列表或新的批量接口。

视觉复验同时发现宿主主题与 Tailwind 策略不一致：票据 URL 的 `theme=dark` 已添加 `dark` class，但 Tailwind 原先只监听操作系统媒体查询，宿主和系统主题不同时会显示错误。`c6e4bac` 先固化失败契约，`c0eee02` 将暗色策略改为 selector；显式宿主主题优先，普通版和未显式指定主题的嵌入版继续监听系统主题变化。使用“系统浅色 + 宿主深色”实测得到深色背景和白色标题，390×844 无横向溢出。

容量回归还发现现有服务器的数据库连接预算不成立：测试和生产配置都没有显式连接池值，应用默认 `max_open_conns=256` / `max_idle_conns=128`，而共享 PostgreSQL 的 `max_connections=100`。管理员并发加载百张封面时，测试池占满连接并使生产支付订单后台任务出现一次 `too many clients` 警告。已立即完成以下测试侧止血：

- 仅在 `/etc/sub2api/test.yaml` 设置 `max_open_conns=10`、`max_idle_conns=2`、`conn_max_idle_time_minutes=1`，备份为 `/etc/sub2api/test.yaml.before-image-creation-pool-20260823-2118`；只重启测试容器。
- 重放 101 条管理页面后，测试库保持 2 个空闲连接、生产库保持 5 个空闲连接，两个容器健康且未再出现连接不足。
- 未修改生产配置。生产发布前必须按 PostgreSQL 总上限为生产、测试和其他客户端分配连接预算；不能依赖应用默认值。更稳妥的长期方案是把测试库迁移到独立 PostgreSQL 实例，避免测试负载再次影响生产。

本轮依赖审计结果不能写成“全绿”：运行时依赖 DOMPurify / Mermaid 有中危公告；完整开发依赖另有 Vite、Wrangler 链等高危公告。嵌入式图像创作不开放 Agent/Mermaid 输入，降低了当前表面的可达性，但生产前仍应以独立升级提交处理 `npm audit fix --dry-run` 所列更新并重跑双构建、全量测试和浏览器安全回归，不能在当前功能分支上直接宽泛升级。

发布结论分为两层：代码和隔离测试环境可继续验收；生产发布暂时 No-Go。解除生产阻断至少需要：完成 76 个测试素材的逐项权利复核或替换为自有生成封面、轮换本轮审计中意外暴露的支付密钥、明确生产数据库连接池预算，并处理运行时依赖公告。PostgreSQL BYTEA 在当前约 53.3 MiB 规模下不是阻断项。

### 8.11 工作流回归修复与测试环境复验（2026-08-24）

本轮针对产品方现场发现的筛选、比例、增量加载、文案、精选配置和双入口切换问题做根因修复。未推送、未部署生产、未修改生产数据库或生产配置。

| 项目 | 测试环境结果 | 回滚点 |
|---|---|---|
| Playground | `current` → `releases/aa7dde7`；筛选友好错误、自然比例、20 条增量页组、灵感画廊文案、管理员 20 条分页与精选顺序交互已生效 | `releases/c0eee02` |
| Sub2API | 容器 `sub2api-test` 使用 `sub2api:test-image-creation-v1-387f3d30f` 并保持 healthy；镜像二进制为 `0.1.179 / 387f3d30f` | 停止保留的 `sub2api-test-rollback-776592c90-20260824` |
| 生产隔离 | `sub2api-prod` 仍使用 `sub2api:prod` 且 healthy；`prod-current` 仍为 `releases/70aa5a5` | 无生产变更 |

实现与验证证据：

- 分类与标签筛选改为 PostgreSQL `sqljson.ValueContains`，文本搜索保持不区分大小写；实机选择“人像”得到空态而非 `internal error`，选择“产品”得到 18 条，搜索小写 `hud` 能命中大写标题。
- 全部灵感首次展示 20 条；连续加载后保留原卡片并增量成为 3 个 page group、60/99 条。每页保持独立列布局，避免旧卡片重排和整页闪烁。
- 卡片与详情封面使用图片自然比例。实机样本从原始 `900×1600` 渲染为约 `298×529.8`，宽高比一致，不再横向压缩。
- 管理端模板列表每页 20 条；当前精选最多 4 个，提供上移、下移、移除；候选区提供直接“加入精选”，满 4 个时禁用加入。
- 双入口路由复用同一 Vue 组件时，不能只依赖静态 route prop。现在由当前 route name 解析 surface，并把它加入 iframe 会话刷新依赖。实机从 `/custom/image-creation` 切到 `/admin/custom/image-creation-admin` 再切回时，宿主标题、`src_url`、ticket scope 和 iframe 内容均同步切换。
- 390×844 实测宿主与 iframe 的 `scrollWidth` 分别等于各自 `clientWidth`，无横向溢出；宿主深色模式切换后 iframe fragment 为 `theme=dark`，宿主和 iframe 根节点均进入 dark。
- Playground 40 个测试文件 / 558 项、普通构建和 embedded 构建通过；Sub2API 前端 257 个测试文件 / 1748 项、生产构建通过。既有 Go 全量测试与 PostgreSQL 集成门禁在本轮后端筛选修复上通过。
- 测试机仅清理可再生成的 Docker builder cache；没有删除数据库、运行容器、镜像或静态回滚版本。清理后根分区约 85%，保留约 6.8 GiB。

浏览器验收曾捕获一次“路由已切、iframe 仍是上一个 surface”的漏网问题；对应补充提交 `387f3d30f` 在测试先失败后修复，并完成重新部署与双向切换复验。因此 `776592c90` 不作为最终候选，当前候选固定为 Playground `aa7dde7` + Sub2API `387f3d30f`。

### 8.12 灵感布局与嵌入指引修复（2026-08-24）

本轮只更新 Playground 测试静态制品，没有修改或重启 Sub2API，也没有变更测试或生产数据库。

| 项目 | 测试环境结果 | 回滚点 |
|---|---|---|
| Playground | `current` → `releases/70fea87`；灵感画廊按封面实际比例追加到当前最短列，首页灵感区改为开放式分区 | `releases/4b3d2c9` |
| Sub2API | `sub2api-test` 继续使用 `sub2api:test-image-creation-v1-ecba95ba3` 且 healthy | 本轮未变更 |
| 生产隔离 | `sub2api-prod` 继续使用 `sub2api:prod` 且 healthy；`prod-current` 仍为 `releases/70aa5a5` | 无生产变更 |

实现与验证证据：

- 旧画廊按索引轮询分列，无法感知长图和短图。本轮以卡片宽度相同为前提，用 `1 / aspectRatio` 估算高度并执行最短列贪心分配；增量项只接到当前最短列，已加载前缀的分配保持稳定。
- 首页模型栏与“从灵感开始”之间增加明确留白和说明层级，移除紧贴工具栏的外层大卡片边框，并隐藏精选横滑区的高干扰滚动条。
- 多个有效生图 Key 且没有历史选择时自动选中第一项；历史选择仍优先恢复。无有效 Key 时，顶栏、帮助指南和生成按钮均引导到 Sub2API 的 `/user/keys`，不再误开 Playground 设置。
- 嵌入版操作指南替换为“API Key → 灵感模板 → 生成作品”的产品流程；移动端不再隐藏帮助入口；原项目 GitHub 与批量任务指南只保留在非嵌入版本。
- TDD 红测提交为 `d88b5a0`，修复提交为 `70fea87`。Playground 42 个测试文件 / 565 项、普通构建和 embedded 构建通过；测试根路由和静态路由均返回 200。
- 测试静态制品中的 `App-BTokzZ9V.js` 已确认包含新首页、自动选 Key、无 Key 引导文案。当前登录态 Chrome 的 CDP 调试会话失效，因此本轮没有把桌面、移动端和深色模式的最终视觉冒充自动验收通过，保留为产品方刷新后的人工验收项。

## 剩余风险登记

| 项 | 状态 | Owner | Follow-up ticket |
|---|---|---|---|
| PostgreSQL BYTEA 体积随模板增长 | 接受：V1 最多小规模精选素材，8MiB 硬限 | NanaFox backend | V2 asset storage migration trigger |
| PostgreSQL 连接池与实例隔离 | 测试已限制为 10/2；生产仍使用不适配 100 连接上限的默认值，且测试/生产共享实例，阻止生产发布 | NanaFox ops | Production database connection budget |
| 前端运行时依赖公告 | DOMPurify / Mermaid 中危；当前图像 surface 可达性低，仍需升级回归 | NanaFox frontend | Dependency security refresh |
| 支付密钥轮换 | 审计读取时发生一次意外暴露；不得继续沿用到生产发布 | NanaFox ops | Payment credential rotation |
| Safari fragment/new-window 行为 | Chromium 真实测试已通过；Safari 的 V1 模板流仍待实机回归 | NanaFox frontend | Production Safari acceptance |
| 开源提示词许可逐条核对 | 测试数据已记录来源并标记“商业权利未核验”；生产前仍须逐项完成 | NanaFox product | V1 content provenance checklist |
| 用户软删除清理接点 | 待 Slice 1 随现有删除流程验证 | NanaFox backend | Slice 1 user cleanup contract |
