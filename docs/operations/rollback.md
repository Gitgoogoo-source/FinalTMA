# 回滚

## 数据库迁移前

静态门禁、素材门禁、账号配置或部署预检失败时停止发布，不关闭当前可用入口，也不开始数据库重建。

Battle 预检失败时不得开放 Battle 创建或接受。已存在 waiting/lobby/active room 时先关闭新建与新接受，保持当前兼容 API、`battle-tick-v1`、pg_net、两个 integrations 和 Ably 发布能力运行，直到全部 room 正常终结或按产品第 21 章安全作废；不得直接暂停 presence/deadline 调度或丢弃 outbox。

## 维护窗口内、数据库清空前

Vercel Production 暂停后，新应用可以在不可访问状态达到 `READY`，但它与旧数据库不构成兼容组合。部署或 source SHA 核对失败时保持 Vercel Production、Telegram 入口、webhook 与 Cron 关闭，修正完整发布单元并重新通过 Git Integration 自动部署；只有应用仍与旧数据库完全兼容时才允许恢复服务。不得因为数据库尚未清空就让新应用连接旧数据库承载流量。

## 数据库清空后、入口恢复前

不执行向后迁移，不恢复旧 schema，也不单独回滚应用。保持 Vercel Production、Telegram 入口、webhook 与 Cron 关闭，直接修正声明式 Schema、原始三条 migration、OpenAPI、生成数据和 checksum，推送同一完整提交后清空真实开发数据库与 migration history，从第一条重新执行。禁止追加修补 migration；应用、数据库与发布单元全部核对一致前不得恢复入口。

## 入口恢复后

回滚单位固定为 Git commit、三条 migration、OpenAPI、Catalog manifest 与领域规则 checksum 的完整发布单元。ADR-022 的旧四技能应用与新 2/3/4 技能数据库双向不兼容，因此禁止把应用单独回滚到旧提交。正式生产上线前发生故障时重新关闭流量并从空库执行修正后的完整发布单元；用户明确宣布正式生产上线后，只发布同时兼容当前数据的前向应用和只追加 migration，不修改或恢复既有迁移历史。

Stars 已确认付款、已交付资产、Battle stake/settlement 与 TON 链上事实不可通过代码回滚撤销。支付、Battle 和 Mint 必须通过原订单、原 operation、原 room、数据库 tick 与对账任务完成，不得创建替代订单、重算随机结果、改判终局、重复退款/结算、重复发放或伪造链上状态。
