# Nanafox Embedded Image Playground

> Status: test and ToC production are deployed from the immutable `70aa5a5` artifact; `nanafox-embedded-2026.08.22` points to that commit. Upstream baseline is `47f83ffdd836aa7d1e644b88e02fe4331be4beea`.
>
> Scope boundary: this repository owns the forked frontend. The implementation did not change Sub2API frontend/backend code, backend contracts, database schema, or business data. The separately authorized release changed only the existing custom-menu configuration and isolated Caddy routes/headers.
>
> Production record: `图像创作` is visible to ordinary ToC users according to [the completed production release plan](./nanafox-production-release-plan.md); ToB remains outside this release.

## Handoff summary

- Repository: `nana-fox/gpt_image_playground`
- Local checkout: `/Users/nio/project/nanafox/gpt_image_playground`
- Fork baseline branch: `main`
- Production implementation branch: `codex/embedded-adapter`
- Production release tag: `nanafox-embedded-2026.08.22` → `70aa5a5`
- `origin`: Nanafox fork
- `upstream`: `CookSleep/gpt_image_playground`; push is disabled locally
- Test and production route: `/tools/image-playground/`
- Retired route: `/tools/image-studio/` returns 410 on test and production
- First-release model/provider: OpenAI Images API with `gpt-image-2` only
- Backend contract: iframe JWT may call only `/api/v1/keys`; the selected Sub2API API key may call only same-origin image generation/edit endpoints
- Current test release: `/srv/nanafox/image-playground/releases/70aa5a5`; rollback release: `d5e0591`
- Current production pointer: `/srv/nanafox/image-playground/prod-current` → `releases/70aa5a5`
- Sub2API ops template branch: `codex/image-playground-caddy-routes`; integrate `04b822cc5` and `45710b613` before a future Caddy template sync

The implementation must preserve upstream source history and keep Nanafox-specific changes at narrow seams. It must not copy this repository into `sub2api-tools`, add a submodule, or convert either repository into a monorepo.

## 2026-08-22 implementation review

Verdict: keep the original architecture. The compile-time embedded flavor, in-memory credentials, same-origin endpoint allowlist, ephemeral inputs, independent static route, and atomic release directory all matched the plan. Do not move the feature into Sub2API or add a parent/iframe messaging protocol for the beta.

| Area | Original direction | Current evidence | Adjustment |
|---|---|---|---|
| Credential boundary | JWT and raw keys remain in memory | Unit/integration tests pass; the real iframe scrubs its query and generated successfully | Keep unchanged. Never persist JWT to make refresh transparent. |
| Host layout | Not specified | `getDeploymentSurface` distinguishes iframe and new-tab layouts; desktop and 390×844 real-browser checks pass | Keep the host button in Sub2API and reserve an embedded-only safe area. |
| New-tab refresh | Generic "refresh behavior" acceptance | `70aa5a5` preserves generated history, withholds credentials, and exposes a validated return-to-menu action | Keep this explicit safe downgrade; do not add silent session recovery. |
| Menu identity | Custom menu already exists | Test and production render `图像创作` with the approved Sparkles SVG; production reuses the existing menu item ID | Keep this as Sub2API configuration; no source-code change. |
| Deployment | Independent static artifact | `70aa5a5` is live behind independent test `current` and production `prod-current` pointers | Continue commit-named releases and atomic pointer swaps; never point production at test `current`. |
| Live acceptance | Full Slice 4 plus production gates | Test acceptance, production canary, ordinary-user acceptance, old-route retirement, and observation pass | Treat the first release as complete and use the production plan as the release/rollback record. |

### Maintenance order

1. Before a future Sub2API release synchronizes `deploy/Caddyfile.server`, integrate the isolated Playground route commits and validate the resulting Caddy configuration.
2. For every upstream Playground update, merge a tagged upstream release in an isolated worktree and rerun normal build, embedded build, the full test suite, security-negative gates, and real test-site iframe acceptance.
3. Deploy each accepted Playground update as a new commit-named immutable release, verify test first, then atomically advance the independent production pointer and repeat production smoke checks.

## Original beta outcome and non-goals

The following sections preserve the test-beta scope and acceptance history that preceded the completed production promotion.

### Outcome

Deliver a test-site-only embedded beta that:

1. loads the current user's eligible Sub2API keys;
2. keeps JWTs and raw API keys in memory only;
3. lets the user select a key without persisting the secret;
4. generates or edits images through the same-origin Sub2API Images API;
5. persists generated outputs but never uploaded originals or masks;
6. exposes only the approved `gpt-image-2` image workflow; and
7. can be rolled back atomically by switching the beta `current` symlink to the previous commit-named release.

### Non-goals

- No Sub2API backend or schema changes.
- No prompt/template backend in this beta.
- No Gemini, Antigravity, DALL-E, older OpenAI image models, fal.ai, custom providers, Agent mode, web search, Codex CLI mode, config URL import, config ZIP export, or PWA behavior.
- No automatic upstream synchronization.
- No production deployment or custom-menu switch without separate approval.

## Planned implementation seams

New code should remain small and follow the existing project style:

- `src/lib/embeddedSession.ts`: parse iframe context, scrub query credentials, page through `/api/v1/keys`, hold raw keys in module memory, select by non-secret key ID, and resolve an ephemeral request profile.
- `src/lib/embeddedPolicy.ts`: one build-flavor capability policy for provider, model, mode, endpoints, persistence, import/export, and Service Worker decisions.
- `src/lib/imageRetention.ts`: distinguish ephemeral upload/mask data from persistent generated output without changing IndexedDB schema in the beta.
- Focused tests beside each new module; store integration tests remain in `src/store.test.ts` or a focused existing test file when that is clearer.

Do not create a framework-like adapter hierarchy. Extract a helper only when it is shared by more than one request or persistence path, or when it is the security boundary under test.

## Delivery slices and gates

### Slice 0 — reproducible fork baseline

1. Run `npm ci`, `npm run build`, and `npm test` on the pinned commit.
2. Classify the current `presetProfileFields` test mismatch. If the implementation is intentional, update only the stale expectation; otherwise fix the regression. Do not begin Nanafox behavior changes with an unexplained failing baseline.
3. Record the clean baseline command output in the implementation task.

Gate: build passes, all tests pass, worktree contains only the explicit baseline correction if one is required.

### Slice 1 — embedded bootstrap and credential boundary

1. Add `VITE_DEPLOYMENT_FLAVOR=nanafox-embedded` and build `/tools/image-playground/` without changing the normal upstream build.
2. Parse `token`, `theme`, `lang`, `ui_mode`, `user_id`, `src_host`, and `src_url` once at bootstrap.
3. Immediately remove credential-bearing query parameters with `history.replaceState`; document that this cannot remove the first request from server access logs.
4. Fetch all pages from same-origin `/api/v1/keys`, using the JWT only on that endpoint.
5. Keep raw keys in module memory. Persist only `selectedKeyId`.
6. Resolve the selected raw key into an ephemeral OpenAI Images profile before profile validation and before every request path.

Gate: unit tests cover zero, one, multiple, deleted, disabled, expired-session, and paginated-key states; storage inspection finds no JWT or raw key.

### Slice 2 — request capability policy

1. Embedded mode permits provider `openai`, mode `images`, model `gpt-image-2`, and `n=1` only.
2. Permit only same-origin `/v1/images/generations` and `/v1/images/edits` requests.
3. Reject unsupported provider/model/mode at the store/request boundary even if old persisted settings or DevTools inject them.
4. Disable Agent, fal.ai, custom provider, Responses, Codex CLI, config import/export, support prompt, and PWA entry points.
5. Ensure disabled features are not statically imported into the embedded entry when practical; run a production-bundle negative scan for forbidden endpoint and provider markers.

Gate: dangerous state injection fails before `fetch`; the approved generation/edit contract still passes.

### Slice 3 — input retention policy

1. Uploaded references and masks receive stable in-memory IDs but are not written to IndexedDB.
2. The current page session can submit and finish an edit using the in-memory data.
3. Generated outputs, thumbnails, and non-credential task metadata may remain persistent.
4. After reload, a history item whose reference inputs are gone displays an explicit unavailable state.
5. Reference-dependent retry and reuse are disabled after reload; pure text-to-image retry remains available.
6. Export cannot include uploaded originals, masks, JWTs, raw keys, bearer headers, or credential-bearing settings.

Gate: IndexedDB and export tests distinguish upload/mask from generated output; reload/retry behavior is explicit and tested.

### Slice 4 — beta integration and acceptance

1. Build an independent artifact for `/tools/image-playground/`.
2. Deploy only to the test site after separate authorization.
3. Add `Referrer-Policy: no-referrer` and a restrictive CSP compatible with same-origin API calls plus local `data:`/`blob:` image conversion.
4. Test inside the real Sub2API custom-menu iframe with zero, one, and multiple eligible keys.
5. Verify generation, reference editing, mask editing, streaming where supported, downloads, and key/session failures. Reloading the outer custom page must restore a fresh session; reloading a standalone new tab must preserve history, withhold generation, and offer a same-origin return-to-menu action without persisting the JWT.
6. Verify `/tools/image-studio/` returns 410 on the test site, while the normal Sub2API surface and production routes remain unchanged.

Gate: product acceptance on the test site plus a demonstrated atomic release rollback. Production remains out of scope.

### Later — templates and saved prompts

After the beta is stable, add a versioned static curated template catalog in this frontend. Treat cross-device user prompt storage as a separate Sub2API backend proposal because it expands the iframe JWT contract beyond `/api/v1/keys`.

## L1.1 Reference verification

| Symbol | Evidence | Current signature | Plan use |
|---|---|---|---|
| `ApiProfile` | `src/types.ts:71` | `interface ApiProfile` with `apiKey`, provider, base URL, model, mode, and runtime flags | The persistent upstream profile currently carries credentials; embedded resolution must remain ephemeral. |
| `AppSettings` | `src/types.ts:93` | `interface AppSettings` with legacy `apiKey` and `profiles` | Persistence/export cleaning must cover both legacy and profile fields. |
| `TaskRecord` | `src/types.ts:174` | `interface TaskRecord` containing non-secret profile metadata and image IDs | Tasks may store a non-secret selected key ID if required, never the raw key. |
| `getActiveApiProfile` | `src/lib/apiProfiles.ts:785` | `(settings: Partial<AppSettings> \| unknown) => ApiProfile` | Existing active-profile resolution is the input to embedded runtime resolution. |
| `validateApiProfile` | `src/lib/apiProfiles.ts:807` | `(profile: ApiProfile) => string \| null` | Validate the resolved ephemeral profile; do not weaken validation globally. |
| `callImageApi` | `src/lib/api.ts:9` | `(opts: CallApiOptions) => Promise<CallApiResult>` | Final dispatch remains a defense-in-depth capability guard, not the only credential injection point. |
| `createPersistedState` | `src/lib/persistedState.ts:90` | `(state: PersistedStateSource, includeLegacyAgentConversations?: boolean) => PersistedAppState` | Strip credential fields and reference-image drafts in embedded mode. |
| `URL_SETTING_KEYS` | `src/lib/urlSettings.ts:15` | URL setting key list currently includes `apiKey` | Embedded bootstrap must reject/remove credential/config imports instead of merging them. |
| `buildExportZip` | `src/lib/exportZip.ts:53` | `(params: BuildExportZipParams) => Promise` | Embedded export policy must prevent settings credentials and reference originals from entering archives. |
| `storeImage` | `src/lib/db.ts:261` | `(dataUrl: string, source?: StoredImage['source']) => Promise<string>` | Generated-output persistence remains; upload/mask paths bypass it in embedded mode. |
| `getTaskApiProfile` | `src/store.ts:1184` | `(settings: AppSettings, task: TaskRecord) => ApiProfile \| null` | Retry/execution must resolve current runtime credentials from non-secret task identity. |
| `createSettingsForApiProfile` | `src/store.ts:1190` | `(settings: AppSettings, profile: ApiProfile) => AppSettings` | Never write the resolved raw key back into persistent settings. |
| `submitTask` | `src/store.ts:1638` | `(options?: SubmitOptions) => Promise<void>` | Runtime credential resolution must occur before the current validation at `src/store.ts:1668`. |
| `executeTask` | `src/store.ts:3509` | `(taskId: string) => Promise<void>` | Re-resolve current key and ephemeral input data before API execution. |
| `retryTask` | `src/store.ts:3816` | `(task: TaskRecord) => Promise<void>` | Reject reference-dependent retry when ephemeral originals no longer exist. |
| `createInputImageFromFile` | `src/store.ts:4555` | `(file: File) => Promise<InputImage \| null>` | Replace immediate upload persistence with the ephemeral image path. |
| `addImageFromUrl` | `src/store.ts:4564` | `(src: string) => Promise<void>` | Apply the same retention and URL-fetch policy as file upload. |
| `initializeEmbeddedContext` | `src/lib/embeddedSession.ts:91` | `(href?, replaceState?, root?, embedded?, historyState?) => EmbeddedPublicContext \| null` | Scrub query credentials and preserve only validated public return metadata in native history state. |
| `getEmbeddedReopenUrl` | `src/lib/embeddedSession.ts:331` | `() => string \| null` | Offer a same-origin route back to the Sub2API custom menu after session loss. |
| `getDeploymentSurface` | `src/lib/deploymentFlavor.ts:20` | `(embedded?, framed?) => DeploymentSurface` | Keep iframe-only safe-area layout out of standalone and upstream builds. |
| `Header` | `src/components/Header.tsx:158` | React header render | Hide duplicate iframe title, restore the standalone title, and reserve the host action area. |

## L1.2 Similar-path comparison

### Request lifecycle: `src/store.ts:1638`

- [x] Submit-time profile selection and validation: resolve the ephemeral credential before validation.
- [x] Deferred execution: resolve again from the in-memory session and fail explicitly if the key disappeared.
- [x] Retry: use the current selected key or require a new explicit choice; never silently fall back to the first key.
- [x] API dispatch: enforce the embedded capability policy again immediately before network I/O.

### Image lifecycle: `src/store.ts:1683`

- [x] File upload and URL import: memory only.
- [x] Mask creation: memory only.
- [x] Same-session execution: resolve from memory.
- [x] Generated output: persist through the existing image database.
- [x] Reload/reuse/retry: show unavailable input and prohibit reference-dependent replay.
- [x] Final cleanup: do not delete ephemeral inputs until every consumer for the active task has completed.

### Credential leak surfaces: `src/lib/persistedState.ts:90`

- [x] Zustand persistence: sanitize.
- [x] IndexedDB tasks/images: raw credentials and upload/mask data prohibited.
- [x] URL settings/import: disabled and scrubbed in embedded mode.
- [x] ZIP export: settings credentials and ephemeral inputs prohibited.
- [x] Service Worker/cache: disabled for embedded production builds.
- [x] Logs/errors: no token, key, bearer header, image data URL, or raw response body containing credentials.

## L1.3 Convention decisions

| Convention | Current state | Decision | Reason |
|---|---|---|---|
| Package manager | npm with `package-lock.json` | Keep npm and use `npm ci` | Required by repository instructions and isolates the fork from `sub2api-tools`. |
| Source ownership | Independent GitHub fork | Keep this repository as the only source of the forked app | Avoid subtree/submodule and double sources of truth. |
| Upstream updates | Upstream remote available | Manual, tagged merges only | Automatic sync could restore prohibited persistence/providers. |
| Build flavor | Normal upstream build uses relative base | Add an explicit Nanafox embedded flavor and beta base path | Preserve upstream build while producing a same-origin Sub2API artifact. |
| UI language | Chinese-first existing UI | Keep Chinese-first; honor iframe language only where already supported | Minimize unrelated translation work. |
| Provider/model | Multi-provider upstream | Embedded allowlist is OpenAI Images plus `gpt-image-2` | Product invariant from Sub2API tools contract. |
| Multi-image count | Upstream supports multiple paths | Force `n=1` in beta | Avoid request fan-out, billing surprises, and retry amplification. |
| Secret storage | Credentials currently live in settings/profile shape | Module-memory credential session; persist only key ID | Required security boundary. |
| Input storage | Upload/mask currently use IndexedDB | Memory only; generated output remains persistent | Required privacy boundary with explicit retry tradeoff. |

## L1.4 Return semantics

| Return/error shape | Caller interpretation | Required test |
|---|---|---|
| key list with zero eligible items | Auth succeeded; render create-key CTA, do not open settings or generate | `embeddedSession shows no-key state` |
| one eligible key | Select automatically and enable generation | `embeddedSession auto-selects only key` |
| multiple keys without a valid saved ID | Require explicit selection; generation remains disabled | `embeddedSession requires choice` |
| key endpoint 401/403 | Embedded session expired/unauthorized; do not reinterpret as generation-key failure | `embeddedSession reports auth error` |
| generation endpoint 401/403 | Selected API key is invalid or unauthorized; refresh list and require selection | `executeTask invalidates selected key` |
| missing runtime key before submit/execute | Fail before fetch with actionable key-selection message | `request rejects missing runtime key` |
| unsupported provider/model/mode | Fail before fetch with stable capability error | `embedded policy blocks unsupported request` |
| missing ephemeral reference after reload | Keep history/output visible but prohibit reference retry/reuse | `retry rejects missing reference input` |
| generated output persistence failure | Task reports storage failure without persisting input originals or credentials | `output persistence failure is explicit` |
| standalone reload without JWT | History remains readable; generation is disabled; a validated return-to-menu link is shown | `embeddedSession restores safe reopen context without credentials` |

## L1.5 Negative assertions

| Dangerous input/state | Must happen | Test assertion |
|---|---|---|
| URL contains `apiKey`, imported settings, or provider config | Embedded mode ignores it and scrubs it from the visible URL | no imported secret appears in settings/storage |
| persisted legacy state contains raw keys | Embedded hydration removes them before use or re-persistence | serialized state contains no known sentinel secret |
| multiple keys and no valid preference | No arbitrary first-key fallback | `fetch` generation mock is not called |
| provider is fal/custom or mode is Responses | Stable capability error before network | only `/api/v1/keys` may have been fetched |
| model is not `gpt-image-2` | Stable capability error before network | generation mock is not called |
| `n` is greater than one | Normalize to one or reject before network, with one documented behavior | request body never contains `n > 1` |
| upload or mask is submitted | No IndexedDB image row for that original | DB query by sentinel image hash is empty |
| export requested after reference edit | Archive omits uploads, masks, token, raw key, and bearer text | ZIP byte/string scan finds no sentinel data |
| embedded production build starts | No Service Worker registration | navigator registration mock is not called |
| malformed key response or later page failure | Explicit load error; no partial silent selection | state is error and generation is disabled |
| forged cross-origin `src_host` or `src_url` | No history-state return metadata and no reopen link | `embeddedSession rejects cross-origin reopen context` |

## L1.6 Rollback

| Category | Change | Rollback action | Order |
|---|---|---|---|
| Static release | `current` points to `releases/70aa5a5` | Atomically switch `current` to `releases/d5e0591` | 1 |
| Caddy beta policy | Beta CSP permits only same-origin plus `data:`/`blob:` image conversion | Restore `/etc/caddy/Caddyfile.before-image-playground-data-connect-20260822-0928`, validate, then reload | 2 |
| Custom menu | Test menu points to `/tools/image-playground/` | Keep it on the rolled-back beta release; remove the test menu item only for a full beta withdrawal | 3 |
| Retired test route | `/tools/image-studio/` returns 410 | Keep retired during beta rollback; restore its pre-retirement Caddy behavior only by a separate product decision | 4 |
| Static files | Commit-named beta and retired-tool artifacts remain on disk | Retain them for rollback; archive only after the rollback window closes | 5 |
| Code | Nanafox fork commits | Revert the release commit or deploy a previous verified commit-named artifact | 6 |
| Browser data | Generated outputs/task metadata written by beta | Leave compatible beta-origin data or clear it during an explicitly requested full withdrawal | 7 |
| Backend/database | No source, contract, schema, or business-data change; test menu uses the existing settings path | Revert only the test `custom_menu_items` setting for a full beta withdrawal | 8 |

Acceptable release-rollback state: `/tools/image-playground/` serves the previous verified release through the unchanged test menu; `/tools/image-studio/` remains 410 on the test site; production is untouched; Sub2API source/schema/business data is unchanged; no Service Worker controls either tool route.

## L2.1 Runtime assumptions

| Assumption | Verification path | Environment | If false |
|---|---|---|---|
| Same-origin `/api/v1/keys` returns paginated key records including the raw key needed for gateway use | Real iframe network inspection with zero/one/multiple-key test users | Sub2API test site | Stop beta integration and revise the contract; do not add an undocumented backend call. |
| An eligible active OpenAI key may still lack `gpt-image-2` entitlement | Run one user-triggered generation with the selected key | Test gateway | Show actionable generation error; do not probe every key or silently switch keys. |
| The iframe JWT is available in the initial query and valid only for the keys endpoint | Inspect the custom-menu iframe request and keys call | Test site | Stop and revise bootstrap with Sub2API; do not broaden JWT use. |
| Uploaded originals may disappear on reload by product decision | Browser reload acceptance test | Local and test site | If product rejects this behavior, a new privacy/storage decision is required before implementation continues. |
| Normal upstream build must remain usable | Run both default and embedded builds | Local CI | Split Vite entry/config rather than changing upstream defaults globally. |
| Existing upstream test mismatch is a stale expectation rather than a product regression | Compare implementation, test fixture, and upstream commit intent | Local | Fix behavior instead of changing the expectation; record evidence. |
| Native `history.state` survives a same-tab reload without exposing values in the URL | Real standalone reload plus unit tests | Local and test site | Fall back to a plain session-expired message; do not use LocalStorage/sessionStorage for JWT or raw keys. |

## L2.2 State machines

### Embedded key session

```text
Boot
  -> no token: SessionAuthError
  -> token: LoadingKeys
LoadingKeys
  -> 401/403: SessionAuthError
  -> network/schema error: KeyLoadError
  -> zero eligible: NoEligibleKey
  -> one eligible: Ready(selected automatically)
  -> multiple + valid saved ID: Ready(saved selection)
  -> multiple + no valid saved ID: SelectionRequired
Ready
  -> selected key removed/disabled or generation 401/403: LoadingKeys -> SelectionRequired/NoEligibleKey
  -> submit: ResolveEphemeralProfile -> Validate -> Execute
  -> standalone reload: SessionAuthError + persisted generated history + validated ReopenMenu action
```

No transition may silently choose the first of multiple keys. Raw keys exist only inside the live module session and request-local objects.

### Reference image lifecycle

```text
Upload/mask
  -> create in-memory ID + data URL
  -> submit task metadata with non-secret image ID
  -> execute from memory
      -> success: persist generated output only
      -> error: retain input until task reaches a terminal state
  -> reload/navigation: ephemeral original is gone
      -> history remains visible
      -> reference retry/reuse becomes unavailable with explicit UI text
```

Concurrency point: multiple running tasks may reference the same ephemeral image. Cleanup must be reference-counted or delayed until no running consumer remains; task completion must not delete data still needed by another task.

## L2.6 Permission and security

| Dimension | Decision | Evidence/gate |
|---|---|---|
| Identity source | Initial iframe JWT identifies the Sub2API user only for key listing | Network test shows JWT only on `/api/v1/keys`. |
| Authorization boundary | Selected Sub2API API key authorizes image generation/edit requests | Request test shows the selected key only on approved same-origin endpoints. |
| Credential leakage | JWT/raw key never enter persistent settings, task records, IndexedDB, exports, logs, error payloads, or Service Worker caches | Sentinel-secret scans across storage, ZIP, console mocks, and build/runtime URL. |
| SSRF | Embedded request base is same-origin and endpoint allowlisted; arbitrary API URL/import is disabled | Injected external/private base URL fails before fetch. |
| Tenant isolation | Key list always comes from the current iframe JWT; no user ID alone is trusted | Request construction test ignores query `user_id` for authorization. |
| Logging | Log only stable error category, HTTP status, and provider request ID when safe | Tests assert no token/key/data URL/raw auth header in console/error strings. |
| XSS/content | Prompt and key names render as text; no unsanitized stored HTML is introduced | Component test uses HTML/script sentinel strings. |
| Initial URL exposure | `history.replaceState` and `no-referrer` reduce browser/referrer exposure but cannot prevent server access-log capture of the first iframe URL | Document as inherited risk; do not expand the JWT contract in beta. |

## L2-ops.1 Observability

| Failure mode | Client-visible signal | Safe diagnostic | Alert | Distinguishable states |
|---|---|---|---|---|
| iframe session missing/expired | Dedicated session error and reopen-menu action | status only | none for beta | Separate from no keys and generation-key failure. |
| no eligible key | Create/manage-key CTA | eligible count zero | none | Separate from key-load failure. |
| selected key invalid | Selection invalidated and list refreshed | generation status/request ID if safe | none for beta | Separate from iframe JWT failure. |
| unsupported capability injection | Stable blocked-capability message | capability name only | bundle/test gate failure | Separate from network failure. |
| missing ephemeral input | History remains, retry disabled | missing input ID only | none | Separate from IndexedDB/output failure. |
| output persistence failure | Task-level storage error | storage operation category | none for beta | Separate from successful generation with empty output. |

No analytics or remote client logging is added in the beta. Browser console diagnostics must pass the sentinel-secret tests.

## L2-ops.2 Compatibility and beta rollout

| Dimension | Question | Decision |
|---|---|---|
| Existing caller | Does the normal Sub2API surface change? | No source or container change; only the approved test custom menu and isolated Caddy routes change. The test Image Studio route is retired, and production is untouched. |
| Upstream shape drift | Can upstream key/profile/task formats change? | Pin commit for beta; merge upstream tags manually behind full gates. |
| Feature flag | Is a runtime production flag needed? | No backend flag; use compile-time embedded flavor and separate test route. |
| New/old comparison | How are versions compared? | Compare the current and previous commit-named beta releases plus normal Sub2API smoke checks; never double-send generation requests. |
| Rollback pollution | What remains after rollback? | Beta-local generated output/task metadata, retained static releases, the approved test menu setting, and isolated Caddy configuration; no source/schema/business-data mutation or Service Worker. |

## Acceptance checklist

- [x] Default upstream build passes at `70aa5a5`.
- [x] Nanafox embedded build passes with base `/tools/image-playground/` at `70aa5a5`.
- [x] Full test suite passes: 35 files, 538 tests at `70aa5a5`.
- [x] URL/history/storage/export negative tests find no JWT, raw key, bearer, upload, or mask sentinel; the live beta has no Service Worker registration.
- [x] Uploaded originals and masks stay out of IndexedDB and export in automated tests.
- [x] Zero/one/multiple/deleted/disabled key flows pass automated tests.
- [x] Real zero/one-key iframe acceptance passes with isolated disposable users: zero-key shows the create-key path without generation, one-key auto-selects and enables submission, URL credentials are scrubbed, and JWT/raw-key scans of playground storage are clean. The test menu was restored to admin-only and both users were deleted afterward.
- [x] Unsupported provider/model/mode and `n > 1` cannot reach network I/O in automated tests.
- [x] Reference edit works in the same session through `/v1/images/edits`; a reloaded masked-reference task shows `参考图已失效` and disables reference reuse explicitly.
- [x] Generated output download produces a valid 1254×1254 PNG.
- [x] Real pointer-drawn partial mask saves successfully, is labeled `局部重绘`, and generates through `/v1/images/edits`.
- [x] Generated output remains available after reloading the outer custom page.
- [x] Real Sub2API iframe multi-key generation passes on the test site.
- [x] Standalone reload preserves history, disables generation, and returns safely to the custom menu without restoring credentials.
- [x] Desktop and 390×844 host layouts have no button/key overlap or horizontal overflow.
- [x] Test `/tools/image-studio/` returns 410; retired static files remain available for an explicit recovery decision, and production is untouched.
- [x] Atomic `current` symlink rollback serves `d5e0591` and restores `70aa5a5`; the Sub2API container start time is unchanged.
- [x] Live beta CSP permits only same-origin plus `data:`/`blob:` image conversion; beta, health, and retired-route checks remain 200/200/410.

## Remaining risks

| Item | Status | Owner | Follow-up |
|---|---|---|---|
| Initial JWT can appear in the first server request log before JavaScript scrubs the URL | Known inherited risk; do not expand scope in beta | Sub2API owner | Design a scoped one-time embed token before prompt CRUD or broader JWT use. |
| OpenAI-group key does not guarantee `gpt-image-2` entitlement | Accepted beta behavior with explicit generation error | Image Playground owner | Revisit only if real support volume justifies a backend capability signal. |
| Upstream changes can reintroduce prohibited behavior | Controlled by manual tagged merges and negative gates | Fork maintainer | Run the full embedded security suite for every upstream merge. |
| Memory-only inputs remove cross-reload reference retry | Product tradeoff required by current privacy rule | Product owner | Reassess only with an explicit encrypted/server-side storage design. |
| Large upstream store increases change-conflict risk | Known; keep changes in lib modules and narrow store seams | Fork maintainer | Extract only proven shared seams during implementation, not speculative abstractions. |
| Standalone reload cannot resume generation without a fresh JWT | Accepted and verified safe downgrade: preserve only same-origin return metadata and show a reopen action | Image Playground owner | Recheck after every upstream merge. |

## Start command for the implementation task

```sh
cd /Users/nio/project/nanafox/gpt_image_playground
git status --short --branch
git rev-parse HEAD
npm ci
npm run build
npm test
```

Stop after baseline classification if build/tests are not green. Do not push, deploy, edit Sub2API, or alter production without separate explicit authorization.
