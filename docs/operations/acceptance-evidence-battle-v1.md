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

## 2026-07-31 Battle R09 并发接受缺陷确认

在提交 `9c89072f6ba83e535adf0d18f47909b790e3a449` 对应的 Production 上，A 创建并向普通群真实分享 20 K-coin 挑战，B/C/D 三个真实 Telegram 账号选择各自三只固定藏品后并发执行最终接受。三个 operation 的调度窗口为 528.549 ms：B 的 HTTP 200 / operation `succeeded` 是唯一成功，数据库只有 A+B 两个 participant、两份 20 K-coin stake 和双方各三份 Battle reservation；C/D 各自为 HTTP 409 / `BATTLE_ROOM_ALREADY_ACCEPTED`，没有 participant、stake、reservation 或资产变化。

B 的成功 operation 已返回 opponent 视角的 `lobby_waiting` 快照，后续 room 读取与 heartbeat 也成功，顶部可用余额为 480；但 B/C/D 三端当时都显示“挑战已被其他玩家接受”。该序列结论为 `FAIL`：真实赢家的权威 room 已存在，Web 却在 `derivePageState` 中先处理 `battleEntry`，使邀请刷新的 `accepted` 状态遮盖 lobby/current-room。

创建者离线后，该房间通过正常 Lobby 重连超时取消并完成双方退款，四角色资产、locked stake 与 Battle reservation 全部回正。本轮同时确认既有 invariant SQL 对没有 turn 的 lobby 执行 `LEFT JOIN`时，把全空的 turn 复合行计为 1 个 unresolved turn，因而错误产生 1 条 `BATTLE_ROOM_STATE_MISMATCH`。该监控误报不改变接受或资产裁决，但会阻断验收终态；用户已明确授权本任务同步修正原始数据库定义并从空真实开发库重建。本节不把未执行的修复后并发回归记为 PASS。

## 2026-07-31 Battle R09 修复后并发接受影响域回归

提交 `de2a6bcbb532efd85ff641fd2af64d05c766502e` 由 Git Integration 发布为 Production deployment `dpl_631Q9jmXdTj8Xu1DYUUto4iKywV4`；deployment 为 `READY`，source SHA 与提交一致，稳定入口 `https://final-tma-pi.vercel.app` 指向该部署。A 在电脑端 Telegram 创建并向普通群真实分享 20 K-coin 挑战，B/C/D 分别在 Chrome、Safari 和 QQ 浏览器的真实 Telegram Web Mini App 选择三只固定藏品并停在最终确认按钮前。

三个最终 UI 动作在同一调度点触发，客户端调用窗口为 1.799 ms；服务端 accept operation 落库窗口为 875.122 ms。结果如下：

| 角色 | HTTP / operation                         | 数据库与资产                                                                 | 真实 UI                             |
| ---- | ---------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| B    | HTTP 200；`battle.accept` 为 `succeeded` | 唯一接受者；与 A 各锁定一次 20 K-coin stake 和三份 reservation；可用余额 480 | 进入权威 current-room，没有显示冲突 |
| C    | HTTP 409；`BATTLE_ROOM_ALREADY_ACCEPTED` | 无 participant、stake、reservation 或资产变化；余额 500                      | 显示“挑战已被其他玩家接受”          |
| D    | HTTP 409；`BATTLE_ROOM_ALREADY_ACCEPTED` | 无 participant、stake、reservation 或资产变化；余额 100                      | 显示“挑战已被其他玩家接受”          |

数据库只有 A+B 两个 participant、两份 20 K-coin stake、双方各三份 active reservation 和一个成功 accept operation；没有重复 participant、stake、reservation、成功 operation、未发布 outbox、pending/unknown operation 或开放 violation。B 关闭 Mini App 后从同一挑战卡重新进入，页面再次恢复权威 current-room、余额仍为 480，冲突文案数量为 0，证明邀请刷新和页面生命周期没有把赢家覆盖为失败者结果。

本轮创建者 Mini App 在接受时仍在线，因此权威状态从 lobby 正常进入战斗；本任务没有据此验收 Lobby 或战斗规则。双方随后关闭 Mini App，房间由 `battle-tick-v1` 沿正常权威路径在第 16 回合进入 `finished`；该终态只用于安全释放，不记作战斗规则 PASS。终态后 active reservation、locked stake、活动房间、未发布 outbox、开放 operation 和 violation 均为 0。真实结算使 A 获得 16 K-coin 净收益；用户明确授权后，通过带 ledger 审计的 `economy.change_balance` RPC 与正式 `admin.reconcile_battle_fixture` 单事务恢复验收基线，没有直接更新业务表。最终 A/B/C 为 500 K-coin、D 为 100 K-coin，每角色 3 个固定模板和 4 只宠物，fixture provenance 与聚合余额一致，夹具门禁关闭；最近 9 个自然 tick 全部成功。

该影响域回归结论为 `PASS`，只覆盖同房间三接受者并发裁决、赢家 UI/current-room 恢复、两个失败者固定冲突、直接页面生命周期和终态回正；不覆盖普通群、超级群、跨群转发、自接受、完整分享矩阵、Lobby 规则、经济矩阵或战斗规则。

## 2026-07-31 Battle R10 历史终态结果确认修复与影响域回归

在提交 `7903bf5a5c6068d979cd1469613cb195cfa000e9` 对应的 Production deployment `dpl_68vFDJJfGxDdJeVAoRa1n5fCkVDe` 上，A、B 的同一场 Battle 均已完成权威结算与资产回正：数据库 room 与 participant 为 `finished`、`state_version = 44`，双方各保留一条未确认 `current_result`，但当前 active participation、locked stake、Battle reservation 和未发布 outbox 均为 0。两端真实 Mini App 都恢复出权威结果覆盖层；点击“确认并返回 Battle 首页”后只显示“当场结果仍在完成权威资产回正，请重试确认”，没有发出 acknowledge，请求前后数据库未确认结果均保持 1 条。

独立链路审查确认，`current_result` DTO 是权威结果恢复入口，但当时终态协调器只从当前 room/participation 建立带 `state_version` 的 observation。只有 `current_result` 时，`prepareAcknowledgement` 因不存在 active observation 在任何权威刷新或 acknowledge 请求之前永久返回 `false`。服务端参与者专属 room 读取仍可验证结果归属并返回同一终态 room 与版本，`api.battle_acknowledge_result` 也已验证 session、participant、房间终态并以首次确认时间幂等写入，因此缺陷限定在 Web 终态恢复生命周期，不涉及 API、DTO、RPC、数据库结构或结算规则。

提交 `317b976e657be5db5a3a2892a7932afb5b5cab95` 复用参与者专属 room 读取：只有 Battle bootstrap 或 identity bootstrap 仍证明同一未确认 room 时，才恢复终态 `status + state_version`，随后继续执行 Battle、identity、inventory 三域稳定刷新；任一权威门禁失败、room 非终态、结果消失或版本变化仍保持可重试覆盖层。Git Integration 将该提交发布为 Production deployment `dpl_AqpmtncPpNZe9o32hCENPmBdX9US`，状态 `READY`，source SHA 与提交一致，稳定入口指向该部署。

新 Production 上，A 执行一次真实确认，B 对确认按钮执行快速双击；Vercel 共记录两次 acknowledge HTTP 200，A、B 各一次，B 的重复 UI 事件没有产生第二个请求。双方覆盖层均消失并返回 Battle 首页；关闭 Mini App、重新打开并重新进入 Battle 后，旧结果均未再次出现。数据库中双方最新 participant 各只有一个非空首次确认时间，Battle 与 identity 恢复入口均不再返回旧结果；确认窗口之后 A/B 没有新增 ledger，同一 room 没有新增 outbox。

最终 A/B/C/D 的 K-coin 分别为 500/500/500/100，locked K-coin 均为 0；每角色仍为 3 个固定模板、合计 4 只宠物。活动 room、active participant、locked stake、active Battle reservation、未发布 outbox、pending/unknown operation 和开放 violation 均为 0；fixture gate 关闭，`battle-tick-v1` healthy。远端 migration history 仍精确为三份原始 migration，Supabase 项目为 `ACTIVE_HEALTHY`。本轮没有修改数据库定义，因此没有重建数据库。

该影响域回归结论为 `PASS`，只覆盖只有 `current_result` 的历史终态恢复、终态版本与三域资产门禁、真实 acknowledge、重复点击、刷新/退出重进及确认后的系统终态；没有执行或重记三账号并发、Lobby、分享矩阵、经济矩阵或战斗规则验收。

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
