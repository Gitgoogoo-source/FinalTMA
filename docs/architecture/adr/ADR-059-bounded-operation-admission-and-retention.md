# ADR-059：有界 operation 准入与保留

- 状态：已接受
- 日期：2026-08-10

## 背景

operation 同时承担命令幂等、未知结果恢复、权威状态追赶与最小审计锚点。旧实现允许客户端持续更换普通 UUID，在业务前置条件失败前先插入 operation；每日清理只压缩载荷并永久保留父行，因此单个账号可以无限制造永久记录。直接把所有旧行删除又会使旧 key 被当作新命令再次执行，并破坏仍由账本、订单、资产、市场或 Battle 引用的审计事实。

## 决策

浏览器使用 Web Crypto 生成 RFC 9562 UUIDv7，全部幂等 HTTP 路由只接受规范小写 UUIDv7。`operations.begin_command` 固定按以下顺序执行：验证会话；按 operation ID 取得事务 advisory lock；查询并锁定旧记录；旧记录同请求直接回放、不同请求拒绝；只有不存在旧记录时才验证 UUIDv7 时间、执行用户准入并插入。新 key 的时间不得早于数据库当前时间 24 小时，也不得晚于当前时间 5 分钟。旧记录查询在新鲜度校验之前，因此同 key 重试不计入新请求配额，并可在记录仍保留时继续回放。

全部新 operation 采用一行一个用户的固定容量计数器与当前 operation 状态共同裁决：每 60 秒最多 60 个新 key，每 24 小时最多 1000 个新 key，最近 24 小时最多 100 个失败终态，同时最多 20 个 `pending/unknown`。用户级事务 advisory lock 串行执行计数、状态统计和插入；任一上限命中均在插入前返回 `RATE_LIMITED`。失败与未决统计及其部分索引覆盖所有 use case，包括 `battle.create`、`battle.matchmake`、`battle.cancel`、`battle.accept` 和 `battle.action`。Battle 规则中的动作级、房间级和账号级限制继续叠加执行，不替代通用 operation 准入；heartbeat/offline 不创建 operation，因此只受 Battle 自身边界约束。

`inventory.evolve` 在通用准入之外固定每位用户最多一条阻塞记录：`pending/unknown` 或尚未确认的 `succeeded/failed` 都占用同一槽位。新 key 在旧 key 回放后、operation 插入前严格验证模板 ID 形状与数量的 bigint、正数、3 的倍数边界，再在同一用户锁内检查槽位；槽位已占用时返回该路由专用的 `ACK_REQUIRED` 且零 operation 副作用。条件唯一索引防止任何并发或内部路径制造第二条记录，确认 RPC 使用同一用户锁线性化释放槽位。

市场成功上架的领域配额由 [ADR-060](ADR-060-market-listing-quota.md) 另行裁决。它在旧 key 回放后检查 UTC 每日 200 次与账号生命周期 20,000 次；新 key 超限时整个 RPC 回滚，不能留下失败 operation，成功计数只由挂单 BEFORE INSERT trigger 消耗。该领域配额不替代本 ADR 的通用 operation 准入。

每日 `cleanup-idempotency` 在同一任务锁内执行有界维护：终态完成满 30 天后压缩 `request`、`result` 与转盘逐项结果；无任何业务外键引用的失败 operation 满 7 天删除，无引用的成功 operation 满 37 天删除。非终态、未确认进化和活动支付/Mint 不压缩或删除。仍被账本、免费资格、远征、Battle、市场、支付、VIP、任务、推荐、图鉴或 Mint 引用的终态只压缩并保留最小审计锚点。每轮压缩与删除各按 `completed_at, id` 稳定排序，使用 `FOR UPDATE SKIP LOCKED`，上限各为 5000。任务结果分别记录压缩、删除、登录限流清理与 Battle 运维清理数量。

未确认进化没有 TTL，但单用户数据库硬上限始终为一条；确认后的进化立即恢复普通 7/30/37 天规则。两个恢复 RPC 分别显式限制进化项最多一条，不能用整个响应数组的总上限丢弃其他合法未决操作。

全部 operation 外键列必须有可用索引。`operations.operation_has_durable_reference` 是删除保护的唯一引用清单；静态门禁从声明式 schema 枚举全部指向 `operations.operations(id)` 的外键并要求清单完整，新增业务引用不能静默遗漏。删除后的旧 UUIDv7 已超过 24 小时新鲜度窗口，固定返回 `IDEMPOTENCY_KEY_INVALID`，不能作为新命令执行。

准入错误必须发生在业务 RPC 的内部异常捕获块之前，不能被转换为一条新的失败 operation。声明式 schema、原始 baseline、契约、OpenAPI、Functions、Web、架构文档与验收清单在同一提交更新；项目正式生产上线前从空真实开发数据库重建三条原始 migration，不追加补丁 migration。

## 验收

静态门禁证明 UUIDv7 版本位与 variant 位、API Schema、数据库新鲜度、回放先于准入、四项通用上限覆盖 Battle、Battle 动作级限流继续叠加、引用清单完整、7/30/37 天边界、5000 条批次和 `SKIP LOCKED` 均存在，并明确拒绝任何 `battle.%` 提前返回或统计排除谓词。数据库影响域验证覆盖同 key 同请求不计数、同 key 不同请求拒绝、UUIDv4/过旧/未来越界拒绝、各上限边界、五个 Battle operation 入口、并发同 key 只插入一行、准入拒绝零 operation 副作用、清理引用保护、无引用删除及删除后不可重放。真实 Telegram Mini App 验证用户动作仍能得到原业务结果、限流只显示既有业务化反馈、网络未知继续查询原 operation；不得在玩家界面显示 operation、数据库、请求或清理细节。

进化影响域还必须验证：格式或数量无效时零 operation；第一条阻塞记录存在时新 key 稳定拒绝且总数不变；旧 key 同请求仍回放、异请求仍拒绝；并发新建最多一条；确认与新建并发满足确认提交前拒绝、提交后允许；两个恢复读取和契约均最多返回一条进化且不丢失其他未决项；未确认结果跨清理窗口仍保留，确认后按既有周期清理。
