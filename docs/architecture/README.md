# PokePets 系统总览

## 事实来源

`docs/product/功能说明文档.md` 的全部章节是唯一产品功能来源。`PRODUCT_DATA_CHECKSUM_BOUNDARY` 上方第 1—20 章由 Catalog v1 数据生成器解析；下方第 21 章 Battle 是产品扩展，不进入 Catalog v1 migration 或 manifest。Battle 的金额、时限、状态、DTO、错误与公共接口只引用第 21 章或正式契约。

已发布 Catalog v1 的 immutable `product_checksum` / release identity 固定为：

```text
de521f2687086cb358fb557a4a7ada3bc3c5fc132d673f0256b4573028ddba46
```

该值不是当前产品文档全文 SHA。生成器另计算并打印 boundary 上方源文档 SHA-256，仅用于诊断；Catalog v1 release identity 必须同时与 tracked manifest 和 product-data migration 一致。架构文档只记录技术边界，不复制价格、概率、奖励或产品状态规则。

## 运行时

- Web：React、Vite、TypeScript，运行在 Telegram Mini App。
- API：同一 Vercel Project 内的 `app`、`integrations`、`jobs` 三个 Node.js 24 Function 网关。
- Database：Supabase Postgres 17，仅暴露 `api` schema；浏览器不加载 Supabase SDK。
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

禁止反向依赖、跨领域深层导入、浏览器访问 Supabase、Node 层组合多次资产写入。

TMA 首次同步加载只覆盖应用壳、会话与账号门禁及默认开盒页；首屏完成后后台预加载其余普通主导航页面。`/game` 固定承载 React + TypeScript Battle，不引入 Phaser；Battle 只有在游戏页可见或当前 session 需要恢复 Battle participation/当场终局结果时读取专属状态，邀请 waiting 的创建者展示心跳和 lobby 的双方 presence 心跳只在页面可见时发送。隐藏、Telegram deactivated、`pagehide` 或离开 `/game` 立即结束当前 lease、中止在途 heartbeat 并尽力 offline；恢复先读取权威快照并取得新 lease，进入 `active_turn` 后停止 presence。

五个主导航页面在当前登录会话内首次访问后保持挂载。切换页面只恢复各自滚动、筛选和页内状态，不触发查询或资源重载；业务结果按契约范围精确刷新，后台连续五分钟后回到前台只静默回正顶部摘要与当前页面。交易页按 [ADR-029](adr/ADR-029-market-sold-device-inbox.md) 在可见期间每 10 秒同步本人挂售与新成交事件，当前设备只持久保存按内部用户隔离的事件游标和未隐藏 SOLD 提醒，并由同一待展示集合驱动“管理”页签红点。

## 可信边界

前端只提交动作、目标标识、数量、operation-backed 命令所需的幂等键，以及 Battle presence 意图所需的 lifecycle version、lease UUID 与 command sequence。价格、余额、库存、资格、奖励、Battle presence 终态、属性与技能数值、命中、伤害、行动顺序、胜负、结算、随机结果、任务进度和链上状态均由服务端重新校验，并由单个数据库事务裁决。

创建 operation 的玩家写请求以 UUID `Idempotency-Key` 作为 `operation_id`。数据库对规范化请求计算哈希；相同键和相同请求返回原结果，相同键和不同请求返回 `IDEMPOTENCY_KEY_REUSED`。Battle 只有创建、随机匹配、取消、接受和 `attack | switch | replace_attack` 行动属于这一范围；heartbeat/offline 不接收幂等键、不创建 operation，由数据库在 room-first 锁内先裁决 lifecycle version + lease UUID + command sequence，旧 lease、低版本、重复和乱序命令完全无副作用。Battle 结果展示不产生写请求。

会话令牌只在运行内存保存，绝对有效期 15 分钟。只有 `POST /api/auth/telegram` 接收 Telegram `initData`。账号为 `banned` 时前端立即清空全部业务内容，只渲染空白界面。

## 数据库权限

内部 schema 对 `public`、`anon`、`authenticated` 和 `service_role` 撤销 schema、表、序列和函数权限。`service_role` 只获得 `api` schema 的使用权和其中函数的执行权。玩家 RPC 使用 `session_id` 再次验证会话、账号和资源归属。

`admin` 是数据库所有者专用的非 Data API 管理边界。受控 Battle 验收夹具只从该 schema 执行，默认没有项目身份或 enable 记录，不向 `service_role` 或任何应用角色授权；真实开发绑定、短期门禁、幂等 reconciliation、fixture-owned provenance 与只读状态遵循 [ADR-016](adr/ADR-016-controlled-battle-acceptance-fixture.md)。

## 操作恢复

前端内存操作阶段固定为 `confirming → submitting → pending/unknown → succeeded/failed`；数据库持久状态为 `pending`、`unknown`、`succeeded`、`failed`。随机结果和资产结果只生成一次，`unknown` 只查询原 `operation_id`。转盘和进化晚于首屏提交的记录只由 `GET /api/operations/recoverable` 一次发现；发现绑定可见、Telegram 激活和在线状态，结果队列存在时暂停，清空后立即追赶。开盒结果只在当前前台运行期展示，确认与导航按钮不发送结果 API；隐藏、刷新或重新进入后不恢复旧结果，只刷新权威页面状态。开盒在当前运行期从提交前反馈到结果弹窗关闭持续锁定领域操作和底部导航；转盘持续锁定至结果回执完成；进化在未决阶段锁定新提交和底部导航，终态由专用覆盖弹窗处理。Battle 创建、随机匹配、取消、接受和行动恢复原 operation 后必须读取 viewer-specific room snapshot；heartbeat/offline 只在当前 lease 内重试，生命周期结束后以权威快照申请下一版本 lease。普通 heartbeat/offline 结果只应用 room，确认退款终态才按路由契约刷新 Battle、顶部资产和 inventory。Battle 终局快照到达后立即执行三域回正，结果覆盖层等待动作表现队列清空，按钮只在内存返回首页；其他领域既有确认回执保持各自规则。

## 生成物

- `generated/catalog/catalog-v1.json`
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
- [进化顶层底部确认弹窗](adr/ADR-012-evolution-bottom-sheet-confirmation.md)
- [登录会话内页面保活与事件驱动刷新](adr/ADR-013-session-page-lifecycle.md)
- [Battle 数据库权威与规则快照](adr/ADR-014-battle-authority-and-ruleset.md)
- [Battle 实时失效通知、调度与 outbox](adr/ADR-015-battle-realtime-and-scheduler.md)
- [受控 Battle 验收夹具数据库边界](adr/ADR-016-controlled-battle-acceptance-fixture.md)
- [TON 生成绑定与静态门禁](adr/ADR-017-ton-generated-bindings.md)
- [Battle 平台条件型分享证据与发布门禁](adr/ADR-018-battle-share-platform-conditional-evidence.md)
- [Telegram 原生顶部控件安全区回退](adr/ADR-019-telegram-fullscreen-content-safe-area-fallback.md)
- [Battle 对战视觉作用域与首页像素动画](adr/ADR-020-battle-presentation-scope.md)
- [开盒连续召唤演出、结果汇总与展示门控](adr/ADR-021-gacha-moon-ritual-presentation.md)
- [全局顶层业务弹窗](adr/ADR-023-global-modal-layer.md)
- [开盒稀有度代表静态资源](adr/ADR-024-gacha-rarity-representatives.md)
- [Battle active 宠物原子切换](adr/ADR-025-battle-active-switch-atomicity.md)
- [Battle 服务端终局与当场结果展示](adr/ADR-026-battle-server-finalized-result-presentation.md)
- [Battle 公开匹配数据库事务](adr/ADR-027-battle-public-matchmaking-transaction.md)
- [Battle 请求阶段化结构日志](adr/ADR-028-battle-request-observability.md)
- [市场成交事件游标与当前设备 SOLD 收件箱](adr/ADR-029-market-sold-device-inbox.md)
