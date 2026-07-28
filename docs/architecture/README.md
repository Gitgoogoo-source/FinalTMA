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
- Blockchain：TON Connect 验证钱包，Tact 合约完成 NFT Mint。
- Deployment：Vercel Pro；真实开发环境与未来生产环境使用相同 Git commit 和 migration 序列。

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

TMA 首次同步加载只覆盖应用壳、会话与账号门禁及默认开盒页；首屏完成后后台预加载其余普通主导航页面。`/game` 固定承载 React + TypeScript Battle，不引入 Phaser；Battle 只有在游戏页可见或当前 session 需要恢复 Battle participation/未确认结果时读取专属状态，邀请 waiting 的创建者展示心跳和 lobby 的双方 presence 心跳只在页面可见时发送，进入 active 战斗后停止。

五个主导航页面在当前登录会话内首次访问后保持挂载。切换页面只恢复各自滚动、筛选和页内状态，不触发查询或资源重载；业务结果按契约范围精确刷新，后台连续五分钟后回到前台只静默回正顶部摘要与当前页面。

## 可信边界

前端只提交动作、目标标识、数量和 operation-backed 命令所需的幂等键。价格、余额、库存、资格、奖励、Battle 属性与技能数值、命中、伤害、行动顺序、胜负、结算、随机结果、任务进度和链上状态均由服务端重新校验，并由单个数据库事务裁决。

创建 operation 的玩家写请求以 UUID `Idempotency-Key` 作为 `operation_id`。数据库对规范化请求计算哈希；相同键和相同请求返回原结果，相同键和不同请求返回 `IDEMPOTENCY_KEY_REUSED`。Battle 只有创建、取消、接受、正常动作和强制换宠属于这一范围；heartbeat、offline 和 acknowledge 不接收幂等键、不创建 operation，分别由单调服务端时间、幂等离线状态转换和首次确认时间写入实现数据库语义幂等。

会话令牌只在运行内存保存，绝对有效期 15 分钟。只有 `POST /api/auth/telegram` 接收 Telegram `initData`。账号为 `banned` 时前端立即清空全部业务内容，只渲染空白界面。

## 数据库权限

内部 schema 对 `public`、`anon`、`authenticated` 和 `service_role` 撤销 schema、表、序列和函数权限。`service_role` 只获得 `api` schema 的使用权和其中函数的执行权。玩家 RPC 使用 `session_id` 再次验证会话、账号和资源归属。

## 操作恢复

前端内存操作阶段固定为 `confirming → submitting → pending/unknown → succeeded/failed`；数据库持久状态为 `pending`、`unknown`、`succeeded`、`failed`。随机结果和资产结果只生成一次，`unknown` 只查询原 `operation_id`。开盒与转盘从提交前反馈到结果确认完成持续锁定领域操作和底部导航；进化在未决阶段锁定新提交和底部导航，终态由专用覆盖弹窗处理；Battle 创建、取消、接受、正常动作和强制换宠恢复原 operation 后必须读取 viewer-specific room snapshot，终局只恢复最新未确认当场结果。Battle heartbeat、offline 和 acknowledge 直接重试原 room 语义，不进入 operation 恢复。其余命令只阻止同一 `use_case` 再次提交。开盒、转盘、进化及 Battle 当场结果在服务端确认展示前持续恢复，确认时间由当前用户的领域专用 RPC 原子记录。

## 生成物

- `generated/catalog/catalog-v1.json`
- `generated/battle/battle-v1.json`
- `packages/api-contracts/openapi/openapi.json`
- `supabase/migrations/*_baseline.sql`
- `supabase/migrations/*_product_data_v1.sql`
- `supabase/migrations/*_api_security.sql`
- `apps/web/public/tonconnect-manifest.json`

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
