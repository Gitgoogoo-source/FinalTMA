# ADR-016：受控 Battle 验收夹具数据库边界

## 状态

已采用。

## 裁决

四账号 `battle-v1` 验收数据只允许通过内部 `admin.reconcile_battle_fixture` 在数据库所有者通道中对齐。`admin` 不属于 Data API Exposed schemas，不存在对应 HTTP、REST、GraphQL 或 Vercel 测试接口；`PUBLIC`、`anon`、`authenticated` 与 `service_role` 对 schema、表、序列和函数均无权限。管理函数使用 `SECURITY INVOKER` 与空 `search_path`，调用时再次确认当前角色属于 `admin` schema 所有者。

迁移只创建默认关闭的能力，不写入项目身份或 enable 记录。数据库所有者在真实开发库从空重建后，先以 `admin.bind_database_identity` 一次性绑定 `environment = real_development` 与该库 project ref，再以 `admin.configure_battle_fixture_gate` 写入同一环境、同一 project ref、启用状态和不超过 24 小时的过期时间。项目身份不可改绑；执行时 project ref、环境、启用状态和过期时间必须同时通过。未来生产库迁移后没有项目身份和 enable 记录，且 `production` 身份不能启用该能力。

输入固定为 `fixture_version`、request UUID 和按 A/B/C/D 排列的四个内部 user UUID。角色位置、fixture version 与 UUID 有序序列形成规范化 JSONB payload 和 SHA-256；同 request UUID 同 payload 回放持久结果，同 request UUID 不同 payload 返回 `BATTLE_FIXTURE_IDEMPOTENCY_CONFLICT`。不同 request UUID 重新绑定仍执行全部环境、用户、空闲状态、product-data 与 fixture-owned reconciliation 校验。

函数取得相关业务表的 `SHARE ROW EXCLUSIVE` 事务锁后，重新确认四用户存在、状态均为 `normal`、两两不同；全库没有活动 Battle、locked stake/KCoin、active reservation、待发布 outbox、开放 violation、活动市场/远征/Mint/支付以及 `pending/unknown` operation。任何一项不满足都整笔回滚。函数同时核对 Catalog v1 checksum、`battle-v1` checksum、完整规则数量、十二个固定模板、五属性和十个技能槽位；漂移时拒绝。

目标状态由 `admin.battle_fixture_definition` 固定，不接收金额、模板、技能、奖励或 JSON 资产。KCoin 和宠物调整均写入 fixture-owned provenance；余额与 holding 的减少触发器同步消费该 provenance，保证后续 reconciliation 只增减仍属于夹具的数量，不删除或覆盖非夹具资产。当前 A/B/C/D 绑定独立持久化；不同 request UUID 改变任一角色绑定时，事务先仅撤回上一绑定尚存的 fixture-owned 数量，再对新有序绑定建立目标状态，旧用户的非夹具资产保持不变。单一事务写入管理 command、KCoin ledger、holding、宠物变更审计、不可逆 run key、payload hash、前后聚合与最终结果；任一写入失败全部回滚。不同 request UUID 在已对齐且绑定相同的状态只新增 `noop` run 审计，不产生第二次 KCoin 或宠物变化。

`admin.battle_fixture_status` 是同一 owner-only 边界内的只读状态函数，只返回内部 UUID、目标值、fixture-owned 数量、真实聚合、payload hash、不可逆 run key 与对齐结果，不返回 Telegram ID、用户名、`initData`、token 或其他凭据。

## 固定角色矩阵

| 角色 | fixture-owned KCoin | 固定模板与数量                                       |
| ---- | ------------------: | ---------------------------------------------------- |
| A    |                 500 | `PET-N-001-1 ×2`、`PET-N-033-2 ×1`、`PET-A-020-3 ×1` |
| B    |                 500 | `PET-N-003-2 ×2`、`PET-N-039-3 ×1`、`PET-A-018-1 ×1` |
| C    |                 500 | `PET-N-004-3 ×2`、`PET-N-040-1 ×1`、`PET-A-019-2 ×1` |
| D    |                 100 | `PET-N-005-1 ×2`、`PET-N-036-2 ×1`、`PET-A-016-3 ×1` |

每个角色固定拥有一个 1 阶、一个 2 阶和一个 3 阶模板，并按 P01、P08、P12 档案覆盖 S01—S10；四角色合计覆盖火焰、草系、土系、雷电、水系。P01 镜像速度支持同时攻击，P08/P12 与三档优先级支持速度和优先级顺序；每个首模板数量 2、其余数量 1 同时覆盖单份 reservation 竞争与同模板额外可用数量。A/B/C 可承担 500 档与接受竞争，四角色均可承担 20/100 档，D 对 500 档形成余额不足事实。

本 ADR 只定义验收数据管理边界，不改变 Battle 玩法、玩家 API、tick、分享、Lobby、战斗或结算规则。
