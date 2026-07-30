# 真实环境验收证据模板

每个场景复制一份，所有字段必填；截图和日志只保存引用，不提交敏感值。

```text
场景：
环境：development / production-smoke
Git commit：
Migration：填写 `supabase/migrations` 中按文件名排序的三条实际迁移及校验和
设备、Telegram 版本、浅色/深色：
开始时间（UTC）：
request_id：
operation_id：
幂等键指纹（不可记录原值）：
账本前值 / 后值：
库存前值 / reservation / 后值：
支付订单 / Telegram charge id（脱敏）：
Mint id / tx hash / NFT address：
Battle room / participant / state_version（脱敏）：
Battle ruleset / checksum：
Battle stake / settlement / outbox event（脱敏）：
预期：
实际：
服务端日志引用：
截图引用：
结论：PASS / FAIL
验收人：
```

## 必须覆盖的场景

执行 Telegram 登录场景前，先保存入口配置证据：Bot API `getMe.result.username` 必须等于当前环境 Bot，`getMe.result.has_main_web_app` 必须为 `true`，默认菜单按钮必须为 `web_app` 类型并指向当前环境 named Mini App 链接；随后只能从该 Bot 的 Main Mini App、菜单按钮或 named Mini App 链接启动，不得用浏览器直接访问部署 URL 代替 Telegram 真机验收。

- Telegram 登录：首次、再次和并发首次登录；同键同 `initData` 回放；同键不同请求拒绝；资料与头像更新；无参数默认开盒页；严格大写 TMA 推荐入口；合法 `BTL_` Battle 入口进入游戏页且不创建推荐候选；格式合法但房间无效、取消、接受或过期时继续登录并展示真实不可用状态；其他非空参数在建号前拒绝。
- Telegram 边界：签名伪造、机器人、恰好与超过 24 小时、恰好与超过未来 5 分钟；来源第 31 次、用户第 11 次和同 `initData` 第 4 次拒绝且页面不自动重试。
- 会话与封禁：15 分钟绝对失效、多个并发请求只恢复一次、恢复后的第二次失效、会话替换不恢复，以及初始和使用中封禁时 DOM、弹窗、导航、查询及迟到结果全部清空。
- 邀请前置交接：成功、老用户、已有关系、已有充值、自邀请、邀请码无效、邀请人不可用、候选超时、结果未知和 `OPERATION_NOT_FOUND` 原键单次重提；保存候选与操作的数据库前后状态。
- 首屏：`identity.bootstrap` 整体失败保留内存会话；VIP、钱包和默认开盒摘要分别失败时只关闭自身入口并可局部重试。
- 幂等：同键同请求回放、同键不同请求拒绝、重复点击、网络中断后只查询原操作。
- 资产业务：开盒、转盘、进化、分解、远征、Battle、任务、邀请和图鉴奖励的并发扣减与重复提交；开盒与转盘在提交后任意时点刷新、关闭、断网和重进均恢复原 `operation_id` 的单次或十次完整结果，服务端确认关闭前持续出现并锁定领域按钮与底部导航，确认后不再出现。转盘结果逐项核对有序奖励、固定扣款、K-coin 奖励返入、净变化、里程碑、免费资格、今日次数和最终资产；覆盖十连扣 180、返入 140、净 -40，以及 9 次单转合计扣 180、返入 100、净 -80，均不得误报为少扣款。
- 图鉴读取：保存 `album.get` 的 70 条链、每链 3 个节点以及汇总证据；链类型按 `normal/advanced/top` 分别精确为 40/20/10，节点总数为 210。构造只点亮同链第 2 阶、只点亮同链第 3 阶和点亮后库存归零三种状态，确认页面只使用节点级 `unlocked`，同时显示真实名称、稀有度、阶段和当前拥有总数。
- 图鉴筛选与交互：页面只有“全部、普通链、高级链、顶级链、可领取、未完成”六项并分别得到 70/40/20/10/当前可领取/当前未完成结果；已点亮节点先在图鉴内打开详情，点击“去藏品查看”后才进入藏品页并定位模板；未点亮节点的市场、开盒和第 2/3 阶进化入口分别定位目标模板、可产出稀有度的盲盒和同链上一阶材料，市场无在售与材料库存为 0 均展示真实空状态。
- 图鉴领取与恢复：普通链、高级链、顶级链分别验证 100/300/800 Fgems；点击礼物盒立即显示领取中且禁止重复点击。并发不同幂等键、同键回放、同键异请求、响应丢失、刷新全屏图鉴和查询原操作后，奖励最多到账一次，结果弹窗显示真实链名、奖励与操作号，`album.get`、顶部 Fgems 和礼物盒最终一致。
- 图鉴无障碍：仅用键盘完成返回、六筛选、210 个节点、详情关闭、三个获取入口和礼物盒领取；弹窗打开后焦点进入，Escape 或关闭按钮退出后焦点回原节点，读屏可读出节点名称、阶段、稀有度、点亮状态、当前数量及礼物盒状态，状态不只依赖颜色。
- 市场：购买页以 210 个正式模板为目录主表，零数量模板显示售罄，数量排除本人和 banned 卖家；已有 9 种时第 10 种成功，已有 10 种时第 11 种失败且同模板追加成功；管理页把同模板多条独立 FIFO 挂单聚合为一张卡片；按用户和模板全部下架与成交并发时只释放最终剩余 reservation，原键回放及新键重试无有效挂单均幂等成功且不重复释放；买家明细不含卖家身份。
- Stars：K-coin 付款前关闭立即取消且可重新创建，创建请求迟到不得打开 invoice，`processing/paid` 禁止关闭并在重进后恢复，同 charge 的相同或不同 update 重投只到账一次，取消/失败/过期与成功回调乱序时真实扣款仍唯一到账，invoice 创建失败不遗留开放操作，终态后无冷却立即再充值；同时覆盖金额、订单归属、幂等键篡改、退款、VIP 既有购买流程，以及 `battle_create`、`battle_accept` 充值后只恢复最新确认界面且绝不自动创建或接受。`battle_create` 补差在本人已有 `preparing_share/waiting/lobby/active` 任一参与事实时统一返回 `BATTLE_ALREADY_PARTICIPATING` 且不创建订单。
- TON：Proof、地址唯一、Mint 预留、提交未知、链上对账、超时释放和活跃 Mint 阻止断开钱包。
- Cron：Vercel job 的同时触发、重复触发、运行租约、漏跑追赶、失败记录和手工重跑；Supabase `battle-tick-v1` 在 migration 提交后独立 `pg_reload_conf()`，并以同一 jobid 至少两个连续自然周期证明每秒触发，保存 runid、起止时间、状态和返回摘要；验证 `battle.tick_health()`、advisory lock、`SKIP LOCKED` 分批、deadline 追赶、pg_net 唤醒、`BATTLE_TICK_UNHEALTHY`/`BATTLE_TICK_RUN_FAILED` 私有 violation、7 天运行明细保留及每日最多 100000 条清理。禁止手工调用或故障注入代替自然调度证据。
- 一致性：余额账本、库存预留、风险限制、服务器结果覆盖前端临时状态。
- 体验：所有资产操作在 API 返回前立即反馈；普通页面不等待 TON Provider；主导航不被无关操作锁定。
- 主导航页面保活：交易、游戏、开盒、藏品和任务分别首次进入一次，等待超过 React Query 的 20 秒 `staleTime` 后连续切换并返回；除 Battle 可见性规则外，网络记录不得因切页新增对应页面 API、页面模块、图片或其他页面专属资源请求，页签、筛选、选择、滚动位置和未提交界面状态保持。页面隐藏、Telegram deactivated、`pagehide` 或离开游戏页必须立即结束当前 lease、中止在途 heartbeat、停止 waiting/lobby 心跳和 Battle UI 轮询并尽力 offline；返回时立即 REST 回正并取得数据库认可的新 lease。进入 active 战斗后 presence 心跳必须停止。图鉴与 Mint 返回时恢复原主页面；顶部人工刷新只请求 `identity.bootstrap`、`vip.get`、`wallet.get`。后台不足五分钟恢复时不请求普通页面，Battle 仍执行自身可见性回正；达到五分钟时只静默刷新顶部摘要与当前路由查询。Session generation 改变或封禁后旧页面、缓存和迟到结果不得恢复。
- Telegram 容器手势：在 Telegram iOS 与 Android 的“交易 / 游戏 / 开盒 / 藏品 / 任务”五个主导航页及可滚动弹窗中，从内容区域向下滑动不会最小化或关闭 Mini App，页面纵向滚动保持可用；从 Telegram 标题栏执行最小化或关闭仍然有效。
- 全局顶部资产栏：五个主页只出现同一个资产栏；分别记录 Telegram iOS、Android、Desktop 与 Web 在原生全屏成功和不支持回退时的截图，确认设备安全区、内容安全区、视口与方向变化后，返回、关闭和更多控件始终位于资产栏上方且不重叠。
- 藏品图片：210 张正式母版对应 420 个公开版本；全部 URL 为 WebP、尺寸与路径正确、返回一年 immutable 缓存，列表只请求缩略图，藏品主图、单抽结果和 Mint 页面请求详情图。

## Battle 受控验收夹具

数据库从空重建后先确认 `admin.database_identity` 与 `admin.environment_controls` 均为空，`PUBLIC`、`anon`、`authenticated`、`service_role` 无 schema usage、表权限和函数 execute，Data API/OpenAPI/GraphQL 不发现 `admin` 对象。owner 绑定 `environment = real_development` 与当前 project ref，再写入最长 24 小时 enable。环境缺失、`local`/`production`、project ref 不匹配、enable 关闭、过期、未知 fixture、非四用户、重复用户、用户缺失或 `banned`、任一活动 Battle/locked KCoin/reservation/outbox/violation/市场/远征/Mint/支付/未决 operation、Catalog 或 Battle checksum 漂移必须拒绝，且 KCoin、holding、ledger、ownership、binding 与 run audit 保持调用前状态。不同 request UUID 交换或替换角色用户时，验证旧绑定只减少其尚存 fixture-owned 数量、新绑定按目标重建，旧用户非 fixture-owned 余额与宠物总量保持不变。

四个真实 Telegram 用户按 A/B/C/D 有序传入；不得创建虚假 Telegram 用户。首次执行后用 `admin.battle_fixture_status` 核对固定 KCoin、十二个模板、fixture-owned provenance、真实聚合、payload hash 和不可逆 run key。同一 request UUID 同 payload 回放必须返回同一结果且零新增 ledger/宠物变化/run audit；同 request UUID 交换任意用户必须返回幂等冲突；不同 request UUID 在已对齐状态必须产生一个 `noop` run audit且零资产变化。不同 request UUID 重新绑定角色时只调整 fixture-owned 数量，不得减少调用前已存在或后来获得的非夹具资产。

完整正向、同 request 回放、不同 request no-op 与角色重绑定只在四个真实账号均已认证后执行；两账号基线只执行 ACL、静态、事务回滚和不涉及虚假身份的负向探针。

## Battle 第 21 章验收

以下证据必须来自真实 Telegram、真实 Vercel、真实 Supabase 与真实 Ably；静态门禁不能替代：

- 本次本地实现仍待真实开发环境验证 Telegram prepared message 与 `shareMessage` 真机发送、60 秒未知结果恢复/退款、Ably 2.26.0 subscribe-only token 与 outbox 重投、两个 integration 的真实 Bearer 鉴权、Vercel 超时边界，以及从空 Supabase 数据库执行三条 migration 后的并发裁决。
- 规则与页面：`battle-v1` checksum 与正式 JSON、数据库种子、API 摘要一致；Catalog v1 仍为 70 链/210 模板且 release checksum 不变；游戏页完整覆盖第 21 章九种页面状态，构建和运行资源不含 Phaser 或客户端战斗模拟器。
- 隐私：按唯一清单分别保存七种严格 DTO：`BattleChallengeCardDto`、`BattleInvitePreviewDto`、`BattleLobbyDto`、`BattleSelfTeamDto`、`BattleOpponentTeamDto`、`BattleResolutionEventDto`、`BattleRoomSnapshotDto`；逐字段证明禁止信息不在 JSON、HTML、Ably、日志和分析事件中。挑战卡/接受预览允许创建者展示头像；lobby JSON 和 DOM 不返回或加载双方真实头像，只使用固定仓库 WebP/中性图标。接受前双方秘密、接受后对手百分比生命及当回合技能揭示严格符合第 21.7 节。
- 分享与接受：用户私聊、普通群、超级群、跨群转发、Bot 不在群、Bot 会话禁止、频道禁止、创建者本人严格 `self` 且服务端禁止；有效邀请直接显示队伍选择，没有前置状态页。创建者在线与离线均可接受，离线固定展示“离线 · 仍可接受”。两个普通接受者与一个竞争账号同时接受时只有首个事务成功，失败者余额和 inventory 完全不变。
- lobby：首位接受后 snapshot 为 `lobby_waiting/lobby_countdown`、双方 participant 为 `lobby` 且没有 turn 1；验证双方 5 秒心跳、10 秒在线判定、89 秒重连、90 秒终结、创建者接受前离线窗口重置、5 分钟总时限、3 秒倒计时开始/中止/完整重启、到期再次确认在线和相等 deadline 终结优先。正常终结双方原额退款、六个 reservation 释放、手续费为 0。
- presence 乱序：分别交换同 lease heartbeat/offline 到达顺序，覆盖隐藏时在途 heartbeat、offline 未送达、重新可见、Telegram 重新激活、离开再返回 `/game`、页面重载、重新认证、重复命令和旧 lease 重放。新 lease 接管后，旧请求必须数据库语义 no-op，不改变 presence、90 秒窗口、3 秒倒计时、`state_version`、event/outbox 或资产。
- lobby 永久不变量：在真实事务 room-first 锁边界逐项破坏 participant 数量/归属、stake 金额/归属/lock ledger、每方三份快照与唯一 active、六个 reservation、ruleset/checksum/deadline/seed 启动条件；advance 与 monitor 都必须复用同一幂等安全作废，不创建 turn 1。接受事务持锁的中间态不得被 monitor 作废。
- lobby UI：左红右蓝使用固定仓库正方形 WebP，不使用真实头像；在线同时显示彩色图片、状态点和“已进入房间”，离线显示中性用户图标、文字及权威重连剩余；5 分钟时限和 3 秒倒计时同时可见，颜色不是唯一状态信息，`aria-live` 与 reduced-motion 生效。
- 资产与库存：三个入场档逐一核对双方 lock、胜者到账、平台手续费、败者、平局退款、`voided` 退款；重复创建、接受、取消、到期、结算和恢复不重复改变资产。prepared-share 明确失败的 `voided` 必须是一份 stake refunded、三份 reservation released、零 settlement；`cancelled/expired` 全量退款释放；lobby/战斗不变量 `voided` 保留安全 settlement、审计与 violation，monitor 不误报也不漏报。Battle reservation 与出售、成交、分解、进化、远征、Mint 逐一竞争，同模板额外可用数量仍可操作。
- heartbeat/offline 刷新：普通续租和非终态 online/offline 只应用 room snapshot，网络记录不得出现每 5 秒 assets/inventory 请求；请求内跨过 waiting、90 秒或 5 分钟边界，终态响应、响应丢失后的重新可见回正及相关错误必须一次消费契约 `battle + assets + inventory`，顶部 K-coin 与 `inventory.battling` 及时回正。
- 回合：五属性 1.50/0.75/1.00、十技能命中边界、超时最高命中率、优先级、速度、完全相同的同时攻击、先手击倒、单方换宠、双方换宠、单方/双方强制换宠、槽位超时、连续托管、双方同时全灭和第 20 回合裁决逐项保存 snapshot 与私有审计引用。
- 实时与恢复：Ably capability 为 subscribe-only，消息只有四个失效字段；重复、乱序和迟到消息不覆盖高 `state_version`。主动断开 Ably 后按第 21 章 1—2 秒节奏 REST 回正；Vercel 重启、pg_net 单次失败、cron 短暂停止后继续同一 deadline、outbox 和 settlement。
- 当场结果：终局瞬间断线后 identity bootstrap 与 Battle bootstrap 只恢复同一未确认结果，acknowledge 响应丢失可安全重试，成功后不再返回；玩家端不存在 history、replay、audit、spectator、matchmaking 或公开 room API。
- 风控：邀请 waiting 创建者被封禁后取消、退款、释放；lobby 任一方被封禁后双方退款并释放；active 任一方被封禁后页面空白、数据库继续托管至正常终局且只结算一次。

## 用户与登录第 16.11 节验收

以下 21 项逐项保存独立证据，不能合并为单一“登录通过”结论：

1. 首次有效 Telegram 登录先显示加载反馈，只创建一个 `normal` 账号并进入首屏。
2. 再次或长期离开后登录复用原账号、资产、权益、进度和邀请码。
3. 两个并发首次登录只产生一个账号和一个邀请码。
4. 非 Telegram、缺失 initData、签名失败、过期、未来超过 5 分钟和机器人均不能进入。
5. 恰好 24 小时与未来 5 分钟允许，越过边界拒绝。
6. 登录前后资产、藏品、资格、月卡、任务和邀请奖励均无登录赠送变化。
7. `normal` 完成交接后进入主界面，新前台生命周期停在默认开盒页。
8. 初始 `banned` 只渲染空白，DOM 不含提示、导航、资产、弹窗或按钮。
9. 使用中封禁立即清空页面；封禁前延迟成功响应不能写缓存、弹窗或导航。
10. 合法邀请候选在主页面前得到成功或唯一确定拒绝；直接调用业务 API 返回 `ENTRY_HANDOFF_PENDING`。
11. 同一 initData 一分钟第 4 次登录返回限流且页面不自动重试。
12. 网络/系统异常显示重新尝试；入口、时间、身份和限流错误不显示当前页重试。
13. 会话恰好 15 分钟绝对失效且不延长，自然过期只恢复一次。
14. 自动恢复重新读取账号和首屏，不重做资产业务；恢复得到 `pending` 时回到邀请确认。
15. 会话撤销或替换不自动恢复，旧页面清空并要求重新进入。
16. 多页面同时过期只执行一次认证交换并得到同一账号结果。
17. 恢复期间关闭重开后，旧 generation 结果不能写入新启动页。
18. 首屏整体失败保留内存会话与重试；摘要失败只影响对应区域。
19. 骨架、旧展示和加载动画最终由当前数据库事实覆盖，旧响应不能覆盖新登录。
20. UI 不存在密码、邮箱、手机号、手动用户号、钱包登录、退出、注销、删除或归档入口。
21. iOS、Android、Telegram Desktop、Telegram Web 的浅色、深色、刘海安全区和视口变化下，登录结果一致且全部启动控件可见可操作。

邀请交接场景必须额外记录会话 `referral_processed_at`、候选状态、原 `operation_id` 和门禁接口结果；封禁竞态记录封禁前请求 generation、封禁后 generation、缓存键及最终空白界面截图；邀请信息记录 `/api/referrals` 为 200 且链接包含开发 Bot、`pokepets_dev` 与当前用户邀请码。
