# ADR-028：Battle 请求阶段化结构日志

## 状态

已接受。

## 决定

Vercel Runtime Logs 对全部玩家 `battle.*` 路由和 `battle.outbox_integration` 输出一条请求终态结构日志。`battle.share_integration` 与其他 API 路由保持现有总耗时日志，不进入本观测范围。成功、业务失败和客户端中止使用同一 `request_id`、`route_id`、HTTP `status`、`elapsed_ms` 与固定 `telemetry_scope = battle`，错误路径继续只增加稳定错误 `code`，不输出原始异常内容。

阶段字段固定为：

- `auth_ms`：网关鉴权与本地会话凭证完整性证明的合计墙钟时间，不包含数据库往返。
- `input_parse_ms`：路径、查询与 body 解析校验时间。
- `handler_ms`：Battle handler 的完整墙钟时间。
- `response_ms`：成功响应契约校验与 JSON 生成时间。
- `db_rpc_ms`、`db_rpc_count`：请求内受观测数据库 RPC 的累计等待时间与调用次数。
- `ably_ms`、`ably_operation_count`：实时 token 请求或 outbox publish 批次的累计等待时间与调用次数；普通 Battle 读取和动作不调用 Ably，因此不生成这两个字段。
- `outbox_processed`、`outbox_published`、`outbox_deferred`：`battle.outbox_integration` 正常返回时的领取、发布与延后数量，三个字段在空批次和 HTTP 200 延后场景也必须存在。

全部耗时以非负整数毫秒写入。`auth_ms`、`input_parse_ms`、`handler_ms` 和 `response_ms` 是单次阶段墙钟时间；`db_rpc_ms` 与 `ably_ms` 是请求内每次调用耗时之和，并发投递时可以大于 `handler_ms`，必须结合对应 count 解读。采集器只接受上述固定数值字段，不接受自由文本或任意标签。

日志禁止记录用户 ID、Telegram ID、session、operation ID、room ID、event ID、channel、token、capability、鉴权头、cookie、请求参数、请求/响应 body、Battle 阵容、动作、命中、伤害、余额、结算、RPC 名称和原始数据库或 Ably 错误。现有日志脱敏器继续作为外围保护，但本设计不依赖事后脱敏来阻止私密数据进入日志。

请求终态日志在响应生成后同步写入，不增加外部遥测网络调用。阶段采集只测量既有 Promise，不改变 RPC、Ably、outbox 租约、重试、幂等或响应语义；玩家 Battle Function 仍在数据库 RPC 后返回，不领取或发布 outbox。

## 结果

单个 `request_id` 可以直接区分鉴权、输入、数据库、Ably/outbox、handler 与响应生成耗时。`battle.outbox_integration` 即使返回 HTTP 200，也能从 published/deferred 计数判断本批是否真实发布或进入重试，同时日志不形成新的用户或 Battle 私密数据面。
