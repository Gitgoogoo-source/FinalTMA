# 功能实现追踪矩阵

本矩阵只记录实现归属；所有业务数值和用户可见行为均引用 `docs/product/功能说明文档.md`。

| 功能章节      | Web 所有者               | API 领域                                 | 数据库所有者                         | 核心验收                                            |
| ------------- | ------------------------ | ---------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| 1 正式目录    | album、gacha、inventory  | catalog                                  | catalog                              | 70 条链、210 个模板、顺序与稀有度一致               |
| 2 盲盒保底    | gacha                    | gacha                                    | gacha                                | 三档独立、仅付费推进、逐抽重置                      |
| 3 远征        | expedition               | expedition                               | expedition、inventory、economy       | 正好 3 个单位、跨日、领取原子释放                   |
| 4 幸运转盘    | wheel                    | wheel                                    | wheel、economy                       | 1/10 次原子结算、每日 20 次、资格替换               |
| 5 K-coin 充值 | topup、payment-recovery  | topup、stars-payment workflow            | payments、economy                    | Stars 成功后唯一交付、15 分钟过期、原意图只恢复确认 |
| 6 TON 钱包    | wallet                   | wallet                                   | onchain、identity                    | challenge、proof、防重放、地址唯一                  |
| 7 Mint        | mint                     | mint、jobs                               | onchain、inventory、operations       | reserve、submit、reconcile、metadata 快照           |
| 8 市场        | market                   | market                                   | market、inventory、economy、vip      | FIFO、整笔购买、逐卖家手续费和返还                  |
| 9 任务与签到  | tasks                    | tasks                                    | tasks、economy                       | UTC 日、19 项任务、奖励唯一发放                     |
| 10 分享邀请   | referral                 | referral                                 | referral、identity、payments         | 唯一绑定、有效充值、日/生命周期上限                 |
| 11 分解       | inventory、decomposition | decomposition                            | 33_decomposition、inventory、economy | 数量与 Fgems 在同一事务变化                         |
| 12 官方价格   | market、inventory、gacha | catalog                                  | catalog、market                      | 前端不提交价格，服务端读取目录                      |
| 13 图鉴       | album                    | album                                    | album、economy                       | 永久点亮、整链奖励唯一领取                          |
| 14 开盒       | gacha                    | gacha                                    | gacha、inventory、economy            | 单抽/十连全成全败、结果只生成一次                   |
| 15 VIP        | vip                      | vip、integrations                        | vip、payments、economy               | 30 UTC 日、续费上限、每日手动领取                   |
| 16 登录       | session-bootstrap        | identity                                 | identity、operations                 | initData、时间边界、3 次/分钟、短会话               |
| 17 藏品       | inventory                | inventory                                | inventory                            | 模板加数量、预留不可重复使用                        |
| 18 进化       | inventory、evolution     | evolution                                | 43_evolution、inventory、economy     | 三材料、Fgems、路线保底和任务原子变化               |
| 19 顶部资产栏 | app/shell                | identity                                 | economy、vip、onchain                | 真实资产回正、钱包和 VIP 状态同步                   |
| 20 风控退款   | app/guards               | refund-risk workflow、integrations、jobs | risk、payments、operations           | 重复退款无副作用、封禁空白门禁                      |

## 横切约束

- 所有玩家业务写入均需要 UUID 幂等键。
- 所有资产写入均由一个具名 RPC 在单个事务内完成。
- 所有错误均使用契约声明的稳定错误码。
- 所有结果未知状态均恢复原 `operation_id`，不得重新提交。
- 测试环境与生产使用相同 commit、相同 migration、不同环境密钥。
