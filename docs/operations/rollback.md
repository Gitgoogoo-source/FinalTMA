# 回滚

当前数据库已经承载真实用户。所有现行回滚都适用“入口恢复后”规则：禁止清库、重建 migration history、修改最初三份 migration 或恢复旧 schema，只允许与现有数据和已加载客户端兼容的前向修复。下方一次性切换段落仅保留历史记录，不得再次执行。

## 数据库迁移前

静态门禁、素材门禁、账号配置或部署预检失败时停止发布，不关闭当前可用入口，也不开始数据库重建。

Battle 预检失败时不得开放 Battle 创建或接受。已存在 waiting/lobby/active room 时先关闭新建与新接受，保持当前兼容 API、`battle-tick-v1`、pg_net、两个 integrations 和 Ably 发布能力运行，直到全部 room 正常终结或按产品第 21 章安全作废；不得直接暂停 presence/deadline 调度或丢弃 outbox。

## 已归档：一次性生产切换中、数据库清空前

Vercel Production 在入口开放前保持启用，完整提交推送到 `main` 后只通过 Git Integration 自动部署。新应用达到 `READY` 但数据库仍为旧定义时不构成可验收组合；部署或 source SHA 核对失败时保持 Telegram 入口、webhook 与 Cron 关闭，修正完整发布单元并推送新的完整提交。不得暂停 Vercel Project、等待 `503 DEPLOYMENT_PAUSED`、创建空触发提交、部署后重新暂停或执行手动 Vercel 部署。

Telegram 入口关闭必须遵守 [ADR-075](../architecture/adr/ADR-075-telegram-named-mini-app-release-isolation.md)：Main Mini App 保持停用、默认菜单保持默认行为、`evomypet` 保持原 short name且 Web App URL 指向当前环境 `/maintenance.html`。禁止用 `Delete Web App`、第三方占位页或 Vercel Project 暂停恢复隔离；维护页部署或响应门禁失败时不得把 named URL 改回游戏根 URL。

## 已归档：数据库清空后、入口恢复前

不执行向后迁移，不恢复旧 schema，也不单独回滚应用。保持 Telegram 入口、webhook 与 Cron 关闭但继续启用 Vercel Production，直接修正声明式 Schema、原始三条 migration、OpenAPI、生成数据和 checksum，推送同一完整提交后再次清空目标数据库与 migration history，从第一条重新执行。禁止追加修补 migration；应用、数据库与发布单元全部核对一致前不得恢复入口或开始验收。

## 入口恢复后

生产入口恢复后，数据库已经承载不可丢失数据。禁止清库、重建 migration history、修改既有 migration、恢复旧 schema 或把应用单独回滚到不兼容提交。故障处理只发布兼容当前数据和已加载客户端的前向应用与追加 migration；Git commit、OpenAPI、Catalog manifest、领域 checksum 和新增 migration 仍构成不可拆分的发布单元。

Stars 已确认付款、已交付资产、Battle stake/settlement 与 TON 链上事实不可通过代码回滚撤销。支付、Battle 和 Mint 必须通过原订单、原 operation、原 room、数据库 tick 与对账任务完成，不得创建替代订单、重算随机结果、改判终局、重复退款/结算、重复发放或伪造链上状态。

Telegram 欢迎消息一旦在 `operations.telegram_chat_onboarding` 领取发送资格，无论记录为 `sent`、`failed`、`unknown`，或因进程终止只留下未完成的 `unknown` 尝试，都不得通过回滚、Telegram update 重放、手工改表或新代码自动再次发送。聊天列表由 Telegram 的授权服务消息建立；欢迎消息结果不影响玩家进入游戏。若功能发布失败，入口恢复前修正同一完整发布单元；入口开放后只做兼容当前领取记录的前向修复。

宠物美术可独立于 Git/Vercel 回滚。操作员使用资源工具取得与发布、清理共用的耐久资源变更租约，下载并校验目标历史批次 210 个私有母版、420 个公开对象及公开缓存头，建立覆盖操作窗口的回滚锁，再以同一 run ID 和 fence 调用单一 RPC 原子切换并复核当前批次；任一对象缺失、SHA-256 不符、缓存头不符、租约丢失、已删除或批次不完整都必须停止。公开对象已被 90 天清理任务删除时，不得把指针切向残缺批次，必须从 `art-masters` 私有历史母版重新生成并以新发布键发布完整批次。任何美术回滚都不删除或覆盖私有母版。
