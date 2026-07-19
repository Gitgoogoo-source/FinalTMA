# 运行时

## Web

`apps/web` 使用 React、Vite 与 TypeScript。`app` 只负责启动、Provider、Router 和五个主导航壳层；`pages` 组合领域视图；`domains` 拥有业务 API、模型和 UI；`workflows` 管理会话、操作、支付、Mint 与导航恢复；`platform` 封装 Telegram、TON、HTTP 与 React Query。

TON Connect Provider 只在 Wallet 弹窗和 Mint 页面加载。普通页面启动不下载或初始化钱包能力。访问令牌只保存在 JavaScript 运行内存中，页面重载后重新使用 Telegram `initData` 交换。

## Functions

根目录 `api/app.ts`、`api/integrations.ts`、`api/jobs.ts` 是三个薄适配器，只创建 `@pokepets/api/entrypoints` 网关。请求按“网关认证、路由匹配、会话认证、契约输入解析、领域查询或命令、契约输出解析、标准信封”执行。

`apps/api/domains` 不跨领域组合业务；支付、退款、Mint 对账和操作恢复进入 `apps/api/workflows`。Functions 不计算价格、奖励、库存、资产归属或最终交易结果。

## 部署

Web 与三个 Functions 位于同一 Vercel Pro Project，运行时为 Node.js 24。普通构建只构建 API 契约、API 与 Web；`contracts/ton` 使用独立 `pnpm chain:build` 门禁。测试与生产使用同一 Git commit 和迁移序列。
