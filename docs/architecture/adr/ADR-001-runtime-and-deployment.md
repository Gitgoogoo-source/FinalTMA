# ADR-001：运行时与部署

## 决定

项目使用 pnpm monorepo。React/Vite Web 与三个 Node.js 24 Vercel Function 网关部署在同一 Vercel Pro Project。主 Web 在 React 首帧渲染前按 `ready → expand → disableVerticalSwipes → requestFullscreen` 初始化 Telegram SDK，不显示项目确认弹窗；内容区域下滑不能最小化或关闭主 Mini App，页面自身纵向滚动保持可用，Telegram 标题栏继续提供最小化和关闭入口；不支持垂直滑动控制的旧客户端继续使用客户端原生行为。不支持原生全屏的客户端静默保留已展开的最大稳定视口，并继续按全屏、稳定视口和安全区事件校正布局。唯一的全局顶部资产栏及主壳层内容起点统一使用设备顶部安全区与 Telegram 内容顶部安全区的较大值，禁止写死 Telegram 头部高度或创建页面级资产栏。持续开发使用真实的独立 Vercel 与 Supabase Postgres 17 项目；正式上线时新建另一套独立生产项目。本次未部署 TON 的真实开发环境只调度支付对账和不变量检查 Cron（每 5 分钟）及每日幂等清理；完成 testnet Collection 与全部 TON 配置后，Mint 对账才恢复为每 5 分钟调度。正式生产环境固定运行四项 Cron。

## 约束

真实开发环境和未来生产环境必须部署同一 Git commit 与同一 migration 序列。环境差异只允许域名、项目 ID、合约地址和密钥。生产部署需要用户明确授权。
