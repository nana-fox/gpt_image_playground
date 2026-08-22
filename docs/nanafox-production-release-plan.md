# NanaFox 图像创作 ToC 生产发布方案

> 状态：方案已完成，尚未执行生产写操作。
>
> 目标：将 `图像创作` 发布到 `router.nanafox.com` 并对普通用户可见。
>
> 边界：不部署或重启 Sub2API，不修改数据库结构，不触碰 ToB `fx.nanafox.com`，不复用测试环境的可变发布指针。

## 结论

采用四段式发布：**暗部署静态路由 → 管理员金丝雀 → 普通用户切换 → 旧路由 410**。

生产复用测试环境已经完整验收的不可变制品 `70aa5a5`，但新建独立的 `prod-current` 原子符号链接。生产菜单原有条目 `d42550bf17f68c5d` 原地更新，避免新增重复入口，并依次使用 `admin`、`user` 两种 visibility 作为现有平台原生灰度开关。

不采用以下方案：

- 不把 Playground 合并进 Sub2API 前端或容器；这会扩大回归和部署范围。
- 不让生产路由指向测试 `current`；测试回滚不能改变生产版本。
- 不先切菜单再建路由；普通用户不能看到尚未就绪的页面。
- 不增加百分比灰度系统；现有 admin/user 可见性足以完成首次发布。
- 不恢复旧 Image Studio 作为长期回滚目标；它当前并未在生产提供独立静态应用，回滚目标应是隐藏图像菜单并保持正常 Sub2API。

## 当前生产事实（2026-08-22，只读核验）

| 项目 | 当前事实 | 发布含义 |
|---|---|---|
| Sub2API | `router.nanafox.com` 与 `/health` 均为 200，版本 `0.1.179` | 发布期间必须保持不变 |
| 容器 | `sub2api-prod` 正常运行，启动时间已记录 | Caddy reload 和菜单更新不得重启容器 |
| 新路径 | `/tools/image-playground/` 当前返回 Sub2API SPA，不是 Playground | 必须先增加专用静态路由 |
| 旧菜单 | `AI 图像生成`，普通用户可见，指向 `/tools/image-studio/` | 原地替换为 `图像创作` |
| 静态制品 | `/srv/nanafox/image-playground/releases/70aa5a5` 已存在 | 可原样晋级，不重复上传 |
| 制品完整性 | 本地 embedded `dist` 与服务器 `70aa5a5` 全文件 SHA-256 一致 | 生产只切独立指针 |
| 生产账号 | 图像分组内有两个正常的 OpenAI Pro 账号 | 可进入金丝雀，但 entitlement 仍需真实生成确认 |
| Git 可恢复性 | `70aa5a5` 尚不在 `origin` 远端分支或标签中 | 推送/tag 是生产前硬门禁，当前不执行 |
| Caddy 模板 | 服务器已有测试路由，仓库模板尚未记录 | 上线时必须同步最小 ops-only 模板补丁，防止后续覆盖 |

## 发布对象

| 对象 | 目标值 |
|---|---|
| Surface | ToC production only |
| Domain | `router.nanafox.com` |
| Artifact commit | `70aa5a5aa6f69853f9d2514b131469b50dd4236b` |
| Artifact directory | `/srv/nanafox/image-playground/releases/70aa5a5` |
| Production pointer | `/srv/nanafox/image-playground/prod-current` |
| Route | `/tools/image-playground/` |
| Retired route | `/tools/image-studio/` → 410 |
| Menu item ID | `d42550bf17f68c5d`（原地更新） |
| Menu label | `图像创作` |
| Menu URL | `https://router.nanafox.com/tools/image-playground/` |
| Final visibility | `user` |
| Icon | 测试环境已验收的 Sparkles SVG |

## 发布前硬门禁 G0

以下全部通过后才能执行生产写操作：

1. 用户单独明确授权“执行 ToC 生产发布”；本方案本身不等于执行授权。
2. 将实现分支推送到 `origin`，并在 `70aa5a5` 创建可恢复的 NanaFox embedded release tag；不得推送到 upstream。
3. 在干净 worktree 运行：
   - `npm ci`
   - `npm run build`
   - `npm run build:embedded`
   - `npm test`
4. embedded 构建的完整 SHA-256 manifest 必须与服务器 `releases/70aa5a5` 相同；不同则禁止复用该目录。
5. 测试站必须继续满足：beta 200、health 200、旧路由 410、真实 iframe 可用。
6. 导出生产完整 `custom_menu_items` 为不含认证 token 的时间戳备份；备份应保留原图标 SVG。
7. 备份生产 Caddyfile，验证备份可读；只报告文件路径，不输出敏感配置。
8. 记录发布前 `sub2api-prod` 容器启动时间、生产健康状态和测试 `current` 指向。
9. 准备 Sub2API `deploy/Caddyfile.server` 的最小 ops-only 补丁，只同步 test/prod Playground 路由；不修改 Sub2API 前后端代码，不运行 `deploy-server.sh`。

任一门禁失败立即停止，不进入下一阶段。

## 阶段 P1：暗部署生产静态路由

1. 创建 `/srv/nanafox/image-playground/prod-current`，原子指向 `releases/70aa5a5`。
2. 在 `router.nanafox.com` 的 Caddy site block 中、`reverse_proxy` 之前增加：

```caddyfile
handle_path /tools/image-playground/* {
	header {
		Cache-Control "no-store"
		Content-Security-Policy "default-src 'self'; base-uri 'self'; connect-src 'self' data: blob:; font-src 'self' data:; form-action 'self'; frame-ancestors 'self'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'"
		Referrer-Policy "no-referrer"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
	}
	root * /srv/nanafox/image-playground/prod-current
	try_files {path} /index.html
	file_server
}
```

3. 先运行 `caddy validate`；只有验证通过才 reload。禁止 restart Caddy 和 Sub2API。
4. 菜单暂不修改，普通用户仍看不到新入口。

P1 验证：

- 新路径返回 200，HTML 标题/资源指纹属于 GPT Image Playground，而不是 Sub2API SPA。
- CSP、Referrer-Policy、X-Frame-Options 与测试环境一致。
- JS/CSS 资源返回 200，URL 基础路径保持 `/tools/image-playground/`。
- 生产根路径、登录、API Key 页面、`/health` 继续正常。
- `sub2api-prod` 启动时间不变。
- 测试 `current` 仍指向 `70aa5a5`，且与 `prod-current` 相互独立。

## 阶段 P2：管理员金丝雀

1. 通过现有管理设置 API 原地更新菜单项 `d42550bf17f68c5d`：
   - label → `图像创作`
   - URL → 生产 Playground URL
   - icon → 已验收 Sparkles SVG
   - visibility → `admin`
   - sort order → 保持 `0`
2. 不新建第二个长期菜单项，不直接改数据库。
3. 使用生产管理员从真实菜单进入 iframe。
4. 验证 iframe URL 查询凭据被清除、Key 正确加载、新窗口布局和 390×844 布局无溢出。
5. 执行一次最小 `gpt-image-2` 文生图金丝雀；这是生产账号 entitlement 的最终证明。禁止双发或自动重试。
6. 下载并确认输出有效；不需要在生产重复参考图和蒙版全矩阵，精确制品已在测试完成该验证。

P2 停止条件：

- 有效会话调用 `/api/v1/keys` 返回 401/403；
- 唯一或已选择 Key 未正常进入 ready；
- `gpt-image-2` 返回 entitlement/调度错误；
- 查询 token 未清除，或 Playground 持久化数据出现 JWT/raw key；
- 生产普通页面或 API 出现新增 5xx。

## 阶段 P3：切换普通用户

1. P2 全绿后，仅将同一菜单项 visibility 从 `admin` 改为 `user`。
2. `/api/v1/settings/public` 必须只出现一个图像菜单项，内容为：
   - ID 仍是 `d42550bf17f68c5d`
   - label 为 `图像创作`
   - URL 为生产 Playground URL
   - visibility 为 `user`
3. 使用受控普通用户账号完成“看到菜单 → 打开 iframe → Key 状态正确 → 输入提示词后可提交”的验收。
4. 不修改真实客户的 Key 来模拟零/单 Key；这部分状态机已由测试环境的隔离账号和自动化覆盖。
5. 若没有受控普通用户账号，不能宣称普通用户验收完成；保持 admin 可见并等待产品 owner 验收，不临时污染生产客户数据。

## 阶段 P4：下线旧路由

P3 通过后再增加：

```caddyfile
@retired_image_studio path /tools/image-studio /tools/image-studio/*
respond @retired_image_studio "Image Studio retired" 410
```

运行 `caddy validate` 后 reload，并验证：

- `/tools/image-studio/` 返回 410；
- 新菜单仍只指向 `/tools/image-playground/`；
- 新路径和 Sub2API health 仍为 200；
- 不存在任何到旧路径的生产菜单链接。

## 阶段 P5：发布后观察

主动观察 30 分钟，随后保留 24 小时回滚窗口：

- Caddy 中 `/tools/image-playground/` 的 4xx/5xx；
- Sub2API 既有 usage/error 记录中的 Images generation/edit 失败；
- `/api/v1/keys` 的 401/403 与空 Key 状态分开判断；
- 生产 root、health、登录、API Key 管理页面；
- `sub2api-prod` 启动时间；
- 测试与生产静态指针是否仍隔离。

不新增前端遥测，不记录 prompt、JWT、raw key、Authorization header 或图片 data URL。

## L1.1 引用验证

| 符号/约定 | 证据 | 当前签名/行为 | 方案用途 |
|---|---|---|---|
| `build:embedded` | `gpt_image_playground/package.json:10` | `tsc -b && vite build --mode nanafox-embedded` | 生产制品构建命令 |
| embedded base | `gpt_image_playground/vite.config.ts:74` | `base: getDeploymentBase(...)` | 保证资源路径位于 `/tools/image-playground/` |
| `initializeEmbeddedContext` | `gpt_image_playground/src/lib/embeddedSession.ts:91` | 解析并清理嵌入上下文 | 验证生产查询凭据清理 |
| `loadEmbeddedKeys` | `gpt_image_playground/src/lib/embeddedSession.ts:185` | 分页加载当前用户 Keys | 普通用户 Key 状态验收 |
| `resolveEmbeddedApiProfile` | `gpt_image_playground/src/lib/embeddedSession.ts:291` | 将内存 Key 解析为临时 profile | 防止原始 Key 持久化 |
| `assertEmbeddedImageRequest` | `gpt_image_playground/src/lib/embeddedPolicy.ts:4` | 限制 provider/model/mode/n | 生产生成安全边界 |
| `assertEmbeddedImageEndpoint` | `gpt_image_playground/src/lib/embeddedPolicy.ts:18` | 仅允许同源 generation/edit | 生产网络边界 |
| `buildEmbeddedUrl` | `sub2api/frontend/src/utils/embedded-url.ts:16` | 注入用户、token、主题、语言和来源 | Sub2API host 与 iframe 契约 |
| custom iframe | `sub2api/frontend/src/views/user/CustomPageView.vue:107` | `:src="embeddedUrl"` | 真实宿主验收路径 |
| user menu filter | `sub2api/frontend/src/components/layout/AppSidebar.vue:703` | 只显示 `visibility === 'user'` | admin → user 灰度开关 |
| settings update | `sub2api/frontend/src/api/admin/settings.ts:893` | `PUT /admin/settings` partial update | 原地更新菜单，不改数据库 |
| public menu filter | `sub2api/backend/internal/handler/setting_handler.go:73` | 公开设置只返回 user-visible items | 普通用户发布断言 |
| production Caddy site | `sub2api/deploy/Caddyfile.server:85` | `router.nanafox.com` site block | 最小 ops-only 路由补丁落点 |

## L1.2 同类路径对照

参考实现：测试环境当前已验证的 Caddy route 与发布目录。

- [x] 独立 `handle_path` 在 `reverse_proxy` 之前截获 Playground 路径。
- [x] `try_files {path} /index.html` 支持前端路由回退。
- [x] CSP 仅允许同源 API 与本地 `data:`/`blob:` 图片转换。
- [x] `Cache-Control: no-store` 避免凭据化首请求和旧 HTML 被缓存。
- [x] `X-Frame-Options: SAMEORIGIN` 与 Sub2API 同源 iframe 一致。
- [x] 静态 release 目录不可变，仅通过符号链接晋级/回滚。
- [x] 生产新增独立 `prod-current`；decision：测试 `current` 不能成为生产指针。
- [x] 旧路由 410 延后到普通用户验收后；decision：避免先制造切换窗口。

## L1.3 约定清单

| 约定 | 当前状态 | 生产选择 | 理由 |
|---|---|---|---|
| 源码所有权 | Playground 独立 fork | 保持独立 | 降低 Sub2API 合并冲突 |
| 发布单位 | commit-named 静态目录 | `70aa5a5` | 与测试证据一一对应 |
| 生产指针 | 尚不存在 | `prod-current` | 与测试回滚隔离 |
| 菜单身份 | 生产已有旧 user item | 原地改同一 ID | 无重复入口，回滚清晰 |
| 灰度 | visibility 支持 admin/user | admin 金丝雀后切 user | 复用原生能力，不新增功能开关 |
| Sub2API 应用 | 生产 `main` 正常运行 | 不部署、不重启 | 本发布不含应用代码 |
| ToB | 独立业务面 | 不触碰 | 图像菜单是 ToC 产品能力 |
| 旧工具 | 产品已决定下线 | 最终 410 | 形成明确稳定语义 |

## L1.4 Return 语义

| 返回/状态 | 发布方解读 | 验证 |
|---|---|---|
| 新 route 200 + Playground marker | 静态路由成功 | HTML/asset smoke |
| 新 route 200 + NanaFox Router marker | 路由未生效 | 停止，不切菜单 |
| Key list 200 + 0 eligible | 合法无 Key 用户 | 显示创建 Key 引导，不生成 |
| Key list 200 + 1 eligible | 合法单 Key 用户 | 自动选择 |
| Key list 200 + multiple | 合法多 Key 用户 | 明确选择后生成 |
| Key list 401/403 | iframe 会话错误 | 停止发布，不当作无 Key |
| generation 401/403 | 选中 Key 无效 | 停止金丝雀并检查账号/Key |
| Caddy validate 非 0 | 配置不可发布 | 禁止 reload |
| settings update 非 2xx | 菜单未切换 | 保留当前阶段并回滚配置 |
| 旧 route 410 | 旧工具正式下线 | P4 验收通过 |

## L1.5 负向断言

| 危险状态 | 必须发生 | 断言 |
|---|---|---|
| `prod-current` 指向测试 `current` | 阻止发布 | 两个链接最终目标独立读取 |
| `70aa5a5` 无远端 ref/tag | 阻止生产执行 | `git ls-remote origin` 可定位 release ref |
| artifact manifest 不一致 | 阻止晋级 | 全文件 SHA-256 diff 为空 |
| 新 route 仍返回 Sub2API SPA | 不切菜单 | HTML marker 检查失败 |
| Caddy 配置无效 | 不 reload | `caddy validate` 非 0 |
| 多 Key 被静默选第一个 | 不允许生成 | 生成按钮保持不可提交 |
| URL 清理后仍含 token | 立即回滚曝光 | iframe `location.search` 为空 |
| Playground storage 含 JWT/raw key | 立即回滚曝光 | Local/Session/IndexedDB sentinel scan 为空 |
| 普通用户出现两个图像入口 | 回滚菜单配置 | public settings 匹配项数量等于 1 |
| P4 后旧 route 非 410 | 下线未完成 | HTTP status 必须为 410 |
| Sub2API 容器启动时间变化 | 发布越界 | StartedAt 与基线完全一致 |
| ToB 状态变化 | 发布越界 | 不执行任何 ToB 命令或配置更新 |

## L1.6 回滚

| 类别 | 变更 | 回滚动作 | 顺序 |
|---|---|---|---|
| 用户曝光 | 菜单 visibility=user | 先改回 admin；若 route 存在安全问题则直接移除图像项 | 1 |
| 菜单配置 | label/url/icon 更新 | 从完整时间戳备份恢复，或保持隐藏 | 2 |
| 静态版本 | `prod-current` 指向新 release | 有前一生产 release 时原子切回；首次发布则保持菜单隐藏 | 3 |
| Caddy | 新 route 与旧 route 410 | 恢复上线前 Caddy 备份，validate 后 reload | 4 |
| 模板 | ops-only Caddy 模板补丁 | revert 对应配置 commit | 5 |
| 静态文件 | immutable release 保留 | 不在事故过程中删除，回滚窗口后再归档 | 6 |
| 数据 | 仅设置项，无 schema migration | 不执行 SQL；生成历史按兼容数据保留 | 7 |
| Sub2API | 无应用部署 | 无容器回滚 | 8 |

回滚后可接受状态：普通用户不再看到图像入口，正常 Sub2API root/API/登录/Key 管理保持可用；测试站不受影响；生产容器未重启。旧 Image Studio 不作为必须恢复的能力。

## L2.1 运行时假设

| 假设 | 验证路径 | 环境 | 不成立时 |
|---|---|---|---|
| 两个正常 OpenAI Pro 账号至少一个支持 `gpt-image-2` | P2 单次真实生成 | ToC prod | 停在 admin 可见，修复账号能力后重试 |
| 同一 immutable artifact 在生产与测试行为一致 | manifest + admin iframe smoke | test/prod | 不切 user visibility |
| Caddy route 优先于 reverse proxy | route marker + asset 200 | prod | 恢复配置并调整 directive 顺序 |
| public settings 更新能驱动普通用户菜单 | API + 普通用户浏览器 | prod | 恢复 admin visibility |
| Cloudflare 不保留旧 SPA | response headers/body marker | prod edge | 精确 purge 新路径后复验，不扩大缓存规则 |
| 原子 symlink 切换不会影响在途静态请求 | release 目录永久保留 | prod | 保留旧 release，不删除在途资源 |

## L2.2 发布状态机

```text
Planned
  → G0 all green
  → DarkRoute(prod-current + Caddy route, menu unchanged)
      failure → restore Caddy, stay Planned
  → AdminCanary(menu item visibility=admin)
      failure → hide/remove item, optionally restore Caddy
  → UserVisible(same item visibility=user)
      failure → visibility=admin immediately
  → OldRouteRetired(/tools/image-studio/* = 410)
      failure → restore Caddy backup without changing new menu
  → Observing(30m active + 24h rollback window)
  → Released
```

并发点：菜单设置读取可能被已打开页面缓存。验收必须使用全新普通用户页面，并以 `/api/v1/settings/public` 为最终配置证据；不通过强制刷新已有客户会话来制造一致性。

## L2.6 权限与安全

| 维度 | 回答 | 证据/门禁 |
|---|---|---|
| 身份来源 | Sub2API 登录 JWT | iframe URL 由现有 host builder 生成 |
| 授权边界 | JWT 只列 Key；选中 raw key 只调用 Images endpoints | embedded session/policy tests + 生产 network inspection |
| 凭证泄漏面 | 首请求日志可能含 JWT；页面立即清理，禁止持久化和 referrer | no-referrer + storage scan；继承风险不扩大 |
| SSRF | 仅同源 `/v1/images/generations`、`/v1/images/edits` | endpoint policy 门禁 |
| 租户隔离 | 只信任 JWT，不信任 query user_id | 真实普通用户 Key 数量与账号一致 |
| 日志脱敏 | 不记录 prompt、token、key、auth header、data URL | 发布检查只记录状态码与安全 request ID |
| 越权降级 | 无免认证 fallback | 401/403 进入 session error，不生成 |

## L2-ops.1 可观测性

| 失败模式 | 现有信号 | 告警/停止规则 | 可区分状态 |
|---|---|---|---|
| 静态 route 未命中 | Caddy status + HTML marker | 首次命中即停止 | 与成功 200 Playground 区分 |
| 静态资源缺失 | Caddy 404 | 任一核心 JS/CSS 404 即停止 | 与空画廊区分 |
| iframe session 失败 | `/api/v1/keys` 401/403 + UI 文案 | 金丝雀即停止 | 与合法 0 Key 区分 |
| 账号无模型能力 | generation error/request ID | 首次 entitlement 错误即停止 | 与 key session 错误区分 |
| 普通页面回归 | root/health/page smoke | 任一新增 5xx 即回滚曝光 | 与 Playground 局部失败区分 |
| 客户端凭据泄漏 | URL/storage scan | 任一命中立即回滚 | 与初始 access-log 继承风险区分 |

## L2-ops.2 兼容灰度

| 维度 | 问题 | 处理 |
|---|---|---|
| 老调用方 | 正常 Sub2API 是否变化 | 不部署应用；root/API/登录硬门禁 |
| 上游 shape | Key/Images API 是否漂移 | 用生产真实金丝雀验证，不放宽解析 |
| feature flag | 是否需要新开关 | 不需要；现有 admin/user visibility 即发布开关 |
| 新旧对比 | 是否双发请求 | 禁止双发；精确制品在测试验证，生产仅一次金丝雀 |
| 回滚污染 | 已生成图片/任务元数据 | 保留兼容数据；不保存上传原图、mask 或凭据 |

## L3 Review gate

发布前 reviewer 必须抽查至少五项：artifact ref、manifest、Caddy route 顺序、完整菜单备份、回滚顺序。任何高严重度问题未关闭，均不得从 admin visibility 切到 user visibility。

通过定义：

1. L1/L2/L2-ops 表完整，引用 validator 通过；
2. G0 全绿并有当次证据；
3. P2 真实生产生成通过；
4. P3 受控普通用户验收通过；
5. P4 旧路由 410；
6. 30 分钟主动观察无新增高严重度错误；
7. 回滚备份和上一指针在 24 小时窗口内保留。

## 剩余风险登记

| 项 | 状态 | Owner | Follow-up |
|---|---|---|---|
| `70aa5a5` 尚无 origin ref/tag | 已关闭 | Fork maintainer | `nanafox-embedded-2026.08.22` 指向 `70aa5a5` |
| 生产账号 entitlement 尚未真实证明 | 已关闭 | Sub2API account owner | P2 单次 `gpt-image-2` 金丝雀成功 |
| Caddy live/template 已有漂移 | 已关闭 | ToC ops owner | live 已 reload；ops-only 模板分支独立提交 |
| 首请求 access log 可含 JWT | 已知继承风险 | Sub2API owner | 后续设计 scoped one-time embed token |
| 无百分比灰度 | 接受 | Product owner | 首次发布用 admin → user；有真实分批需求再引入 flag |
| 普通用户受控验收账号未指定 | 已关闭 | Product owner | Safari 现有普通用户完成入口、iframe、Key 与提交就绪验收 |

## 2026-08-22 执行记录

| 阶段 | 状态 | 当次证据 |
|---|---|---|
| G0 | 通过 | normal/embedded build 通过；Vitest 35 files、538 tests 通过；服务器 release manifest 与 embedded 构建一致 |
| P1 | 通过 | 生产 Playground HTML/JS 200，安全响应头齐全；root/health/login/keys 与测试站正常；`sub2api-prod` StartedAt 未变化 |
| P2 | 通过 | 菜单仅管理员可见；生产单次生成 1254×1254 PNG 并下载成功；iframe、390×844、独立窗口与凭据持久化检查通过 |
| P3 | 通过 | 同一菜单切为 `visibility=user`；公开设置仅一个图像入口；Safari 普通用户看到入口、打开 iframe、加载 9 把 Key、选择既有 `image` Key，输入文案后提交按钮就绪；未再次生成，验收后清空文案 |
| P4 | 通过 | 生产 `/tools/image-studio` 与子路径均为 410；新路径和核心页面为 200；Caddy reload 后 `sub2api-prod` StartedAt 未变化 |
| Observe | 通过 | 10:57～11:30 主动观察；最终直连连续 15 轮均为 health 200、新路径 200、旧路径 410、菜单唯一；代理链路 000 误报经 `--noproxy`、服务端本机和 Caddy 日志交叉验证排除；Playground 5xx 为 0 |

当前生产回滚点：完整发布前 `/etc/caddy/Caddyfile.before-image-playground-prod-20260822-022853`，P4 前 `/etc/caddy/Caddyfile.before-image-studio-retire-20260822-025553`；菜单备份：`/srv/nanafox/image-playground/backups/nanafox-production-menu-before-image-playground-20260822-022853.json`。
