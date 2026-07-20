# ADR-002：身份与会话

## 决定

Telegram 是唯一身份来源，不使用 Supabase Auth。只有认证交换端点接收 `initData`。服务端先按来源执行每分钟 30 次限流，验证签名、真实用户、24 小时时限和未来 5 分钟边界后，再按用户每分钟 10 次和同一 `initData` 每分钟 3 次限流。空 `start_param` 正常进入，唯一合法非空值为 `^TMA[A-F0-9]{20}$`，其他值在创建账号前拒绝。

认证交换必须携带 UUID `Idempotency-Key`。`identity.login_requests` 保存经域隔离 HMAC 生成的请求摘要及会话引用；同键同 `initData` 回放同一结果，同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`。服务端使用 `IDENTITY_SECURITY_SECRET` 和操作 UUID 派生不可预测的 32 字节短期令牌，数据库只保存 SHA-256 哈希。`banned` 结果不签发令牌，只返回账号状态并撤销旧会话。

首次创建账号时，合法邀请码作为唯一 `identity.entry_candidates` 候选在同一事务固化，绑定边界为身份确认后 600 秒且恰好边界仍允许。`identity.sessions.referral_processed_at` 是入口交接门禁：空值表示 `pending`，非空表示 `complete`。认证交换和会话解析统一返回 `entry_handoff_state`、`entry_handoff_code`、`entry_handoff_result`，前端不得根据 Telegram `start_param` 或 `new_user` 推断资格。

`api.session_user` 默认拒绝 `pending` 会话并返回 `ENTRY_HANDOFF_PENDING`。仅 `referral.bind` 可创建邀请绑定操作；`operations.get` 仅可读取当前用户原 `referral.bind` 操作。绑定成功和全部确定拒绝在同一事务内固化候选、操作终态与当前会话完成时间；数据库异常、网络结果未知和未决操作保持 `pending`。已完成操作的幂等回放为当前会话补齐完成时间。

每次登录撤销同账号旧会话。会话绝对有效 15 分钟，不延长、无 Refresh Token、无退出接口。自然过期仅自动交换一次；恢复得到 `pending` 会话时回到邀请确认流程，不加载首屏。被替换或撤销的会话不自动恢复。
