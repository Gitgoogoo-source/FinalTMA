# ADR-002：身份与会话

## 决定

Telegram 是唯一身份来源，不使用 Supabase Auth。只有认证交换端点接收 `initData`。服务端先通过来源专用 RPC 执行每分钟 30 次限流，验证签名、真实用户、24 小时时限和未来 5 分钟边界后，再由 `api.identity_authenticate` 同一事务按用户每分钟 10 次和同一 `initData` 每分钟 3 次限流并完成登录；身份认证裁决固定为两次数据库往返。入口交接完成的正常结果在认证事务提交后再读取一次 `api.identity_initial`，因此正常完整首屏固定为三次数据库往返且浏览器只有一个认证请求；推荐入口仍为 `pending` 时固定只有前两次认证 RPC。相同登录幂等请求的重放仍计入用户与 `initData` 限流。`start_param` 只允许空值、`^TMA[A-F0-9]{20}$` 推荐码或 `^BTL_[A-Za-z0-9_-]{32}$` Battle bearer token，并分别固化为 `direct`、`referral`、`battle`；其他值在限流记录提交后、创建账号前拒绝。Battle 原始 token 只在当前 Function 请求内存中存在，数据库和 session 只保存 SHA-256。

认证交换必须携带 UUID `Idempotency-Key`。`identity.login_requests` 保存经域隔离 HMAC 生成的请求摘要及会话引用；同键同 `initData` 回放同一结果，同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`。服务端按 [ADR-038](ADR-038-local-session-proof-and-login-rpc-consolidation.md) 使用 `IDENTITY_SECURITY_SECRET` 和操作 UUID 确定性派生 session UUID，并签发固定版本、包含该 UUID 与 HMAC 的短期 opaque bearer；数据库只保存完整令牌的 SHA-256。`banned` 结果不签发令牌，只返回账号状态并撤销旧会话。

只有 `referral` 入口且首次创建账号时，合法邀请码才作为唯一 `identity.entry_candidates` 候选在同一事务固化，绑定边界为身份确认后 600 秒且恰好边界仍允许。`direct` 与 `battle` 不创建候选、不绑定推荐关系且交接状态直接完成。`identity.sessions.referral_processed_at` 是推荐入口交接门禁：空值表示 `pending`，非空表示 `complete`。认证交换返回 `entry_kind`、`entry_handoff_state`、`entry_handoff_code`、`entry_handoff_result`，前端不得根据 Telegram `start_param` 或 `new_user` 推断资格；后续请求只在 Function 本地证明凭证并提取 `session_id`，可变交接状态始终由业务 RPC 在数据库内裁决。

`api.session_user` 默认拒绝 `pending` 会话并返回 `ENTRY_HANDOFF_PENDING`。仅 `referral.bind` 可创建邀请绑定操作；`operations.get` 仅可读取当前用户原 `referral.bind` 操作。绑定成功和全部确定拒绝在同一事务内固化候选、操作终态与当前会话完成时间；数据库异常、网络结果未知和未决操作保持 `pending`。已完成操作的幂等回放为当前会话补齐完成时间。

每次登录撤销同账号旧会话。会话绝对有效 15 分钟，不延长、无 Refresh Token、无退出接口。自然过期仅自动交换一次；恢复得到 `pending` 会话时回到邀请确认流程，不加载首屏。被替换或撤销的会话不自动恢复。

直接入口、Battle 入口或已经完成推荐交接的认证，在 `api.identity_authenticate` 事务提交后由同一 Function 调用 `api.identity_initial`，把可空 `initial_state` 与短期令牌一起返回；初始状态读取不进入认证事务。初始读取的临时失败只把 `initial_state` 降级为空，前端保留 session 并命令式重试 `identity.initial`；会话、封禁和入口交接的稳定错误不得降级。`pending` 推荐入口固定返回空初始状态，绑定形成确定终态后再读取一次新的 `identity.initial`。首屏摘要写入 `identity.summary` 查询缓存，恢复种子只保存于当前 session generation 内存，规则由 [ADR-049](ADR-049-identity-initial-state-and-summary-read-model.md) 固定。
