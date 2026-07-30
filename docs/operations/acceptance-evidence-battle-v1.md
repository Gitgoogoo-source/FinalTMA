# Battle v1 真实开发环境交付与验收证据（2026-07-27）

> 2026-07-28 本地语义收敛说明：本文以下证据只对应其原记录的历史提交与当时已部署的八状态 Battle，不证明双人 lobby 新规则已经在真实环境生效。当前本地实现新增 `lobby_waiting/lobby_countdown`、双方 participant presence、5 分钟总时限和数据库 3 秒开战倒计时；仍须在同一提交完成真实开发环境数据库从零重建、部署、Telegram 双端与并发验收后，另行追加真实证据。本文历史 PASS、部署记录和 SHA 保持原样，不据本地静态结果改写。

## 结论

Battle v1 的产品数据、数据库裁决、API、Telegram 分享集成、Ably 集成、React Web、真实开发数据库重建和 Vercel Production 部署已经完成。当前总体验收结论仍为 `未完成`：数据库重建后没有真实用户、会话或 Battle room，四账号 Telegram 对战矩阵、真实 Ably 房间消息链路、完整战斗规则矩阵和性能指标尚未形成真实环境证据。

本文件只记录已经取得的证据，不使用静态门禁、空库探针或伪造数据代替真实 Telegram、Supabase、Vercel、Ably 和多账号验收。

## 2026-07-31 Battle R08 缺陷确认

在提交 `a393c64c900e4d5dfe3c662c0375793aec311f79` 对应的指定 Production 部署上，使用同一真实 Telegram Web Mini App 会话完成以下独立复现：

1. 创建 20 K-coin 房间 A，通过 Telegram 原生分享面板把挑战卡真实发送到私聊；Telegram 显示发送完成，等待页显示“挑战卡已发送，房间继续等待首位有效对手”。
2. 通过等待页正常取消房间 A，服务端确认退款后页面回到 Battle 首页，可用 K-coin 回到夹具目标值。
3. 不关闭 Mini App、不重新认证，在同一会话创建新的 20 K-coin 房间 B；房间 B 尚未点击“分享挑战卡”，等待页已经显示房间 A 的“挑战卡已发送”反馈。
4. 房间 B 当时的脱敏数据库快照为：room `waiting`、`state_version = 3`、prepared share `active`、准备尝试 1 次；房间创建后当前创建者的 `share` 限流记录为 0，accept operation 为 0，本房间未发布 outbox 为 0，开放一致性违规为 0。
5. 随后通过正常取消入口终结房间 B 并确认退款，没有使用 SQL 修改业务表回正。

该序列结论为 `FAIL`，只证明跨房间分享反馈残留缺陷真实存在，不代表完整 Telegram 分享矩阵或修复后回归已经通过。静态审查确认当时 Web 把分享反馈保存为仅随 session generation 清空的组件级字符串；反馈没有 room ID，且 Telegram 全局 sent/failed 事件在当前 waiting room 未发起本房间分享时也可写入该字符串。

## 发布对象

- 环境：真实开发 Supabase `final-tma-real-test / ebewtjerusxcioegpzjd`。
- Vercel Project：`final-tma`，Production alias 为 `https://final-tma-pi.vercel.app`。
- Battle 功能代码与 migration 基线：`b5460d925ed148ff9f951ca4ffda0cf19bcf2f4b`。
- Vercel deployment：`dpl_Fbg1EetwSX9YYVRanNCWrMMx7P2p`，状态 `READY`。
- 部署 URL：`https://final-qa68n0po7-googoos-projects-4fca1021.vercel.app`。
- Vercel deployment Git SHA：`b5460d925ed148ff9f951ca4ffda0cf19bcf2f4b`，与 Battle 功能代码基线一致。
- Battle ruleset：`battle-v1`。
- Battle 产品数据 checksum：`f060faba1f2a6056dd20b226fd719b4ed703d3987bf435a14fea9f9aeefeb05e`。

## 本地静态门禁

以下门禁在 Battle 功能代码基线通过：

| 门禁                      | 结果 |
| ------------------------- | ---- |
| `pnpm product-data:build` | PASS |
| `pnpm product-data:check` | PASS |
| `pnpm contracts:openapi`  | PASS |
| `pnpm validate:static`    | PASS |
| `git diff --check`        | PASS |

`validate:static` 覆盖 format、lint、TypeScript、契约/OpenAPI、数据库声明式 Schema 与 migration 同步、架构约束和生产 build。项目没有新增本地功能 test 代码，也没有用本地功能测试代替真实环境验收。

本地数据库 lint 仅保留 `api.inventory_evolution_preview` 的两条既有非阻断警告；本次 Battle 变更没有新增数据库 lint 错误。

## 原始 migration 与空库重建

最终三条原始 migration 及 SHA-256：

| 顺序 | migration                            | SHA-256                                                            |
| ---- | ------------------------------------ | ------------------------------------------------------------------ |
| 1    | `20260719104533_baseline.sql`        | `4530917f9ed10fff6a5af669d38116b8d681a4b952c84989fd3529ed7152363a` |
| 2    | `20260719104602_product_data_v1.sql` | `1493880196ce2b6632ded42e8fc1b498bd3c5e4138d336fac025922dc7e3a6bb` |
| 3    | `20260719104614_api_security.sql`    | `0549a10cddd0ed81c3c572e6f04fd279658311b4ef5cf35bc7db330d0895e048` |

`supabase db reset --linked` 在执行任何数据库变更前被当前执行环境的直连 PostgreSQL TLS/DNS 限制阻断。随后通过已认证的 Supabase SQL 管理通道完成等价的从零重建：

1. 删除项目自有业务 Schema，并移除 `pg_cron`、`pg_net`。
2. 清空 `supabase_migrations.schema_migrations`。
3. 严格按文件顺序执行以上三条原始 migration。
4. 只写回以上三个原始版本和名称，没有创建第四条补丁 migration。
5. Battle 数据库修复后再次执行同一完整重建，最终远程 migration history 精确包含这三个版本。

最终扩展状态：

| 扩展             | 结果                                                |
| ---------------- | --------------------------------------------------- |
| `pg_cron`        | 已安装                                              |
| `pg_net`         | 已安装到 `extensions` Schema，`net` API Schema 存在 |
| `supabase_vault` | 已安装                                              |
| `pgcrypto`       | 已安装                                              |

四个扩展均使用默认版本的 `CREATE EXTENSION`，migration 不包含版本子句。

## Battle 数据与数据库裁决

空库重建后的权威数据：

| 数据                           | 数量或结果                                                         |
| ------------------------------ | ------------------------------------------------------------------ |
| Catalog templates              | 210                                                                |
| Battle template configurations | 210                                                                |
| Entry tiers                    | 3                                                                  |
| Element matchups               | 25                                                                 |
| Skill slots                    | 10                                                                 |
| Skills                         | 50                                                                 |
| AI profiles                    | 14                                                                 |
| AI loadouts                    | 56                                                                 |
| Evolution chains               | 70                                                                 |
| Active ruleset checksum        | `f060faba1f2a6056dd20b226fd719b4ed703d3987bf435a14fea9f9aeefeb05e` |
| Battle rooms                   | 0                                                                  |
| Battle outbox events           | 0                                                                  |

数据库已包含 Battle 权威状态机、三档入场资金、库存 reservation、创建/接受/取消/超时竞争、秘密行动、主动与强制换宠、同时攻击、20 回合终局、作废退款、结算、审计链、viewer-specific 响应裁剪和 outbox。

空库结构与权限核验结果：

- 所有项目业务表均启用 RLS。
- `anon`、`authenticated` 和 `service_role` 均没有业务表直接 DML 权限。
- `anon` 与 `authenticated` 没有项目 API RPC execute 权限。
- `service_role` 只有声明式 allowlist 内的项目 API RPC execute 权限。
- Supabase Security Advisor 没有 `WARN` 或 `ERROR`；剩余 78 条 `INFO / rls_enabled_no_policy` 与拒绝客户端数据库直连的外围 RLS 设计一致。
- Supabase Performance Advisor 没有 `WARN` 或 `ERROR`；空库仍有 50 条未索引外键和 34 条未使用索引 `INFO`，不作为运行性能通过证据。

## 密钥与 Vault

以下配置已存在并被真实集成请求使用；本文件不记录值、邀请 token 或私有随机种子：

| 位置           | 配置                         | 结果                                              |
| -------------- | ---------------------------- | ------------------------------------------------- |
| Vercel         | `ABLY_API_KEY`               | 已配置                                            |
| Vercel         | `BATTLE_INVITE_SECRET`       | 已配置为 32 字节随机秘密                          |
| Vercel         | `BATTLE_OUTBOX_SECRET`       | 已配置为 32 字节随机秘密                          |
| Supabase Vault | `battle_outbox_callback_url` | 指向 Production `/api/integrations/battle-outbox` |
| Supabase Vault | `battle_share_callback_url`  | 指向 Production `/api/integrations/battle-share`  |
| Supabase Vault | `battle_outbox_secret`       | 与 Vercel `BATTLE_OUTBOX_SECRET` 一致             |

Telegram webhook 继续使用 Telegram secret header。Battle share 与 outbox integration 使用独立的 `Authorization: Bearer BATTLE_OUTBOX_SECRET`。

## 定时任务、回调与运行证据

### Supabase Battle tick

- 只存在一个启用的 `battle-tick-v1`。
- Schedule 为 `1 second`。
- Command 为 `select battle.process_due(100);`。
- 连续 60 秒样本取得 58 次运行，58 次成功、0 次失败。
- 样本最大执行时间为 0.028 秒。

该样本证明每秒任务在空房间环境持续运行，不证明 deadline 后 2 秒内托管、并发房间分批或故障追赶性能。

### Vercel jobs

| Job                            | HTTP | request_id                             | 数据库结果               |
| ------------------------------ | ---- | -------------------------------------- | ------------------------ |
| `/api/jobs/reconcile-payments` | 200  | `9b629748-4135-4df6-a874-5388c1995a36` | `succeeded`，processed 0 |
| `/api/jobs/monitor-invariants` | 200  | `349e06b2-5885-4328-9c8f-d1267a1de85a` | `succeeded`，processed 0 |

数据库开放 invariant violation 数量为 0。`cleanup-idempotency` 的每日 schedule 在本次验收窗口内没有到点，且没有使用敏感 `CRON_SECRET` 手工伪造调用，因此尚未形成该 job 的真实运行证据。

### Vault → pg_net → Vercel

最终部署后使用 Vault URL 和 Vault secret 触发两条真实 `pg_net` 请求：

| Integration   | pg_net request | HTTP | Vercel request_id                      | elapsed |
| ------------- | -------------- | ---- | -------------------------------------- | ------- |
| Battle outbox | 3              | 200  | `eed01422-ccf0-4af2-8cb3-4d0a98fcb1fa` | 429 ms  |
| Battle share  | 4              | 200  | `240e7a24-e172-4fc8-9327-ffc5b19537c2` | 358 ms  |

这组证据证明 Vault、`pg_net`、Bearer 鉴权和两个 Vercel integration route 连通，不证明真实 prepared inline message 创建或真实 Ably room 发布。

## HTTP 与认证边界

| 请求                                     | 实际结果               | request_id                             |
| ---------------------------------------- | ---------------------- | -------------------------------------- |
| `GET /api/health`                        | 200 `ok`               | `a3713ce8-ee70-4ac4-8f21-10057d5ae673` |
| `GET /game`                              | 200 HTML               | 不适用                                 |
| 未认证 `GET /api/battle/bootstrap`       | 401 `SESSION_REQUIRED` | `b349abef-c358-490c-a468-f8992e691148` |
| 未认证 `GET /api/battle/team-options`    | 401                    | `01217b48-a956-4a7b-8384-3412cc33befb` |
| 未认证 `GET /api/battle/invites/current` | 401                    | `b8188f18-8181-4301-b2b6-af1f7103ed59` |

最终部署最近 30 分钟 Vercel runtime 日志没有 5xx。

Supabase publishable key 与 legacy anon key 访问项目 Data API 均返回 401 `UNAUTHORIZED_INVALID_API_KEY_TYPE`，错误说明该 endpoint 只接受 `service_role` API key，证明客户端 key 的网关封锁有效。Supabase Dashboard 的 Data API Settings 页面要求重新登录，当前只读核验没有输入或读取用户凭据，因此精确的 `Exposed schemas` 列表尚未形成直接证据。

## 已交付的 Battle 接口与 Web

已部署的玩家接口覆盖：

- Battle bootstrap、team options、当前邀请和参与者 room snapshot。
- 创建、取消、接受、行动、强制换宠、等待心跳、离线、结果确认和 realtime token。
- 五类业务命令使用 UUID `Idempotency-Key`；heartbeat、offline 和 acknowledge 拒绝该 header 并使用数据库语义幂等。
- Battle 登录入口只处理 `BTL_` token hash，不触发推荐绑定。
- inventory DTO 包含 `battling`，topup intent 包含 `battle_create` 和 `battle_accept`。

已部署的 React Battle Web 覆盖 `home`、`team_select`、`preparing_share`、`waiting`、`accept`、`battle`、`forced_switch` 和 `result`。交互先展示非成功性的即时反馈，伤害、命中、换宠、击倒和结果只消费服务端 resolution event；倒计时使用 `server_time`、`deadline` 和 `state_version`；Ably 只触发 REST refetch，断线使用 1—2 秒短轮询；等待心跳受 `/game`、页面可见和 Telegram WebView active 三重约束；离开时发送 authenticated best-effort offline；页面支持充值恢复、session 恢复、结果确认和 `prefers-reduced-motion`。

前端没有 Phaser、浏览器战斗模拟器、history、replay、spectator、surrender、matchmaking、PVE 或捕捉入口。

## 尚未形成的真实验收证据

以下项目必须在数据库重新产生真实 Telegram 用户、会话和 Battle room 后执行，不能以直接插入 fixture、mock 用户、静态检查或空库探针替代：

1. 四个真实 Telegram 账号完成私聊、普通群、超级群、跨群转发、创建者自我接受和多人并发接受。
2. Bot API `getMe`、菜单入口、Main Mini App、named Mini App 和真实 Battle `startapp` 登录；Battle 入口不产生推荐候选。
3. Telegram prepared inline message、`shareMessage`、60 秒未知结果恢复和退款 saga。
4. 89 秒重连、90 秒取消、30 分钟到期、显式离开、后台、断网和等待心跳。
5. 三档入场资金、双方 lock、胜负结算、平台手续费、平局和 `voided` 退款，以及 reservation 与出售、成交、分解、进化、远征和 Mint 的竞争。
6. 五属性倍率、十种命中边界、优先级、速度、完全相同的同时攻击、先手击倒、主动换宠、强制换宠、连续托管、双方同时全灭和第 20 回合全部终局。
7. 五种 viewer-specific DTO 的逐字段隐私证据，以及 JSON、HTML、Ably、日志和分析事件均不泄露秘密字段。
8. Ably 2.26.0 的真实 token mint、subscribe-only capability、当前用户/房间/邀请频道授权、四字段 invalidation、outbox 发布与重投、重复乱序处理和断线 REST 回正。
9. 动作提交 p95 ≤ 800 ms、deadline 后 2 秒内托管、Ably 通知 p95 ≤ 1 秒、Ably 中断后 2 秒内 REST 回正。
10. Vercel 重启、单次 `pg_net` 失败、cron 短暂停止后的同一 deadline、outbox 与 settlement 恢复。
11. `cleanup-idempotency` 每日 job 的真实触发、租约与运行记录。
12. Supabase Dashboard 中 Data API `Exposed schemas` 的直接只读截图或导出证据。

在以上真实证据全部通过前，Battle v1 不能标记为完整验收或上线完成。
