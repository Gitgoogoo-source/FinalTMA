# ADR-038：本地会话凭证证明与登录 RPC 合并

- 状态：已接受
- 日期：2026-08-08

## 背景

原受保护请求先调用 `api.identity_resolve_session`，随后再调用业务 RPC；业务 RPC 又通过 `api.session_user` 重新验证同一会话，简单请求因此存在两次串行数据库往返。原 Telegram 登录依次调用来源、用户、`initData` 三次限流 RPC 和一次 `api.identity_authenticate`，成功路径存在四次串行数据库往返。数据库仍必须是会话撤销、替换、过期、封禁和入口交接状态的最终事实来源，来源限流也必须继续早于 Telegram 验签。

## 决定

访问令牌固定为 `version byte + 16-byte session UUID + 32-byte HMAC-SHA256` 的 49 字节二进制结构，并以无填充 Base64URL 编码。版本固定为 `1`。Function 使用 `IDENTITY_SECURITY_SECRET` 和登录 UUID `Idempotency-Key` 在 `pokepets-session-id-v1` 域内确定性派生 UUIDv8 session ID，再在独立的 `pokepets-session-proof-v1` 域内对版本与 session ID 计算 HMAC。解析时必须严格校验 66 字符 Base64URL、规范编码、固定长度、版本和恒定时间 HMAC；任何失败统一返回 `SESSION_REQUIRED`，不得调用业务 RPC。令牌仍是浏览器不解释的自定义 opaque bearer，不是 JWT，不引入 Supabase Auth，数据库继续只保存完整令牌的 SHA-256。

Function 的本地校验只证明令牌由当前服务签发并提取 `session_id`，不读取或裁决任何可变账号状态。每个玩家业务 RPC 必须在业务读取、写入或外部副作用前调用 `api.session_user`，或调用以 `api.session_user` 开始的 `operations.begin_command`。数据库继续唯一裁决会话存在、撤销、替换、绝对过期、账号封禁和 `pending` 入口交接。`referral.bind` 与受限 `operations.get` 的既有 `pending` 例外保持在数据库内；`api.identity_resolve_session` 删除。

Telegram 登录的认证裁决固定为两次 Data API RPC。第一次只调用 `api.identity_consume_login_source_rate_limit`，在验签前按来源执行每分钟 30 次限制。验签成功后，第二次调用 `api.identity_authenticate`；它按固定的用户、`initData`、登录 operation、Telegram 用户顺序取得事务锁，在同一事务内完成每用户每分钟 10 次、同一 `initData` 每分钟 3 次限制、登录幂等、账号资料、入口候选、旧会话撤销和新会话创建。相同幂等请求的重放仍消耗用户与 `initData` 限流次数，同一 `initData` 第 4 次仍拒绝。正常且入口交接完成时，认证事务提交后同一 Function 再调用一次只读 `api.identity_initial`，因此完整首屏正常路径共三次数据库 RPC，但浏览器仍只有一个认证 HTTP 请求；`pending` 交接不执行第三次读取。

`api.identity_authenticate` 接收域隔离的用户与 `initData` HMAC 指纹、Function 派生的 `session_id` 和完整令牌哈希。用户限流成功而 `initData` 限流失败时，用户尝试记录仍提交，保持原三 RPC 顺序的结果。无效 `start_param` 和同键异请求在限流记录写入后以结构化 `error_code` 返回，由 Function 映射为现有公开错误；它们不创建账号、入口候选、session 或 login request。正常结果返回的 `session_id` 必须与 Function 派生值完全一致，否则令牌不得返回。

来源限流 RPC 使用来源级事务 advisory lock。用户和 `initData` 限流由未暴露的 `identity.consume_login_rate_limit` `SECURITY INVOKER` helper 执行，并采用固定锁序。`identity.auth_attempts` 继续使用既有 scope/key/time 与 time 索引；不再逐请求删除同键旧记录。来源 RPC 通过非阻塞事务 advisory lock 选出清理者，并以内部单例状态保证每分钟至多执行一次五分钟前记录清理；现有每日 `cleanup-idempotency` 继续作为无登录流量时的兜底，不增加 Cron 或外部服务。

新的内部 helper、清理状态表和全部内部 identity 对象不进入 Exposed schemas，对 `PUBLIC`、`anon`、`authenticated` 和 `service_role` 撤权并启用 RLS。`service_role` 只获得 `api.identity_consume_login_source_rate_limit`、`api.identity_authenticate`、`api.identity_initial`、`api.identity_summary` 及既有明确 allowlist RPC 的执行权。所有 `SECURITY DEFINER` RPC 保持空 `search_path` 和完全限定对象名。

## 请求顺序与错误边界

受保护请求固定按“网关认证与路由匹配、本地会话凭证证明、契约输入解析、handler、业务 RPC 数据库会话裁决、契约输出”执行。有效格式但已经撤销、替换、过期、封禁或 `pending` 的令牌会在首个业务 RPC 中返回原有稳定错误。若这类令牌同时携带无效输入，契约输入错误可早于数据库会话错误返回；该顺序只影响构造非法请求的错误优先级，不允许业务读取、写入或外部副作用发生。

## 迁移与验收

本项目尚未正式生产上线，因此直接修正声明式 `10_identity.sql`、原始 baseline 和 `api_security` migration，不追加补丁 migration。令牌切换不保留双格式兼容，也不配置双密钥兼容；真实开发数据库重建和应用切换期间关闭旧 WebView，恢复后必须从 Telegram 重新进入。`IDENTITY_SECURITY_SECRET` 轮换会立即使最多 15 分钟的存量会话失效，固定采用同一重新进入流程。

静态门禁必须证明平台会话模块不导入数据库客户端、代码和 schema 不存在 `identity_resolve_session`、登录 handler 声明来源限流、认证和事务后初始状态三个 RPC 且第三个只在完成交接后调用、所有带 `p_session_id` 的玩家 RPC 在业务工作前重新验证会话、内部对象没有 Data API 权限且 OpenAPI 字节级一致。真实开发验收必须从空库执行完整三条 migration，证明正常完整首屏依次恰好三次 RPC、`pending` 登录恰好两次、无效 Telegram 签名恰好一次、简单玩家请求恰好一次业务 RPC、篡改令牌不调用业务 RPC，并覆盖初始状态临时失败降级、并发限流、幂等重放、同键异请求、封禁、替换、过期与 `pending` 交接。
