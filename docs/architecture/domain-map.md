# 功能实现追踪矩阵

本矩阵只记录实现归属；所有业务数值和用户可见行为均引用 `docs/product/功能说明文档.md`。

| 功能章节           | Web 所有者                      | API 领域                                 | 数据库所有者                             | 核心验收                                                          |
| ------------------ | ------------------------------- | ---------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| 1 正式目录         | album、gacha、inventory         | catalog                                  | catalog                                  | 70 条链、210 个模板、420 张运行时图及双路径一致                   |
| 2 盲盒保底         | gacha                           | gacha                                    | gacha                                    | 三档独立、仅付费推进、逐抽重置                                    |
| 3 远征             | expedition（当前隐藏）          | expedition                               | expedition、inventory、economy           | 前端无入口，保留事务与存量数据边界                                |
| 4 幸运转盘         | wheel、operation-recovery       | wheel                                    | wheel、economy、operations               | 1/10 次原子结算、结果明细与确认前持续恢复                         |
| 5 K-coin 充值      | topup、payment-recovery         | topup、stars-payment workflow            | payments、economy                        | 付款前可取消、提交后锁定、成功唯一交付、无充值冷却                |
| 6 TON 钱包         | wallet（休眠）                  | wallet（休眠）                           | onchain、identity                        | 当前 Web 无入口、摘要请求或 Provider 初始化                       |
| 7 Mint             | mint（休眠）                    | mint、jobs（休眠）                       | onchain、inventory、operations           | 当前 Web 无路由、恢复、任务或 Cron                                |
| 8 市场             | market                          | market                                   | market、inventory、economy、vip          | FIFO、整笔购买、逐卖家结算、成交事件游标与设备 SOLD 收件箱        |
| 9 任务与签到       | tasks、wheel                    | tasks                                    | tasks、economy                           | 14 项可见任务、转盘固定位置、奖励唯一发放                         |
| 10 分享邀请        | referral、session-bootstrap     | referral                                 | referral、identity、operations、payments | 服务端交接门禁、唯一绑定、有效充值、日/生命周期上限               |
| 11 分解            | inventory、decomposition        | decomposition                            | 33_decomposition、inventory、economy     | 数量与 Fgems 在同一事务变化                                       |
| 12 官方价格        | market、inventory、gacha        | catalog                                  | catalog、market                          | 前端不提交价格，服务端读取目录                                    |
| 13 图鉴            | album、inventory、market、gacha | album                                    | album、inventory、catalog、economy       | 70×3 显式节点、六筛选、永久点亮、整链奖励唯一领取                 |
| 14 开盒            | gacha、operation-recovery       | gacha                                    | gacha、inventory、economy、operations    | 单抽/十连全成全败、结果只生成一次、展示按钮不写后端且不跨启动恢复 |
| 15 VIP             | vip                             | vip、integrations                        | vip、payments、economy                   | 30 UTC 日、续费上限、每日手动领取                                 |
| 16 登录            | session-bootstrap、platform     | identity                                 | identity、operations                     | initData、交接状态、限流、短会话、封禁迟到响应隔离                |
| 17 藏品            | inventory                       | inventory                                | inventory                                | 模板加数量、预留不可重复使用                                      |
| 18 进化            | inventory、evolution            | evolution                                | 43_evolution、inventory、economy         | 只读预览、二次确认、原子结算、结果恢复与会话 NEW                  |
| 19 顶部资产栏      | app/shell                       | identity                                 | economy、vip                             | 真实资产回正，不读取或展示钱包状态                                |
| 20 风控退款        | app/guards                      | refund-risk workflow、integrations、jobs | risk、payments、operations               | 重复退款无副作用、封禁空白门禁                                    |
| Battle（第 21 章） | battle、battle-realtime         | battle、battle-share/outbox workflows    | battle、inventory、economy、operations   | 好友邀请、同档随机匹配、三宠占用、固定轮流行动、原子结算          |

## 横切约束

- 所有创建 operation 的玩家业务写入均需要 UUID 幂等键；Battle heartbeat 和 offline 不创建 operation，由数据库 lifecycle version + lease UUID + command sequence 保证语义幂等；结果按钮不提交业务请求。
- 所有资产写入均由一个具名 RPC 在单个事务内完成。
- 所有错误均使用契约声明的稳定错误码。
- 所有 operation-backed 命令的结果未知状态均恢复原 `operation_id`，不得生成新键；不创建 operation 的语义幂等命令只按原目标资源重试并读取数据库权威状态。
- 所有认证业务接口默认拒绝未完成入口交接，唯一例外是邀请绑定与受限的原邀请操作查询。
- 所有前端异步结果写入前同时验证 session generation 与 `normal` 账号状态。
- Battle 前端只为创建、随机匹配、取消、接受以及 `attack | switch | replace_attack` 行动提交对应意图与幂等键；heartbeat/offline 提交目标房间、lease UUID、lifecycle version 与 command sequence 且不提交幂等键。结果页只消费房间快照并执行本地导航。公开候选、participant presence、lobby 完整性、首发速度先手、当前行动权、倒计时、命中、伤害、终局、退款与结算全部由数据库裁决。
- Battle 的 Ably 消息只使 `state_version` 失效，viewer-specific 权威内容只通过 REST 读取。
- 真实开发环境与未来生产环境使用相同 commit、相同 migration、不同环境密钥。
