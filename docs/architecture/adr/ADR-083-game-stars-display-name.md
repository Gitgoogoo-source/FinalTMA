# ADR-083：游戏 Stars 对外命名与 Telegram Stars 隔离

- 状态：已接受
- 日期：2026-08-24

## 背景

项目原先把游戏内可充值、可消耗、可锁定和可结算的资源对外称为 `K-coin`，同时使用 Telegram Stars 作为真实付款资产。现将前者的玩家可见名称改为 `Stars`。两种资产名称相近，但控制方、账本、用途和付款结果不同，任何界面或文档都不能把它们描述成同一种资产。

## 决策

玩家界面、无障碍名称、Bot 与 Battle 分享卡、Telegram invoice、双语文案、当前产品说明、当前架构说明和现行验收矩阵统一使用 `Stars` 表示游戏资源。真实付款资产始终写作 `Telegram Stars`；不得在付款价格、invoice、预结账、成功付款、退款、VIP 价格或支付支持语境中省略 `Telegram`。充值关系固定表述为“使用 Telegram Stars 获得 Stars”，兑换与业务数值保持既有规则不变。

数据库币种代码 `KCOIN`，API/RPC 字段与结果键中的 `kcoin`，订单类型 `kcoin_topup`，以及既有函数、资源文件、CSS 选择器和内部变量继续作为稳定实现标识。它们不得直接显示给玩家，本次裁决不创建兼容字段、不迁移数据库标识、不改变现有请求或响应 Schema。

本 ADR 只取代旧 ADR 和历史资料中的游戏资源对外术语，不改写这些历史文件的原文，也不改变其中已经裁决的资产、余额、价格、账本、幂等、事务、恢复、退款、Battle 或市场规则。读取旧文件时，其中作为游戏资源名称出现的 `K-coin` 或 `KCoin` 均按当前 `Stars` 理解；代码字体、字段名或枚举仍按稳定内部标识理解。

## 不变量

- `Stars` 余额来自既有服务端与数据库权威结果，前端不计算或裁决余额。
- `Telegram Stars` 仍只通过 Telegram 的 `XTR` 付款流程处理；Stars 到账不等于 Telegram 付款窗口状态。
- Fgems、VIP、藏品、免费资格、TON 和其他资产的名称、用途与规则不变。
- 本次命名不授权、不发起也不验收任何真实 Telegram Stars 支付。
- 英文和简体中文界面均固定使用品牌名 `Stars`，不恢复 `K-coin`，也不为单数金额改写成 `Star`。

## 验证

静态影响域必须通过 Prettier、ESLint、API Contracts、Web/API TypeScript、i18n、架构检查和生产构建。代码搜索必须确认玩家文案与当前有效文档不再出现 `K-coin`、`K-coins` 或 `KCoin`；允许保留项只能是既有内部 `KCOIN/kcoin/KCoin` 标识，以及明确排除改写的旧 ADR、历史验收证据、设计验收记录和开发记录。

同一部署 SHA 的真实 Telegram 验收必须覆盖顶部资产栏无障碍名称、Stars 充值、开盒、转盘、市场、Battle 页面与分享卡、VIP 的 Telegram Stars 价格，以及 Telegram invoice 确认页。验收必须确认游戏资产始终显示 `Stars`、付款资产始终显示 `Telegram Stars`，且不得实际完成 Telegram Stars 支付。静态通过或普通浏览器不能替代真实 Telegram 客户端结论。
