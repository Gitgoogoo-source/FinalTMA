# PokePets 系统总览

## 事实来源

`docs/product/功能说明文档.md` 的全部章节是唯一产品功能来源。`PRODUCT_DATA_CHECKSUM_BOUNDARY` 上方第 1—20 章由 Catalog v1 数据生成器解析；下方第 21 章 Battle 是产品扩展，不进入 Catalog v1 migration 或 manifest。Battle 的金额、时限、状态、DTO、错误与公共接口只引用第 21 章或正式契约。

已发布 Catalog v1 的 immutable `product_checksum` / release identity 固定为：

```text
82ae510b2ae38d22db94197d667040c25813080dc73c6219eca30d42aa76404f
```

该值不是当前产品文档全文 SHA。生成器另计算并打印 boundary 上方源文档 SHA-256，仅用于诊断；Catalog v1 release identity 必须同时与 tracked manifest 和 product-data migration 一致。架构文档只记录技术边界，不复制价格、概率、奖励或产品状态规则。

## 运行时

- Web：React、Vite、TypeScript，运行在 Telegram Mini App。
- API：同一 Vercel Project 内的 `app`、`integrations`、`jobs` 三个 Node.js 24 Function 网关。
- Database：Supabase Postgres 17，仅暴露 `api` schema；浏览器不加载 Supabase SDK，也不直连 Postgres、RPC、Auth 或其他 Data API。
- Art Storage：私有 `art-masters` 永久保存历史母版，公开 `pet-runtime` 只发布宠物运行时 WebP；浏览器只能直接 GET API 返回的公开桶宠物图片 URL。
- Catalog Delivery：`catalog.current` 以 `no-store` 返回当前 checksum、release key 与 revision；`catalog.release` 按 checksum + release key 返回一年不可变缓存的完整目录，Web 只通过 `useCatalogQuery()` 合并为目录快照。
- Realtime：Ably Standard 只发送 Battle 状态失效通知；REST 与数据库 `state_version` 回正权威状态。
- Blockchain：TON Connect、钱包验证与 Tact NFT Mint 实现保留休眠；当前 App/Jobs 运行时注册表与 OpenAPI 均不发布相关端点，MVP 不提供入口、恢复或定时对账。
- Deployment：Vercel Pro；开发阶段的 Production Project 保持启用，`main` 只通过 Git Integration 自动部署，不使用项目暂停、空触发提交或手动部署；真实开发环境与未来生产环境使用相同 Git commit 和 migration 序列。

仓库继续保留唯一的 TON Connect 静态身份与 manifest，供休眠实现保持确定性；当前 Web 不引用该 manifest、不初始化 TON Connect，也不把其图标是否正式替换作为 MVP 发布阻塞。

## 依赖方向

```text
apps/web -> @pokepets/api-contracts/app-client[/errors]
api -> apps/api/entrypoints
apps/api/entrypoints -> gateway-specific contracts + http
apps/api/http -> injected route registry + handler map
apps/api/domains -> one api schema RPC per handler
apps/api/workflows -> domain capabilities + platform adapters
api schema RPC -> private database schemas
contracts/ton -> TON blockchain
```

禁止反向依赖、跨领域深层导入、浏览器访问 Supabase Data API、Node 层组合多次资产写入。浏览器对 `pet-runtime` 公开对象的图片 GET 是唯一 Supabase 直连例外。

默认开盒表现动态边界在页面空闲时创建并保留脱离文档流的 Canvas/WebGL 程序资源和首帧；WebGL 首帧必须以 `finish()` 在该空闲任务内同步完成，不能把仍在驱动队列中的绘制标为已预热。演出挂载只把同一 Canvas 放入既有宿主并按实际尺寸对齐，不创建或显隐独立的全屏合成 surface。所有设备另以有界空闲任务准备 Web Audio 黑洞呼吸自动化曲线，并在舞台发布 `ready` 的同一回调启动连续电子嗡鸣；四核及以下设备仍不触发演出期 Telegram `HapticFeedback`，但必须播放自定义 Web Audio；核心数不得关闭音效。首次可见呼吸不得承担 GPU 程序资源冷创建、延迟 GPU 提交、整段音频样本、自动化曲线同步生成或原生触觉桥接，唯一规则见 [ADR-069](adr/ADR-069-gacha-renderer-prewarm-and-static-stage.md) 与 [ADR-070](adr/ADR-070-gacha-breath-synchronized-hum.md)。

TMA 首屏同步闭包固定为入口、默认开盒页、首屏契约及各自同步依赖；活动 Web 按 [ADR-046](adr/ADR-046-first-screen-direct-dependency-and-native-navigation.md) 使用原生 History 导航状态和共享 UI 叶子导入，不加载 React Router 或非首屏共享 UI。Telegram 初始化后只预取首屏契约，轻量操作 Facade 随入口加载，重型操作运行时通常只在玩家意图或真实 operation 恢复需要后加载；唯一自动例外是默认开盒页的数据、规则和当前盲盒主图全部就绪后，通过既有动态边界准备开盒操作运行时与开盒表现 chunk，以保证首次点击直接进入程序化灵契星域，不把这些模块并入首屏同步闭包，也不预取业务数据、背景图片或结果宠物图。恢复 effect 通过 `useEffectEvent` 调用最新 `hydrate`，未决 operation 重进不会因 Runtime 展示状态发布而重复水合。默认开盒页完成上述开盒表现准备后，其他页面模块才按 [ADR-043](adr/ADR-043-adaptive-page-module-warmup.md) 在明确的前台 4G、非省流量条件下逐个后台准备藏品、任务、交易和图鉴；未知或受限网络不自动下载这些其他页面模块，Battle 页面模块永远只按玩家导航意图加载，模块准备不预取业务数据。玩家已经进入 Battle 后，按 [ADR-047](adr/ADR-047-battle-staged-runtime-loading.md) 只同步取得八状态、权威恢复、倒计时、操作与核心样式，Ably 和重技能轨迹运行时在非首页权威状态或玩家意图时立即准备，Battle 首页稳定后的自动准备仍须满足同一前台 4G、非省流量条件；[ADR-048](adr/ADR-048-battle-dynamic-preload-entry-deduplication.md) 禁止 realtime 动态 preload 再次提示或下载已经执行的应用入口 JS。除上述开盒表现准备外，操作运行时、操作结果、全局充值/VIP 弹窗和领域 CSS 只在对应意图或真实恢复需要后加载；生产构建按 [ADR-040](adr/ADR-040-first-screen-runtime-boundary.md) 对完整首屏闭包执行 JS `400000 / gzip 125000`、CSS `110000 / gzip 23000` 硬门禁和禁止模块检查，并对 Battle 增量核心执行 JS `160000 / gzip 45000`、CSS `45000 / gzip 9000` 门禁，禁止 Ably、重特效播放器和轨迹样式进入静态闭包，动态 preload 中的应用入口 JS 必须为零。`/game` 固定承载 React + TypeScript Battle，不引入 Phaser；Battle 只有在游戏页可见或当前 session 需要恢复 Battle participation/当场终局结果时读取专属状态，邀请 waiting 的创建者展示心跳和 lobby 的双方 presence 心跳只在页面可见时发送。隐藏、Telegram deactivated、`pagehide` 或离开 `/game` 立即结束当前 lease、中止在途 heartbeat 并尽力 offline；恢复先读取权威快照并取得新 lease，进入 `active_turn` 后停止 presence。

当前 waiting 分享尝试的 callback 或 sent/failed 事件按 [ADR-057](adr/ADR-057-battle-native-share-presence-resumption.md) 进入同一权威 presence 恢复入口：`/game` 已可见时立即消费，完成信号先到时保留到紧随其后的可见、页面显示、聚焦或激活事件；两种顺序都不依赖额外 `activated` 或即时更新的 `isActive`，同一尝试最多触发一次恢复，分享前已经结束的旧 lease 不得复用。

Battle 队伍选择与有效邀请接受页按 [ADR-058](adr/ADR-058-battle-team-options-loading-state.md) 复用同一 `teamOptionsRequired` 条件启用本人队伍查询并决定首次加载状态；请求完成前显示行内读取状态且禁用确定动作，不能把尚未返回的数据渲染成真实无藏品。

五个主导航页面在当前登录会话内首次访问后保持挂载。切换页面只恢复各自滚动、筛选和页内状态，同时按 [ADR-037](adr/ADR-037-persistent-page-query-activity.md) 暂停隐藏页面查询；切页前已开始的读取允许完成。返回页面时，新鲜且未失效的缓存不读取，超过 20 秒或被业务刷新范围标记失效的查询按键回正一次；已有缓存回正失败时保留内容并显示非阻塞重试。业务结果把契约范围全部标记失效，只立即刷新当前页面和全局活动查询；后台连续五分钟后回到前台只静默回正顶部摘要与当前页面。交易页按 [ADR-029](adr/ADR-029-market-sold-device-inbox.md) 在可见期间每 10 秒同步本人挂售与新成交事件，当前设备只持久保存按内部用户隔离的事件游标和未隐藏 SOLD 提醒，并由同一待展示集合驱动“管理”页签红点。市场首页、单模板和本人挂售读取按 [ADR-041](adr/ADR-041-market-transactional-supply-read-model.md) 只访问事务维护的两级供给汇总与有界成交游标，不随已售罄或已取消历史增长；原始 FIFO 挂单继续独占购买、下架、reservation 与结算裁决。

身份读取按 [ADR-049](adr/ADR-049-identity-initial-state-and-summary-read-model.md) 分成入口 `identity.initial` 与日常 `identity.summary`。完成入口交接的认证在登录事务提交后由同一 Function 取得初始状态，并随令牌一并返回；临时读取失败返回空值，Web 保留 session 并命令式重试。`summary` 写入 React Query，`recovery` 只写入当前 session generation 内存；顶部人工刷新、前台恢复、业务 `refreshScopes`、页面返回和 Battle 终局只允许回正 `identity.summary`，不得重新读取 `identity.initial`。

账号语言按 [ADR-074](adr/ADR-074-account-language-and-en-us-localization.md) 固定支持 `en` 与 `zh-CN`，首次与新账号默认英语。数据库账号偏好覆盖按 Telegram ID 隔离的首帧本地提示；左上角既有身份区域打开全局账号菜单，不新增或增高顶部控件。静态文案、稳定错误码和共享 ID 化游戏内容注册表共同覆盖 Web、Telegram 外部消息与 NFT 元数据，任何语言切换都不改变模板、技能、任务、属性、概率、资产或 Battle 规则。

Telegram 发布隔离按 [ADR-075](adr/ADR-075-telegram-named-mini-app-release-isolation.md) 固定使用同一部署的独立 `/maintenance.html`。Main Mini App、默认菜单按钮和 named Mini App 是三个独立入口；named Mini App 不删除 `pokepets_dev`，只在隔离期间把 Web App URL 切到无缓存、无认证、无 API 的双语静态页，完整验收后再改回环境根 URL。

目录交付按 [ADR-042](adr/ADR-042-catalog-pointer-immutable-release.md) 分成动态小指针与不可变完整内容。资源切换只改变 `catalog.current`；checksum + release key URL 永不原地改写或清除缓存。`useCatalogQuery()` 在新内容读取期间保留上一份成功快照，只有全新 WebView 没有快照时才进入原有初始错误状态。空库 migration 不恢复 Storage 对象登记或当前指针；数据库重建后必须按 [ADR-050](adr/ADR-050-catalog-post-rebuild-readiness-gate.md) 先发布历史 v1、再发布当前 v2，并由失效即失败的 `assets:release status` 与无运行中变更租约共同放行。

## 可信边界

前端只提交动作、目标标识、数量、operation-backed 命令所需的幂等键，以及 Battle presence 意图所需的 lifecycle version、lease UUID 与 command sequence。价格、余额、库存、资格、奖励、Battle presence 终态、属性与技能数值、命中、伤害、行动顺序、胜负、结算、随机结果、任务进度和链上状态均由服务端重新校验，并由单个数据库事务裁决。

创建 operation 的玩家写请求以 UUIDv7 `Idempotency-Key` 作为 `operation_id`。数据库先回放旧 key，再对新 key 执行时间新鲜度与有界准入，并对规范化请求计算哈希；相同键和相同请求返回原结果，相同键和不同请求返回 `IDEMPOTENCY_KEY_REUSED`。Battle 只有创建、随机匹配、取消、接受和 `attack | switch | replace_attack` 行动属于这一范围；heartbeat/offline 不接收幂等键、不创建 operation，由数据库在 room-first 锁内先裁决 lifecycle version + lease UUID + command sequence，旧 lease、低版本、重复和乱序命令完全无副作用。Battle 结果展示不产生写请求。

会话令牌只在运行内存保存，绝对有效期 15 分钟。只有 `POST /api/auth/telegram` 接收 Telegram `initData`；认证裁决固定执行验签前来源限流和验签后登录事务两个数据库 RPC，完成交接的正常首屏再在事务提交后执行一次 `identity_initial` 只读 RPC，因此正常完整首屏共三次数据库 RPC、一个浏览器认证请求。令牌是包含版本、session UUID 与 HMAC 的自定义 opaque bearer，Function 本地证明完整性后只把 `session_id` 传给业务 RPC。账号为 `banned` 时前端立即清空全部业务内容，只渲染空白界面。

## 数据库权限

内部 schema 对 `public`、`anon`、`authenticated` 和 `service_role` 撤销 schema、表、视图、序列和函数权限。内部库存读模型使用 `security_invoker` 且不进入 Exposed schemas。`service_role` 只获得 `api` schema 的使用权和显式 allowlist 函数的执行权，不能执行内部登录限流 helper。玩家 RPC 使用 `session_id` 最终验证会话存在、撤销、绝对过期、账号、入口交接和资源归属；常规认证没有独立会话解析 RPC。

`admin` 是数据库所有者专用的非 Data API 管理边界。受控 Battle 验收夹具只从该 schema 执行，默认没有项目身份或 enable 记录，不向 `service_role` 或任何应用角色授权；真实开发绑定、短期门禁、幂等 reconciliation、fixture-owned provenance 与只读状态遵循 [ADR-016](adr/ADR-016-controlled-battle-acceptance-fixture.md)。

## 操作恢复

前端内存操作阶段固定为 `confirming → submitting → pending/unknown → succeeded/failed`；数据库持久状态为 `pending`、`unknown`、`succeeded`、`failed`。随机结果和资产结果只生成一次，`unknown` 只查询原 `operation_id`。`identity.initial.recovery` 在同一数据库语句快照返回用户权威游标与恢复种子；`GET /api/operations/recoverable` 既发现转盘未决和进化规定状态，也只用不含结果内容的路由标记发现晚于首屏提交的任意 operation 终态。发现绑定可见、Telegram 激活和在线状态，恢复队列存在时暂停，清空后立即追赶；路由刷新范围全部标记失效且当前页面与全局活动查询成功后推进内存游标，身份域只精确刷新 `identity.summary`，隐藏页面不阻塞并在返回时回正。六类专用表现与业务请求并行加载，表现失败只重载 UI 而不重提 operation；Runtime 后置兄弟节点中的应用风格结果遮罩通过共享双类规则固定覆盖当前 WebView，不继承普通主壳的相对定位、固定高度或裁剪，各表现模块自带自身动画和响应式规则。开盒按 [ADR-067](adr/ADR-067-gacha-webgl-spirit-field.md) 与 [ADR-069](adr/ADR-069-gacha-renderer-prewarm-and-static-stage.md) 在开盒页事实就绪后的空闲时段预热并保留一套真实 Canvas/WebGL 资源，Canvas 放入演出宿主后先完成全尺寸帧和有界静态合成帧，随后发布 `data-astral-stage="ready"`，4 秒呼吸时间轴再从第 1 次开始；随后以复用同一 context、program、buffer 和 vertex array 的 GLSL 黑洞场、螺旋粒子与静态 CSS 星域执行 4 秒内 13 次递减周期的中性黑洞呼吸汇聚和 0.7 秒金光揭晓，最后四轮在 470ms 内形成局部极速临界频闪；所有支持 Web Audio 的设备都播放现场合成音；五核及以上设备保留演出触觉，四核及以下设备只省略触觉。汇聚阶段不再运行重复的 CSS 全屏呼吸、动态模糊或混合模式，召唤与单抽结果固定使用同一程序化深黑金色灵契舞台和黑洞中心位置，WebGL2 不可用时降级为同构 Canvas 2D 黑洞与螺旋粒子，结果或揭晓门槛图片迟到时冻结在无稀有度的最大黑洞临界画面。前三轮中性呼吸独占前 `1840ms`，成功结果只在此后以脱离 DOM 的图片对象准备资源；完整结果 DOM 固定等到 4 秒呼吸结束并停在最大中性临界帧后才挂载和预绘。单抽正式详情图或十连初始中央缩略图 `decode()`、中性汇聚和揭晓门控同时满足后显现。十连结果使用无子图层、无模糊、无混合模式的静态深黑背景，首帧只显示以最终效果预绘的中央图，其余九图继续并行准备并在解码后以近透明状态预热首次纹理，再按 [ADR-068](adr/ADR-068-gacha-ten-result-first-frame.md) 从中央向外每帧最多加入一个图层；揭晓门槛图片最终失败只在静止深黑金色灵契舞台重试图片，不重提 operation、扣款或发奖。转盘停盘按 [ADR-052](adr/ADR-052-wheel-animation-bounded-terminal-convergence.md) 只等待独立固定时长计时器，不读取、等待或竞速 Animation 完成 Promise；计时到达或表现 API 异常都落到服务端最终奖励并继续打开结果弹窗，旧运行期迟到动画不得恢复展示。除进化专用回执外，开盒、转盘、分解和通用结果只在取得它们的当前前台运行期展示，“确定”“收下”或返回只处理 Web 内存展示，不发送结果 API、RPC、原操作查询或刷新；隐藏、刷新或重新进入后不恢复旧结果，只刷新权威页面状态。恢复注入的非进化 `pending`、`unknown` 只查询原操作，取得终态后静默回正并移除。进化在未决阶段锁定新提交和底部导航，终态由专用覆盖弹窗和服务端回执处理。Battle 创建、随机匹配、取消、接受和行动恢复原 operation 后必须读取 viewer-specific room snapshot；heartbeat/offline 只在当前 lease 内重试，生命周期结束后以权威快照申请下一版本 lease。普通 heartbeat/offline 结果只应用 room，确认退款终态才按路由契约刷新 Battle、`identity.summary` 和 inventory。Battle 终局快照到达后立即执行三域回正，结果覆盖层等待动作表现队列清空，按钮只在内存返回首页；其他领域既有确认回执保持各自规则。

开盒充值继续确认按 [ADR-061](adr/ADR-061-gacha-topup-continuation-runtime-boundary.md) 绑定创建订单的当前 TMA 运行内存和唯一订单 ID；历史 `delivered` 支付订单不具有跨运行期弹窗权限，支付与开盒业务事实仍由数据库保留并裁决。

市场购买按 [ADR-030](adr/ADR-030-market-purchase-inline-progress.md) 在未决阶段只保留确认弹窗内的“购买中”按钮状态，不显示全局操作状态；当前前台运行期的权威刷新完成后才显示不含服务器、请求和 operation ID 的专用购买结果。离开前台后只恢复原 operation 与权威状态，不恢复旧购买结果弹窗。成功上架按 [ADR-060](adr/ADR-060-market-listing-quota.md) 在数据库挂单插入事务内原子消耗 UTC 每日 200 次与账号生命周期 20,000 次配额；失败、回放、下架和成交不改变计数，任一配额用尽时出售页立即禁用且服务端继续权威拒绝。

operation 准入与保留按 [ADR-059](adr/ADR-059-bounded-operation-admission-and-retention.md) 固定：所有幂等命令使用 UUIDv7，旧 key 回放不计入新请求配额；非 Battle 新 key 有用户级四项上限。无业务引用的失败/成功终态分别在 7/37 天删除，被业务事实引用的终态在 30 天后只保留最小锚点。

## 生成物

- `generated/catalog/catalog-v1.json`
- `generated/assets/art-assets-v2.json`
- `generated/assets/releases/catalog-v1-initial.json`
- `generated/battle/battle-v1.json`
- `packages/api-contracts/openapi/openapi.json`
- `supabase/migrations/*_baseline.sql`
- `supabase/migrations/*_product_data_v1.sql`
- `supabase/migrations/*_api_security.sql`
- `apps/web/public/tonconnect-manifest.json`
- `contracts/ton/build/*`（Tact 编译产物；Git 忽略并由 TON typecheck/chain build 生成）

生成物禁止手工维护；漂移检查必须在临时目录生成后比较。

## 架构资料

- [领域映射](domain-map.md)
- [运行时](runtime.md)
- [事务与数据](data-transactions.md)
- [操作恢复](operation-recovery.md)
- [安全边界](security-boundaries.md)
- [技术裁决](adr/ADR-001-runtime-and-deployment.md)
- [模块边界与网关隔离](adr/ADR-007-module-boundaries-and-gateway-isolation.md)
- [Vercel 函数打包与配置隔离](adr/ADR-008-vercel-packaging-and-config-isolation.md)
- [开盒页运行期视图状态](adr/ADR-009-gacha-runtime-view-state.md)
- [正式藏品图片资源](adr/ADR-010-catalog-image-assets.md)
- [进化共享藏品操作底部确认弹窗](adr/ADR-012-evolution-bottom-sheet-confirmation.md)
- [登录会话内页面保活与事件驱动刷新](adr/ADR-013-session-page-lifecycle.md)
- [Battle 数据库权威与规则快照](adr/ADR-014-battle-authority-and-ruleset.md)
- [Battle 实时失效通知、调度与 outbox](adr/ADR-015-battle-realtime-and-scheduler.md)
- [受控 Battle 验收夹具数据库边界](adr/ADR-016-controlled-battle-acceptance-fixture.md)
- [TON 生成绑定与静态门禁](adr/ADR-017-ton-generated-bindings.md)
- [Battle 平台条件型分享证据与发布门禁](adr/ADR-018-battle-share-platform-conditional-evidence.md)
- [Telegram 原生顶部控件安全区回退](adr/ADR-019-telegram-fullscreen-content-safe-area-fallback.md)
- [Battle 对战视觉作用域与首页像素动画](adr/ADR-020-battle-presentation-scope.md)
- [开盒灵契黑洞特效、结果舞台与展示门控](adr/ADR-021-gacha-moon-ritual-presentation.md)
- [全局顶层业务弹窗](adr/ADR-023-global-modal-layer.md)
- [开盒稀有度代表静态资源](adr/ADR-024-gacha-rarity-representatives.md)
- [Battle active 宠物原子切换](adr/ADR-025-battle-active-switch-atomicity.md)
- [Battle 服务端终局与当场结果展示](adr/ADR-026-battle-server-finalized-result-presentation.md)
- [Battle 公开匹配数据库事务](adr/ADR-027-battle-public-matchmaking-transaction.md)
- [Battle 请求阶段化结构日志](adr/ADR-028-battle-request-observability.md)
- [市场成交事件游标与当前设备 SOLD 收件箱](adr/ADR-029-market-sold-device-inbox.md)
- [市场购买按钮内进度与专用结果弹窗](adr/ADR-030-market-purchase-inline-progress.md)
- [宠物美术发布一致性与不可变缓存](adr/ADR-031-art-release-consistency-and-cache-policy.md)
- [Telegram Stars 付款人与订单账号绑定](adr/ADR-032-stars-payer-identity-binding.md)
- [邀请分享只保留本地反馈](adr/ADR-033-referral-share-local-feedback.md)
- [Vercel 静态美术运行时尺寸与 PNG 编码](adr/ADR-034-static-art-runtime-sizing.md)
- [抽卡与邀请插画响应式 WebP](adr/ADR-035-responsive-gacha-and-referral-art.md)
- [宠物资源受控发布的服务端密钥兼容与重建门禁](adr/ADR-036-catalog-release-key-compatibility.md)
- [持久页面查询活动边界与缓存回正](adr/ADR-037-persistent-page-query-activity.md)
- [本地会话凭证证明与登录 RPC 合并](adr/ADR-038-local-session-proof-and-login-rpc-consolidation.md)
- [库存数量集合式读模型](adr/ADR-039-inventory-set-based-read-model.md)
- [首屏运行时与样式边界](adr/ADR-040-first-screen-runtime-boundary.md)
- [市场事务型供给读模型](adr/ADR-041-market-transactional-supply-read-model.md)
- [自适应页面模块预热](adr/ADR-043-adaptive-page-module-warmup.md)
- [操作 Runtime 稳定委托与恢复水合](adr/ADR-044-operation-runtime-stable-hydration.md)
- [Telegram 身份字首与头像数据最小化](adr/ADR-045-telegram-identity-initial-and-profile-photo-minimization.md)
- [首屏直接依赖与原生浏览器导航](adr/ADR-046-first-screen-direct-dependency-and-native-navigation.md)
- [Battle 分层运行时加载](adr/ADR-047-battle-staged-runtime-loading.md)
- [Battle 动态预加载入口去重](adr/ADR-048-battle-dynamic-preload-entry-deduplication.md)
- [身份首屏状态与日常摘要读模型分离](adr/ADR-049-identity-initial-state-and-summary-read-model.md)
- [Catalog 空库重建后的发布恢复与失效即失败门禁](adr/ADR-050-catalog-post-rebuild-readiness-gate.md)
- [操作注册中心稳定命令与选择性信号订阅](adr/ADR-051-operation-registry-selective-subscription.md)
- [转盘有界终态与结果层视口锚定](adr/ADR-052-wheel-animation-bounded-terminal-convergence.md)
- [Battle Tick 告警自动闭环](adr/ADR-053-battle-tick-alert-lifecycle.md)
- [Ably 浏览器 CSP 端点白名单](adr/ADR-054-ably-browser-csp-endpoint-allowlist.md)
- [Battle 实时客户端安全诊断](adr/ADR-055-battle-realtime-client-diagnostics.md)
- [Battle 原生分享返回后的 Presence 恢复](adr/ADR-057-battle-native-share-presence-resumption.md)
- [Battle 队伍候选首次加载状态](adr/ADR-058-battle-team-options-loading-state.md)
- [有界 operation 准入与保留](adr/ADR-059-bounded-operation-admission-and-retention.md)
- [市场成功上架次数配额](adr/ADR-060-market-listing-quota.md)
- [开盒充值继续操作的运行期边界](adr/ADR-061-gacha-topup-continuation-runtime-boundary.md)
- [Battle 首页战场卡片运行时美术尺寸](adr/ADR-062-battle-room-art-runtime-sizing.md)
- [藏品主图连续显示与当前页详情图预热](adr/ADR-063-inventory-hero-image-continuity.md)
- [藏品技能条唯一身份与四技能上限](adr/ADR-064-inventory-skill-rail-identity.md)
- [藏品操作聚焦层与三等宽布局](adr/ADR-065-inventory-action-target-layout.md)
- [开盒 WebGL 灵契黑洞渲染边界](adr/ADR-067-gacha-webgl-spirit-field.md)
- [十连结果首帧预绘制与中心优先显现](adr/ADR-068-gacha-ten-result-first-frame.md)
- [开盒渲染器预热复用与静态星域](adr/ADR-069-gacha-renderer-prewarm-and-static-stage.md)
- [开盒黑洞呼吸同步连续嗡鸣](adr/ADR-070-gacha-breath-synchronized-hum.md)
- [市场出售页首屏自适应布局](adr/ADR-071-market-sell-first-screen-layout.md)
- [进化随机失败结果真实轮廓剪影](adr/ADR-072-evolution-failure-silhouette.md)
- [藏品筛选浮层堆叠与触控命中](adr/ADR-073-inventory-filter-layering.md)
- [账号语言、默认英语与 en-US 游戏本地化](adr/ADR-074-account-language-and-en-us-localization.md)
- [Telegram named Mini App 发布隔离页](adr/ADR-075-telegram-named-mini-app-release-isolation.md)
