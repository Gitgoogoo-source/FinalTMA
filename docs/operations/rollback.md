# 回滚

## 数据库迁移前

静态门禁、素材门禁、账号配置或部署预检失败时停止发布，不关闭当前可用入口，也不开始数据库重建。

Battle 预检失败时不得开放 Battle 创建或接受。已存在 waiting/lobby/active room 时先关闭新建与新接受，保持当前兼容 API、`battle-tick-v1`、pg_net、两个 integrations 和 Ably 发布能力运行，直到全部 room 正常终结或按产品第 21 章安全作废；不得直接暂停 presence/deadline 调度或丢弃 outbox。

## 数据库迁移后、应用切换前

不执行向后迁移，不恢复旧 schema。保持 Telegram 入口、Battle 新建/接受和调度关闭，直接修正声明式 Schema 与原始三条迁移，清空真实开发数据库和 migration history 后从第一条重新执行；禁止追加修补 migration。此阶段只有在已经证明目标环境不存在 waiting/lobby/active Battle room 后才能清库。

## 应用切换后

只有目标 commit 与当前三条迁移、`battle-v1` checksum、viewer-specific DTO、room 状态和 outbox 协议完全兼容时才能回滚应用。不存在兼容 commit 时关闭 Telegram 入口和 Battle 新建/接受，保持能终结既有 room 的当前兼容 runtime 与数据库调度，发布新的前向兼容 commit；正式生产上线前且确认没有活动 room 时，才从空库重建原始三条迁移。用户明确宣布正式生产上线后，切换为保留数据并只追加前向修复 migration。

Stars 已确认付款、已交付资产、Battle stake/settlement 与 TON 链上事实不可通过代码回滚撤销。支付、Battle 和 Mint 必须通过原订单、原 operation、原 room、数据库 tick 与对账任务完成，不得创建替代订单、重算随机结果、改判终局、重复退款/结算、重复发放或伪造链上状态。
