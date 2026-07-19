# ADR-003：API 契约

## 决定

路由、输入、输出、错误、认证和幂等元数据由 `packages/api-contracts` 中的领域 Zod schema 唯一定义。OpenAPI 和 Web 类型客户端从同一 registry 生成。服务端和前端都执行运行时解析。

业务 API 使用统一 snake_case envelope。NFT metadata 是唯一原始 JSON 例外。旧 C1/C2/C4 包装和兼容路径全部删除。
