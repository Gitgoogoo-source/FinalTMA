# ADR-099：Battle operation 通用准入与动作限流叠加

- 状态：已接受
- 日期：2026-08-30

## 背景

`operations.begin_command` 是全部幂等玩家命令创建持久 operation 的共享边界。既有 `operations.admit_new_command` 对 `battle.%` 直接返回，失败终态和 `pending/unknown` 统计及其部分索引也排除 Battle。Battle 创建、随机匹配、接受和行动的动作级限流位于 operation 创建之后的业务子事务内；取消没有独立动作级限流。攻击者可以持续提交新的 UUIDv7，在房间或业务前置条件失败后留下不受通用容量约束的失败 operation，长期消耗数据库、索引和清理资源。

旧 key 的查询与重放已经先于 UUIDv7 新鲜度、用户准入和 operation 插入。五个 operation-backed Battle RPC 都在各自业务异常捕获块之外调用 `operations.begin_command`，因此容量安全边界在共享 operation 准入处修复，不在五个 Battle RPC 中复制控制。五个入口都不得在 `begin_command` 前取得行锁或 advisory lock，避免与通用用户准入锁形成反向锁序。

## 唯一结论

`operations.admit_new_command` 不再按 use case 绕过。全部新 operation 在同一个用户级事务 advisory lock 下聚合受以下固定容量约束：

- 每 60 秒最多 60 个新 operation key。
- 每 24 小时最多 1000 个新 operation key。
- 最近 24 小时最多 100 个失败终态 operation。
- 同时最多 20 个 `pending/unknown` operation。

失败终态和未决统计覆盖全部 use case；`operations_failed_user_idx` 与 `operations_open_user_idx` 使用相同谓词，不包含 `battle.%` 排除条件。第一个超限的新 key 在 operation 插入前返回既有 `RATE_LIMITED`，不得生成 operation、authority sequence、房间、participant、action、stake、reservation、ledger、event 或 outbox。

Battle 创建、随机匹配、取消、接受和行动进入通用准入。create、matchmake、accept 和 combat action 继续执行既有 Battle 动作级限流；通用准入和动作级限流同时成立，任何一方都不能替代另一方。取消不新增任意动作阈值，只受通用 operation 准入、房间锁、归属和状态机约束。heartbeat、offline、invite preview、realtime token 和内部 share/outbox 处理不创建新 operation，不进入通用 operation 准入，继续使用各自现有边界。

## 顺序与兼容性

`operations.begin_command` 的固定顺序保持为：验证会话；按 operation ID 取得事务 advisory lock；锁定并读取旧记录；同 key 同用户、同 use case、同 request hash 直接返回旧记录；任何不一致返回 `IDEMPOTENCY_KEY_REUSED`；仅对新 key 校验 UUIDv7 新鲜度；取得用户准入锁；裁决并消耗四项通用容量；插入 operation；进入领域业务。

因此进入 `begin_command` 的同 key 同请求重放不消耗新额度，也不受当前计数或动作级限流影响。`battle.accept` 可以在准入前只执行无锁的本人房间快速拒绝，不得锁 session、room 或取得 advisory lock；新 operation 通过准入并完成回放判断后，必须在业务子事务内重新锁定 session 与 room，并在 room 锁内再次执行权威本人接受拒绝。其余 Battle 入口同样固定先准入、后取得领域业务锁。准入计数位于 Battle 业务子事务之外；后续业务错误被转换为失败 operation 时，本次新 key 仍占用通用计数。只有整个数据库语句因基础设施或未捕获错误回滚时，计数与 operation 一并回滚。

公共错误注册表、HTTP 429 映射、OpenAPI 和 Web 恢复语义保持不变。没有 operation ID 的准入拒绝是确定失败，不查询不存在的 operation；玩家只看到既有业务化频率提示，不显示数据库、请求、operation 或内部限额。

## 数据库与发布

项目尚未冻结生产 migration。实现直接修改 `supabase/schemas/30_operations.sql`，并从声明式 schema 重新生成原始 `*_baseline.sql`；不新增补丁 migration，不保留旧索引或后续 `DROP/ALTER` 修正。真实开发环境从空数据库连续执行唯一三条 migration，确保声明式 schema、baseline、权限和产品数据来自同一 Git commit。

本决策修订 ADR-059 与 ADR-004 中 Battle 不进入通用准入的旧结论，并把 `battle.accept` 的准入前 session/room 锁改为无锁快速读取；准入后的权威 session/room 锁、状态机、动作裁决、清理和留存规则保持不变。

## 验收

静态门禁必须要求两个通用部分索引、四项容量检查、旧 key 重放早于准入、准入早于插入；`operations.admit_new_command` 不得存在任意提前 `return`，按 use case 的唯一分支只能是进化确认门禁。门禁必须逐一解析五个 Battle RPC，证明各入口只以精确 use case 调用一次 `begin_command`，准入前没有行锁或 advisory lock，回放早于业务子事务；create、matchmake、accept 和 action 的动作级限流必须分别位于对应 RPC 的回放之后和业务子事务之内，cancel 不新增独立动作级限流。内存负例必须证明等价 Battle 早退、删除某入口 `begin_command`、删除动作级限流和 accept 准入前加锁均被拒绝。

数据库影响域验证必须覆盖同 key 重放、异请求拒绝、60/61、1000/1001、100/101 failed、20/21 pending/unknown、跨 Battle 与非 Battle 聚合、五个 Battle operation 入口、并发边界和准入拒绝零副作用。原有 Battle 动作级阈值必须继续生效；`battle.accept` 与同用户 action 的并发验证不得出现 `40P01`，失败事务不得留下 operation、计数、房间、reservation、stake 或 ledger 的部分提交。

部署后使用真实 iPhone Telegram Mini App 与 Safari Web Inspector 验证正常 Battle 全流程、同 key 响应丢失恢复、429 `RATE_LIMITED` 的业务化展示、无重复请求风暴和无资产或房间状态回归。静态检查、本地或远端 SQL 结果不能代替真实客户端验收。
