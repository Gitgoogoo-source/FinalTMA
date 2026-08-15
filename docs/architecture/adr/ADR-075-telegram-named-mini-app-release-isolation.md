# ADR-075：Telegram named Mini App 发布隔离页

- 状态：已接受
- 日期：2026-08-16

## 背景

`@FinalTMA_bot` 的 Main Mini App 和默认菜单按钮可以在 BotFather 中无损关闭，但 named Mini App `pokepets_dev` 只提供编辑 Web App URL 与删除 Web App。BotFather 不接受用 `/empty` 清空 named Mini App URL；删除会使短名称失去持续归属保证，因此不能作为临时发布隔离手段。

项目在真实开发环境发布不兼容的应用与数据库变更时，Telegram 业务入口必须保持关闭，同时 Vercel Production 按既有裁决继续启用并通过 `main` Git Integration 部署。named Mini App 仍可由历史直链启动，因此仅关闭 Main Mini App 与菜单按钮不能形成完整入口隔离。

## 决策

每个环境的 Web 部署固定提供独立静态文件 `/maintenance.html`。真实开发地址固定为 `https://final-tma-pi.vercel.app/maintenance.html`。该文件由 Vite 从 `apps/web/public/maintenance.html` 原样复制，不加载 React 应用、Telegram SDK、认证、API、数据库或任何游戏资源；英语信息在前，简体中文信息在后，两种语言同时可见。

维护页响应固定设置 `Cache-Control: private, no-store, max-age=0` 与 `X-Robots-Tag: noindex, nofollow`，HTML 自身也声明 `noindex,nofollow`。页面适配 Telegram WebView 的顶部、底部、左右安全区，不提供游戏操作、外部链接或重试按钮，也不显示服务器、请求、数据库、部署或内部处理过程。

进入发布隔离时固定执行三项互相独立的配置：停用 Main Mini App、把默认菜单按钮恢复为默认行为、保留 `pokepets_dev` 并把它的 Web App URL 改为当前环境 `/maintenance.html`。禁止使用 `Delete Web App`、`/deleteapp`、临时 short name、第三方占位域名或 Vercel Project 暂停代替。

如果旧 deployment 尚未包含维护页，只允许先关闭 Main Mini App 与默认菜单按钮，随后把新增维护页的完整提交推送 `main` 并等待 Git Integration deployment 达到 `READY`；确认维护页 200、HTML、`no-store` 后立即切换 named Mini App URL。此一次性引入过程完成后，后续发布必须在提交推送前完成三项入口隔离。

入口恢复必须等待应用、数据库、OpenAPI、Catalog manifest、Battle checksum 与 migration 全部来自同一已验收提交。恢复顺序固定为：先把 `pokepets_dev` URL 改回环境根 URL并用真实 Telegram 直链复核，再恢复 Main Mini App，最后恢复默认菜单按钮；任一步失败都保持其余入口关闭。

## 不变量

- `pokepets_dev` short name、公开直链格式、邀请参数和 Battle `startapp` 参数保持不变；隔离只改变 BotFather 保存的 Web App URL。
- 维护页不读取 Telegram 用户信息，不创建 session，不发送网络请求，不改变账号、资产、订单、藏品、任务、Battle、支付或数据库状态。
- Vercel Production 在隔离期间继续启用；部署只来自完整 `main` 提交的 Git Integration，不执行手动部署、暂停或空提交。
- 维护页是发布操作面，不是游戏功能开关；开放状态下 named Mini App 必须恢复到环境根 URL，不能把维护页留作正常入口。

## 验收

本地与部署产物必须存在 `maintenance.html`，且不包含项目 JS 或 CSS 引用。目标 Vercel deployment 达到 `READY` 后，稳定域名的维护页必须返回 HTTP 200、HTML 内容类型、`private, no-store, max-age=0` 与 `noindex, nofollow`。

真实 iPhone Telegram 必须从 `https://t.me/FinalTMA_bot/pokepets_dev` 打开，完整显示英语与简体中文维护信息，页面不进入游戏、不出现登录或资产请求。BotFather 必须继续列出 `pokepets_dev`，其 Web App URL 精确等于维护页地址；Main Mini App 保持停用，默认菜单按钮保持默认行为。静态文件存在、浏览器直接打开或 deployment `READY` 不能替代该真实直链验收。
