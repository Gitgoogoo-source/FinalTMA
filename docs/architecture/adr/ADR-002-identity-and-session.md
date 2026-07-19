# ADR-002：身份与会话

## 决定

Telegram 是唯一身份来源，不使用 Supabase Auth。只有认证交换端点接收 `initData`。服务端先按来源执行每分钟 30 次限流，验证签名、真实用户、24 小时时限和未来 5 分钟边界后，再按用户每分钟 10 次和同一 `initData` 每分钟 3 次限流。空 `start_param` 正常进入，唯一合法非空值为 `^TMA[A-F0-9]{20}$`，其他值在创建账号前拒绝。

认证交换必须携带 UUID `Idempotency-Key`。`identity.login_requests` 保存经域隔离 HMAC 生成的请求摘要及会话引用；同键同 `initData` 回放同一结果，同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`。服务端使用 `IDENTITY_SECURITY_SECRET` 和操作 UUID 派生不可预测的 32 字节短期令牌，数据库只保存 SHA-256 哈希。`banned` 结果不签发令牌，只返回账号状态并撤销旧会话。

首次创建账号时，合法邀请码作为唯一 `identity.entry_candidates` 候选在同一事务固化，绑定边界为身份确认后 600 秒且恰好边界仍允许。邀请绑定读取该候选并持久化唯一成功或拒绝结果，不依赖当前会话的 `new_user` 或入口参数推测资格。

每次登录撤销同账号旧会话。会话绝对有效 15 分钟，不延长、无 Refresh Token、无退出接口。自然过期仅自动交换一次；被替换或撤销的会话不自动恢复。
