# ADR-003：API 契约

## 决定

路由、输入、输出、错误、认证和幂等元数据由 `packages/api-contracts` 中的领域 Zod schema 唯一定义。OpenAPI 和 Web 类型客户端从同一 registry 生成。服务端和前端都执行运行时解析。

服务端 `/app` registry 只包含当前活动 App 路由。浏览器固定通过 `/app-client` 的 `loadClientRoute()` 按首屏或领域异步取得同一份 route 定义，并在请求输入、成功响应和 operation 恢复结果进入 UI 前执行 Zod 解析；表现组件只接收已解析的判别结果。身份、目录、开盒、VIP、充值与 operation/payment recovery 组成唯一首屏契约块，市场、库存、任务、Battle、转盘、图鉴等契约随所属页面或恢复 `use_case` 加载。

稳定错误码集合与错误文案/恢复策略分别拥有运行时模块，基础 envelope 和 Schema 不得因错误定义注册表加载全部领域文案。Wallet 与 Mint route 只由 `/dormant-app` 导出，活动 `/app`、Web loader、App handler map、`/server` 和 OpenAPI 均不包含这些路由；休眠源码直接调用活动网关时在浏览器契约加载阶段明确失败，不发送业务请求，服务端直接请求仍返回 `API_ROUTE_NOT_FOUND`。

Battle 创建、随机匹配、取消、接受和行动路由的契约固定声明 `Idempotency-Key` 必填并创建 operation。随机匹配只接受档位与有序三个模板，返回参与者专属 room snapshot；不存在候选列表接口。行动输入是 `attack | switch | replace_attack` 严格联合；旧的独立换宠路由不存在。房间读取可携带 `after_action_sequence`，每次最多返回 16 条 viewer-specific `BattleActionEventDto`。heartbeat/offline 固定禁止 `Idempotency-Key`、不创建 operation，并使用同一严格输入：`room_id`、UUID `presence_lease_id`、正整数 `presence_lifecycle_version`、正整数 `presence_command_seq`；数据库以 version + lease + sequence 保证语义幂等，成功都返回含当前 viewer `presence_lifecycle` 的 room snapshot。结果展示没有 acknowledge 路由，终局结果只在参与者专属 room snapshot 中返回。每个成功与错误响应都使用 error registry 或 route contract 的精确 refresh scope；heartbeat/offline 契约声明最大影响域 `battle + assets + inventory`，Web 对普通续租只应用 room，只有同次请求或回正确认取消、过期、退款、结算或作废终态时才一次刷新三类数据。`BATTLE_SHARE_FAILED`、`BATTLE_ROOM_EXPIRED`、`BATTLE_ROOM_CANCELLED` 和 `BATTLE_VOIDED` 同样固定刷新三类；不得每 5 秒无条件刷新 assets/inventory。

业务 API 使用统一 snake_case envelope。NFT metadata 是唯一原始 JSON 例外。旧 C1/C2/C4 包装和兼容路径全部删除。

`tasks.get` 的 19 个 `code`、9 个 `category`、4 个 `status` 和 16 个 `completion_action` 全部使用固定枚举。任务同时返回固定标题、真实条件描述、当前进度、目标和 Fgems 奖励。Web 只按枚举映射简体中文，不向用户直接展示任何内部枚举；`completion_action` 只允许切页、切换页签、滚动和聚焦，不调用写接口。
