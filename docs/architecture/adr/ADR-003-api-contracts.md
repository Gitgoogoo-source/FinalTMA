# ADR-003：API 契约

## 决定

路由、输入、输出、错误、认证和幂等元数据由 `packages/api-contracts` 中的领域 Zod schema 唯一定义。OpenAPI 和 Web 类型客户端从同一 registry 生成。服务端和前端都执行运行时解析。

Battle 创建、取消、接受、正常动作和强制换宠路由的契约固定声明 `Idempotency-Key` 必填并创建 operation。heartbeat/offline 固定禁止 `Idempotency-Key`、不创建 operation，并使用同一严格输入：`room_id`、UUID `presence_lease_id`、正整数 `presence_lifecycle_version`、正整数 `presence_command_seq`；数据库以 version + lease + sequence 保证语义幂等，成功都返回含当前 viewer `presence_lifecycle` 的 room snapshot。acknowledge 仍只以首次确认时间幂等写入。每个成功与错误响应都使用 error registry 或 route contract 的精确 refresh scope；heartbeat/offline 契约声明最大影响域 `battle + assets + inventory`，Web 对普通续租只应用 room，只有同次请求或回正确认取消、过期、退款、结算或作废终态时才一次刷新三类数据。`BATTLE_SHARE_FAILED`、`BATTLE_ROOM_EXPIRED`、`BATTLE_ROOM_CANCELLED` 和 `BATTLE_VOIDED` 同样固定刷新三类；不得每 5 秒无条件刷新 assets/inventory。

业务 API 使用统一 snake_case envelope。NFT metadata 是唯一原始 JSON 例外。旧 C1/C2/C4 包装和兼容路径全部删除。

`tasks.get` 的 19 个 `code`、9 个 `category`、4 个 `status` 和 16 个 `completion_action` 全部使用固定枚举。任务同时返回固定标题、真实条件描述、当前进度、目标和 Fgems 奖励。Web 只按枚举映射简体中文，不向用户直接展示任何内部枚举；`completion_action` 只允许切页、切换页签、滚动和聚焦，不调用写接口。
