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
- Realtime：Ably Standard 只发送 Battle 状态失效通知；REST 与数据库 `state_version` 回正权威状态。
- Blockchain：TON Connect、钱包验证与 Tact NFT Mint 实现保留休眠；当前 App/Jobs 运行时注册表与 OpenAPI 均不发布相关端点，MVP 不提供入口、恢复或定时对账。
- Deployment：Vercel Pro；真实开发环境与未来生产环境使用相同 Git commit 和 migration 序列。

仓库继续保留唯一的 TON Connect 静态身份与 manifest，供休眠实现保持确定性；当前 Web 不引用该 manifest、不初始化 TON Connect，也不把其图标是否正式替换作为 MVP 发布阻塞。

## 依赖方向

```text
apps/web -> @pokepets/api-contracts/app
api -> apps/api/entrypoints
apps/api/entrypoints -> gateway-specific contracts + http
apps/api/http -> injected route registry + handler map
apps/api/domains -> one api schema RPC per handler
apps/api/workflows -> domain capabilities + platform adapters
api schema RPC -> private database schemas
contracts/ton -> TON blockchain
```

禁止反向依赖、跨领域深层导入、浏览器访问 Supabase Data API、Node 层组合多次资产写入。浏览器对 `pet-runtime` 公开对象的图片 GET 是唯一 Supabase 直连例外。

TMA 首次同步加载只覆盖应用壳、会话与账号门禁及默认开盒页；首屏完成后后台预加载其余普通主导航页面。`/game` 固定承载 React + TypeScript Battle，不引入 Phaser；Battle 只有在游戏页可见或当前 session 需要恢复 Battle participation/当场终局结果时读取专属状态，邀请 waiting 的创建者展示心跳和 lobby 的双方 presence 心跳只在页面可见时发送。隐藏、Telegram deactivated、`pagehide` 或离开 `/game` 立即结束当前 lease、中止在途 heartbeat 并尽力 offline；恢复先读取权威快照并取得新 lease，进入 `active_turn` 后停止 presence。

五个主导航页面在当前登录会话内首次访问后保持挂载。切换页面只恢复各自滚动、筛选和页内状态，同时按 [ADR-037](adr/ADR-037-persistent-page-query-activity.md) 暂停隐藏页面查询；切页前已开始的读取允许完成。返回页面时，新鲜且未失效的缓存不读取，超过 20 秒或被业务刷新范围标记失效的查询按键回正一次；已有缓存回正失败时保留内容并显示非阻塞重试。业务结果把契约范围全部标记失效，只立即刷新当前页面和全局活动查询；后台连续五分钟后回到前台只静默回正顶部摘要与当前页面。交易页按 [ADR-029](adr/ADR-029-market-sold-device-inbox.md) 在可见期间每 10 秒同步本人挂售与新成交事件，当前设备只持久保存按内部用户隔离的事件游标和未隐藏 SOLD 提醒，并由同一待展示集合驱动“管理”页签红点。

## 可信边界

前端只提交动作、目标标识、数量、operation-backed 命令所需的幂等键，以及 Battle presence 意图所需的 lifecycle version、lease UUID 与 command sequence。价格、余额、库存、资格、奖励、Battle presence 终态、属性与技能数值、命中、伤害、行动顺序、胜负、结算、随机结果、任务进度和链上状态均由服务端重新校验，并由单个数据库事务裁决。

创建 operation 的玩家写请求以 UUID `Idempotency-Key` 作为 `operation_id`。数据库对规范化请求计算哈希；相同键和相同请求返回原结果，相同键和不同请求返回 `IDEMPOTENCY_KEY_REUSED`。Battle 只有创建、随机匹配、取消、接受和 `attack | switch | replace_attack` 行动属于这一范围；heartbeat/offline 不接收幂等键、不创建 operation，由数据库在 room-first 锁内先裁决 lifecycle version + lease UUID + command sequence，旧 lease、低版本、重复和乱序命令完全无副作用。Battle 结果展示不产生写请求。

会话令牌只在运行内存保存，绝对有效期 15 分钟。只有 `POST /api/auth/telegram` 接收 Telegram `initData`；成功登录固定执行验签前来源限流和验签后登录事务两个数据库 RPC。令牌是包含版本、session UUID 与 HMAC 的自定义 opaque bearer，Function 本地证明完整性后只把 `session_id` 传给业务 RPC。账号为 `banned` 时前端立即清空全部业务内容，只渲染空白界面。

## 数据库权限

内部 schema 对 `public`、`anon`、`authenticated` 和 `service_role` 撤销 schema、表、序列和函数权限。`service_role` 只获得 `api` schema 的使用权和显式 allowlist 函数的执行权，不能执行内部登录限流 helper。玩家 RPC 使用 `session_id` 最终验证会话存在、撤销、绝对过期、账号、入口交接和资源归属；常规认证没有独立会话解析 RPC。

`admin` 是数据库所有者专用的非 Data API 管理边界。受控 Battle 验收夹具只从该 schema 执行，默认没有项目身份或 enable 记录，不向 `service_role` 或任何应用角色授权；真实开发绑定、短期门禁、幂等 reconciliation、fixture-owned provenance 与只读状态遵循 [ADR-016](adr/ADR-016-controlled-battle-acceptance-fixture.md)。

## 操作恢复

前端内存操作阶段固定为 `confirming → submitting → pending/unknown → succeeded/failed`；数据库持久状态为 `pending`、`unknown`、`succeeded`、`failed`。随机结果和资产结果只生成一次，`unknown` 只查询原 `operation_id`。`identity.bootstrap` 同快照返回用户权威游标；`GET /api/operations/recoverable` 既发现转盘未决和进化规定状态，也只用不含结果内容的路由标记发现晚于首屏提交的任意 operation 终态。发现绑定可见、Telegram 激活和在线状态，恢复队列存在时暂停，清空后立即追赶；路由刷新范围全部标记失效且当前页面与全局活动查询成功后推进内存游标，隐藏页面不阻塞并在返回时回正。除进化专用回执外，开盒、转盘、分解和通用结果只在取得它们的当前前台运行期展示，“确定”“收下”或返回只处理 Web 内存展示，不发送结果 API、RPC、原操作查询或刷新；隐藏、刷新或重新进入后不恢复旧结果，只刷新权威页面状态。恢复注入的非进化 `pending`、`unknown` 只查询原操作，取得终态后静默回正并移除。进化在未决阶段锁定新提交和底部导航，终态由专用覆盖弹窗和服务端回执处理。Battle 创建、随机匹配、取消、接受和行动恢复原 operation 后必须读取 viewer-specific room snapshot；heartbeat/offline 只在当前 lease 内重试，生命周期结束后以权威快照申请下一版本 lease。普通 heartbeat/offline 结果只应用 room，确认退款终态才按路由契约刷新 Battle、顶部资产和 inventory。Battle 终局快照到达后立即执行三域回正，结果覆盖层等待动作表现队列清空，按钮只在内存返回首页；其他领域既有确认回执保持各自规则。

市场购买按 [ADR-030](adr/ADR-030-market-purchase-inline-progress.md) 在未决阶段只保留确认弹窗内的“购买中”按钮状态，不显示全局操作状态；当前前台运行期的权威刷新完成后才显示不含服务器、请求和 operation ID 的专用购买结果。离开前台后只恢复原 operation 与权威状态，不恢复旧购买结果弹窗。

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
- [开盒月夜灵契动画、结果舞台与展示门控](adr/ADR-021-gacha-moon-ritual-presentation.md)
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
