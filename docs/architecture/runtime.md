# 运行时

## Web

`apps/web` 使用 React、Vite 与 TypeScript。`app` 拥有启动、账号门禁、Provider、恢复协调、Router、顶部资产栏、全局弹窗和五个主导航壳层；`pages` 是跨领域 UI 的唯一组合层；`domains` 只拥有本领域 UI 与实际使用的类型；`workflows` 管理会话、操作、支付与 Mint 恢复；`platform` 封装 Telegram、TON、HTTP 与 React Query；`shared` 保存跨领域纯 UI。

Web 只导入 `@pokepets/api-contracts/app`。领域 UI 不导入其他领域，库存页组合库存、进化和分解，任务页组合任务和邀请，市场页组合市场和 VIP。

Telegram WebApp 在 `createRoot().render()` 前同步初始化，首帧即写入主题、稳定视口、四边设备安全区、四边内容安全区、Header/Background 和 HTML `theme-color`；运行中继续监听主题、安全区和视口事件。TON Connect Provider 只在 Wallet 弹窗和 Mint 页面加载。普通页面启动不下载或初始化钱包能力。访问令牌只保存在 JavaScript 运行内存中，页面重载后重新使用 Telegram `initData` 交换。

## Functions

根目录 `api/app.ts`、`api/integrations.ts`、`api/jobs.ts` 是三个薄适配器，只创建 `@pokepets/api/entrypoints` 网关。每个 entrypoint 显式注入本网关的 route registry 与完整 handler map；三个 registry 互不导入。请求按“网关认证、路由匹配、会话认证、入口交接门禁、契约输入解析、领域查询或工作流、契约输出解析、标准信封”执行。只有 `referral.bind` 和 `operations.get` 声明 `allowPendingEntryHandoff`。

`apps/api/domains` 不跨领域组合业务，每个 handler 只完成输入映射并调用一个 RPC；支付、退款、Mint 对账、定时任务和操作恢复进入 `apps/api/workflows`。Functions 不计算价格、奖励、库存、资产归属或最终交易结果。

契约包 `/app`、`/integrations`、`/jobs` 分别服务三个网关；`/server` 只用于 OpenAPI 与服务端静态校验；`/common` 提供不加载路由注册表的信封、错误和基础路由类型。

## 部署

Web 与三个 Functions 位于同一 Vercel Pro Project，运行时为 Node.js 24。普通构建只构建 API 契约、API 与 Web；`contracts/ton` 使用独立 `pnpm chain:build` 门禁。真实开发环境与未来生产环境使用同一 Git commit 和迁移序列。
