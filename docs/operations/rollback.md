# 回滚

## 数据库迁移前

静态门禁、素材门禁、账号配置或部署预检失败时停止发布，不关闭当前可用入口，也不开始数据库重建。

## 数据库迁移后、应用切换前

不执行向后迁移，不恢复旧 schema。保持 Telegram 入口和 Cron 关闭，直接修正声明式 Schema 与原始三条迁移，清空真实开发数据库和 migration history 后从第一条重新执行；禁止追加修补 migration。

## 应用切换后

只有目标 commit 与当前三条迁移完全兼容时才能回滚应用。不存在兼容 commit 时关闭 Telegram 入口和 Cron，修正原始定义、从空库重建并部署新的兼容 commit。用户明确宣布正式生产上线后，才切换为保留数据并只追加前向修复 migration。

Monster Tamer 回滚必须选择同时包含 `/monster-tamer`、`/monster-tamer/` 路由和完整静态资源树的兼容 commit，禁止只回滚 launcher 或只回滚部分资源。回滚不执行数据库、API、账本、库存或 Catalog 操作，也不得清除用户浏览器中的 `MONSTER_TAMER_DATA`；部署后重新验证独立入口、完整玩法、资源 200、返回 `/game` 和业务零请求。

Stars 已确认付款、已交付资产与 TON 链上事实不可通过代码回滚撤销。支付和 Mint 必须通过原订单、原操作和对账任务完成，不得创建替代订单、重复发放或伪造链上状态。
