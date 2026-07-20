# ADR-003：API 契约

## 决定

路由、输入、输出、错误、认证和幂等元数据由 `packages/api-contracts` 中的领域 Zod schema 唯一定义。OpenAPI 和 Web 类型客户端从同一 registry 生成。服务端和前端都执行运行时解析。

业务 API 使用统一 snake_case envelope。NFT metadata 是唯一原始 JSON 例外。旧 C1/C2/C4 包装和兼容路径全部删除。

`tasks.get` 的 19 个 `code`、9 个 `category`、4 个 `status` 和 16 个 `completion_action` 全部使用固定枚举。任务同时返回固定标题、真实条件描述、当前进度、目标和 Fgems 奖励。Web 只按枚举映射简体中文，不向用户直接展示任何内部枚举；`completion_action` 只允许切页、切换页签、滚动和聚焦，不调用写接口。
