# ADR-001：运行时与部署

## 决定

项目使用 pnpm monorepo。React/Vite Web 与三个 Node.js 24 Vercel Function 网关部署在同一 Vercel Pro Project。主 Web 在 React 首帧渲染前按 `ready → expand → disableVerticalSwipes → requestFullscreen` 初始化 Telegram SDK，不显示项目确认弹窗；内容区域下滑不能最小化或关闭主 Mini App，页面自身纵向滚动保持可用，Telegram 标题栏继续提供最小化和关闭入口；不支持垂直滑动控制的旧客户端继续使用客户端原生行为。不支持原生全屏的客户端静默保留已展开的最大稳定视口，并继续按全屏、稳定视口和安全区事件校正布局。唯一的全局顶部资产栏及主壳层内容起点统一使用设备顶部安全区与 Telegram 内容顶部安全区的较大值，禁止写死 Telegram 头部高度或创建页面级资产栏。依据 ADR-086，既有 Vercel `final-tma` 与 Supabase `final-tma-real-test / ebewtjerusxcioegpzjd` 是唯一生产资源，不再新建第二套环境。本次未部署 TON，生产只调度支付对账、幂等清理、不变量监控和公开对象清理四项 Vercel Cron；`reconcile-mints` 不进入调度。

## 约束

生产部署固定来自 `main` 的单一 Git commit、同一 migration 序列、OpenAPI、Catalog manifest 与领域 checksum。生产部署、既有云环境复用及首次清库重建已经由用户明确授权；目标 project、ref、域名与 Bot 由 ADR-086 固定。

生产入口首次开放前发生应用契约与数据库定义双向不兼容变更时，Git commit、按文件名排序的三份 migration、OpenAPI、Catalog manifest 与领域规则 checksum 构成不可拆分的发布单元。Vercel Production 固定保持启用与可访问；完整提交推送到 `main` 后只通过 Git Integration 自动部署至 `READY`，不得暂停 Vercel Project、等待 `503 DEPLOYMENT_PAUSED`、创建空触发提交、部署后重新暂停或执行手动 Vercel 部署。随后在入口关闭状态从同一提交执行最后一次空库重建，应用、数据库、契约与 checksum 全部核对一致后才能恢复生产入口与调度；短暂不匹配不能作为功能可用或发布通过证据。生产入口恢复并开始承载用户后，历史 migration 立即冻结，只允许兼容现有数据库和已加载客户端的前向应用与追加 migration。
