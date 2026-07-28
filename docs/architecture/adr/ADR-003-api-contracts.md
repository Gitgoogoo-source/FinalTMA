# ADR-003：API 契约

## 决定

路由、输入、输出、错误、认证和幂等元数据由 `packages/api-contracts` 中的领域 Zod schema 唯一定义。OpenAPI 和 Web 类型客户端从同一 registry 生成。服务端和前端都执行运行时解析。

Battle 创建、取消、接受、正常动作和强制换宠路由的契约固定声明 `Idempotency-Key` 必填并创建 operation。heartbeat、offline 和 acknowledge 路由固定声明不接收 `Idempotency-Key`、不创建 operation，分别由 participant 单调服务端时间、room 锁保护的幂等离线转换和首次确认时间写入保证数据库语义幂等；heartbeat/offline 成功都返回更新后的 viewer-specific room snapshot。每个成功与错误响应都使用 error registry 或 route contract 的精确 refresh scope；可能在同次请求终结 lobby 并退款的 heartbeat/offline，以及 `BATTLE_SHARE_FAILED`、`BATTLE_ROOM_EXPIRED`、`BATTLE_ROOM_CANCELLED` 和 `BATTLE_VOIDED` 固定刷新 `battle + assets + inventory`，其余响应保持各自实际受影响领域。

业务 API 使用统一 snake_case envelope。NFT metadata 是唯一原始 JSON 例外。旧 C1/C2/C4 包装和兼容路径全部删除。

`tasks.get` 的 19 个 `code`、9 个 `category`、4 个 `status` 和 16 个 `completion_action` 全部使用固定枚举。任务同时返回固定标题、真实条件描述、当前进度、目标和 Fgems 奖励。Web 只按枚举映射简体中文，不向用户直接展示任何内部枚举；`completion_action` 只允许切页、切换页签、滚动和聚焦，不调用写接口。
