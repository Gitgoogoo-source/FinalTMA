文件定位：

transactions.ts

# 统一调用 Supabase RPC

# 处理 timeout、retry、traceId、数据库错误标准化

# 确保核心写操作通过单个 Postgres RPC 完成事务

idempotency.ts

# 处理幂等键

# 防止重复支付回调、重复购买、重复开盒、重复领取任务

# 支持请求 hash 校验、处理中锁、完成结果缓存、失败重试控制

前置假设：
// packages/server/src/db/supabaseAdmin.ts
// 你需要已经有这个文件，并导出 supabaseAdmin
export const supabaseAdmin = ...

并且数据库里需要有 ops.idempotency_keys 表，字段至少包含：

scope
key
request_hash
user_id
status
response
error
lock_token
locked_until
expires_at
attempts
metadata
last_trace_id
created_at
updated_at
completed_at
failed_at

下面代码默认你的 packages/db-types 包名是 @tma-game/db-types，且其中导出了 Database 类型。Supabase JS 用 createClient() 创建客户端，用 .rpc() 调用 Postgres 函数；新版 Supabase key 建议服务端使用 sb_secret_xxx 类型的 secret key，旧项目可继续使用 service_role key。注意：service role / secret key 只能放在服务端，因为 service role Authorization 会绕过 RLS。

需要的环境变量：

SUPABASE_URL=https://xxxx.supabase.co

# 优先使用新版 server secret key

SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxxxxxxx

# 如果你还是旧版 Supabase key，也可以用这个作为 fallback

SUPABASE_SERVICE_ROLE_KEY=eyJxxxxxxxxxxxxxxxxx

# 可选

SUPABASE_CLIENT_INFO=tma-game-server/1.0.0
SUPABASE_RPC_TIMEOUT_MS=15000
LOG_RPC=0
