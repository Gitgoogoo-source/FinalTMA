# ADR-049：身份首屏状态与日常摘要读模型分离

- 状态：已接受
- 日期：2026-08-09

## 背景

`identity.bootstrap` 同时承载用户与资产摘要、资格与目录提示、操作权威游标、阻塞操作、支付恢复、Mint 恢复和 Battle 参与状态。前端又把它作为 React Query 普通资产查询加入人工刷新、前台恢复和多个业务 `refreshScopes`，导致每次只需要回正顶部余额时都重复执行完整恢复扫描；登录还需要浏览器在认证成功后再发一次首屏请求。恢复种子与日常摘要拥有不同生命周期，继续共用一个路由会把低频恢复成本放大到所有高频资产刷新。

## 决策

身份读取固定拆成两个互不替代的契约：

- `GET /api/me/initial`（`identity.initial`）只用于正常 session generation 的入口建立与会话恢复，返回 `{ summary, recovery }`。`summary` 包含当前用户和 K-coin/Fgems；`recovery` 包含同一数据库语句快照中的 `authority_cursor`、`blocking_operations`、`payment_recovery_orders`、`pending_mints` 与 `battle_participation`。
- `GET /api/me/summary`（`identity.summary`）只返回 `{ user, assets }`，是顶部资产、用户资料和日常资产回正的唯一身份读模型。

开盒资格继续由 `gacha.bootstrap` 返回。身份读模型不再返回 `entitlements`、`catalog_version` 或 `server_time`。`identity.bootstrap` 路由、RPC、OpenAPI operation、权限和全部调用方删除，不保留兼容别名。

`POST /api/auth/telegram` 继续先执行来源限流 RPC，再执行 `identity_authenticate`。认证事务提交后，同一 Vercel Function 在 `entry_handoff_state = complete` 时调用 `identity_initial`，并把结果作为可空 `initial_state` 与令牌一起返回；初始状态读取不嵌入认证事务，不延长登录锁。正常路径仍为三次数据库 RPC，但浏览器启动只发一个认证 HTTP 请求。若入口交接为 `pending`，认证响应固定返回 `initial_state: null`；推荐绑定形成确定终态后，前端必须读取一次新的 `identity.initial`，不得使用绑定前快照。

只有初始状态 RPC 的临时数据库或内部失败可以降级为 `initial_state: null`，认证端点仍返回已签发的有效短期 session。`SESSION_REQUIRED`、`SESSION_EXPIRED`、`SESSION_REPLACED`、`ACCOUNT_RESTRICTED`、`ENTRY_HANDOFF_PENDING` 等稳定身份裁决不得降级。前端对空初始状态执行一次命令式 `identity.initial` 回退；失败时保留内存 session 并显示业务化重试界面。会话自然恢复使用认证响应中的初始状态，空值时执行同一回退。

前端把 `summary` 写入当前 session generation 的 `identity.summary` React Query 缓存。`recovery` 写入 generation-scoped 的内存外部状态，只允许入口恢复协调器、图鉴阻塞恢复和 Battle 首次参与回退读取；它不注册为 React Query 查询，不参加人工刷新、前台恢复、业务失效或页面重新激活。`payment_recovery_orders` 只作为 `topup.bootstrap` 首次返回前的即时恢复回退；该查询一旦返回，必须由可刷新的当前支付快照替代入口种子，禁止让一次性种子长期遮蔽支付终态。Session generation 改变、清理会话或封禁时，查询缓存和恢复快照同时清空。

顶部人工刷新固定只读取 `identity.summary` 与 `vip.get`。五分钟后台恢复固定读取 `identity.summary`、`vip.get`、`wallet` 前缀活动查询和当前页面活动查询。`assets`、`inventory`、`payments`、`mint` 的刷新范围用精确路由和既有领域前缀匹配，身份域只允许 `identity.summary`；`identity.initial` 永远不属于 `refreshUserState`、`refreshForegroundState`、`refreshTopAssetSummary`、`refreshScopes`、Battle 终局批量回正或 Mint 恢复失效集合。Battle 终局固定回正 `battle.bootstrap`、`identity.summary` 与 `inventory.list`。

数据库新增 `api.identity_summary(p_session_id)` 和 `api.identity_initial(p_session_id)`，两者首先通过 `api.session_user` 裁决会话。`identity_initial` 在一个 SQL statement snapshot 中组装摘要与恢复种子。恢复扫描使用一个与两个读取谓词共同匹配的部分索引：

```sql
create index operations_user_recovery_idx
on operations.operations (user_id, created_at, id)
where use_case <> 'gacha.open'
  and (
    status in ('pending', 'unknown')
    or (
      use_case = 'inventory.evolve'
      and status in ('succeeded', 'failed')
      and result_acknowledged_at is null
    )
  );
```

`operations_recoverable` 的 Wheel 未决项与 Evolution 未确认项是该部分索引谓词的子集，继续共用 `operations_user_recovery_idx`；晚提交终态游标查询继续使用 `operations_user_authority_sequence_idx`。服务端只为两个新 RPC 授予 `service_role` 执行权，`PUBLIC`、`anon` 和 `authenticated` 保持无权。

## 兼容与迁移

该路由、契约与数据库函数变更不兼容。项目尚未正式生产上线，因此直接修正声明式 schema、原始 baseline 与 `api_security` migration，不追加补丁 migration，不保留新旧双读或双路由。真实开发数据库从空库执行完整 migration，并在同一维护窗口切换数据库、API 和 Web；旧 WebView 关闭后从 Telegram 重新进入。

## 验收

静态门禁必须证明活动代码、契约、OpenAPI、声明式 schema、原始 migration、权限 allowlist 和当前设计正文中不存在旧路由或旧 RPC；本 ADR 的问题背景与冻结的历史验收证据可保留旧名称。认证正常输出包含可空 `initial_state`；日常身份消费者只观察 `identity.summary`；恢复快照只存在于 generation-scoped 内存；所有公共刷新入口和 Battle 终局批量读取排除 `identity.initial`；部分索引谓词与恢复读取一致。

真实开发环境从空库重建后，窄 UTC 日志必须证明：正常直接登录只有一个浏览器认证请求，数据库依次执行来源限流、认证和初始状态三次 RPC；认证后初始状态临时失败仍保留 session 并只允许命令式重试；推荐入口在绑定完成后重新读取初始状态；顶部人工刷新与业务资产变化只调用 `identity_summary`，不调用 `identity_initial`；会话更换或封禁后旧恢复快照无法再触发操作。静态检查、构建成功和普通浏览器结果不能替代真实 Telegram 网络与用户流程验收。
