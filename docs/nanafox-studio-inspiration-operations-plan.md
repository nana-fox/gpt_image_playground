# NanaFox Studio 灵感运营计划

> 状态：2026-08-28 实施基线。灵感数据和运营接口归 Studio；Router/Sub2API 不增加接口、不修改模板表。

## 首发范围

- 前台从 PostgreSQL 读取已上架灵感，不再把五条内容写死在 React。
- 运营端可新增、编辑、上下架、设置首页推荐和排序；每次写入使用版本号并进入管理员审计日志。
- 首发封面从九张已随 Studio 发布的受控图片中选择，不接受外部 URL、不上传文件。真实运营需要自定义封面时，再增加独立的图片上传和 R2 `inspirations/` 前缀。
- 不做硬删除；下架即可保留历史配置和审计证据。

## L1.1 引用验证

| 符号 | 证据 (file:line) | 签名 | 用途 |
|-----|-----------------|-----|-----|
| `createStudioAdminApp` | `studio-server/adminApp.mjs:7` | `(options = {}) -> adminApp` | 增加管理员灵感列表和写接口 |
| `createStudioApp` | `studio-server/server.mjs:91` | `(options) -> studioApp` | 将 `/api/inspirations` 路由到独立应用 |
| `createStudioRuntime` | `studio-server/server.mjs:214` | `(config) -> runtime` | 组装同一 PostgreSQL Store，不引入新服务 |
| `StudioAdminPage` | `src/studio/StudioAdminPage.tsx:63` | `({ admin, onExit }) -> JSX` | 增加灵感运营任务页和编辑对话框 |
| `CreatePage` | `src/studio/StudioApp.tsx:310` | `(...) -> JSX` | 首页只展示运营设为推荐的灵感 |
| `InspirationPage` | `src/studio/StudioApp.tsx:369` | `(...) -> JSX` | 展示全部已上架灵感 |

## 数据与状态

`studio_inspirations` 保存：`id/category/title/description/prompt/image_asset/enabled/featured/sort_order/version/created_at/updated_at`。migration 007 把当前九条真实 Demo 内容作为首批数据写入，避免切换后空页；首页沿用前五条推荐。

```text
运营新增 -> 默认未上架 -> 编辑并预览 -> 上架
                                      -> 首页推荐（仍要求已上架才会在首页出现）
运营下架 -> 前台下一次读取立即隐藏，数据库和审计保留
```

## API 与权限

| 接口 | 权限 | 语义 |
|-----|-----|-----|
| `GET /api/inspirations` | Studio Session | 只返回已上架内容，按排序读取 |
| `GET /api/admin/inspirations` | Router 当前 admin | 返回全部配置和版本 |
| `POST /api/admin/inspirations` | admin + Origin + CSRF | 新增未上架或已上架灵感 |
| `PATCH /api/admin/inspirations/:id` | admin + Origin + CSRF | 乐观版本更新，冲突返回 409 |

前台响应不包含管理员审计字段；运营写入不接受未知字段。封面只允许当前随 Studio 发布的九张灵感/作品示例图，避免路径穿越和第三方追踪。

## 负向断言

- 未登录前台请求为 401；非管理员运营请求为 403。
- Origin、CSRF、JSON Content-Type 任一不符合时不写数据库。
- 标题、说明、提示词、分类、排序、版本和封面超界时返回 400。
- 旧版本保存返回 409，不覆盖其他运营人员的修改。
- 下架内容不出现在前台；`featured=true` 但 `enabled=false` 也不出现在首页。

## 回滚

- migration 007 只新增表和种子数据；上一镜像会忽略该表。
- 回滚代码后前端会恢复内置五条内容；运营期间新增或修改的数据保留，不删除。
- Router/Sub2API、用户、额度、支付、生成任务和 R2 对象均不在本次回滚范围。

## 2026-08-28 测试部署证据

- RED commits：`45ba4d7`、`f948e62`；GREEN commit：`0e19078`；运行镜像：`nanafox-studio:test-0e19078-path`。
- normal/studio 构建和前端 601 项测试通过；Studio 服务端本地 111 项零失败，测试服务器真实 PostgreSQL/R2 为 111/111 且无跳过，行覆盖率 92.24%。
- migration 007 暗部署后版本为 `1..7`；原有 2 个用户、1 个生成任务、0 个加额和 0 个支付订单保持不变，新增 9 条灵感，其中 9 条上架、5 条首页推荐。
- 切换前 PostgreSQL dump 位于 `/home/nio/backups/nanafox-studio-test/pre-inspirations-20260828T055846Z/`，大小 34,504 bytes，`pg_restore -l` 有 84 行，SHA-256 为 `d8898c9dca827563ed0b3d0c46010e3ca62923dd916004990ba7f7906ba3c649`。
- 公网页面、静态资源、健康和就绪接口为 200；未登录 Session、灵感、运营、作品和最近删除接口为 401。上一镜像保留为停止容器 `nanafox-studio-test-rollback-8b025ff-20260828`。
- 同一构建制品通过隔离 Playwright mock 数据完成桌面灵感库、编辑弹窗和 390×844 移动布局自审；无横向溢出、无浏览器错误。该结果只证明 UI，不替代公网真实管理员 Session 的写操作验收。
- Router/Sub2API 代码、配置和容器未修改或重启；test/prod Router health 为 200，Sub2API test/prod、PostgreSQL 和 Redis 保持 healthy。

## 剩余风险登记

| 项 | 状态 | Follow-up |
|----|------|-----------|
| 自定义封面上传 | 首发不做，受控封面库可完成内容与排序运营 | 有真实换图需求时增加私有 R2 上传、裁切和尺寸校验 |
| 收藏持久化 | 当前仍是页面内状态 | 有明确复访数据需求时建立用户收藏表 |
