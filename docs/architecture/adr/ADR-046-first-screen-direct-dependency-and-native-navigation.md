# ADR-046：首屏直接依赖与原生浏览器导航

- 状态：已接受
- 日期：2026-08-09

## 背景

`main@a3a6806` 的生产构建首屏同步闭包为 JS `430921 / gzip 134943` 字节，距离 ADR-040 原 gzip 门禁只剩 57 字节。`apps/web/src/shared/ui/index.tsx` 被首屏和异步页面共同导入，使 `AppModal`、藏品详情和库存操作组件进入入口共享闭包；仅将 37 个调用方改成叶子导入的只读构建模拟仍为 `424745 / gzip 133850` 字节，不能形成稳定余量。首屏同时加载 `react-router-dom` 的通用路由匹配运行时，但活动 Web 只有 `/`、`/market`、`/game`、`/inventory`、`/tasks` 五个常驻页面、`/album` 一个临时详情页，以及内部查询参数和历史返回需求。

## 决策

活动 Web 使用项目自有的原生浏览器导航状态层。`platform/navigation` 以单一共享 `popstate` 监听、History API 和 `useSyncExternalStore` 发布稳定位置快照，统一支持绝对应用路径、`pathname/search/hash` 对象、`pushState`、`replaceState`、`history.go(number)`、历史 state、查询参数和同源约束。登录后的 `/` 或 `/game` 路径替换、五个主导航、任务/支付/操作结果跳转、图鉴返回和 Telegram BackButton 全部使用同一接口。`AppRouter` 直接按位置快照选择常驻主壳或 `/album`，其他路径在 layout effect 中 replace 到 `/`；`AppShell` 继续保留五个主页面，只以明确的临时页面插槽承载图鉴。导航不得读取或预取业务数据。

活动 Web 永久移除 `react-router-dom` 依赖。所有共享 UI 从组件叶子文件直接导入，`apps/web/src/shared/ui/index.tsx` 永久删除。首屏共享 UI 只允许 `Button`、`Card`、`CatalogImage` 和 `PageState`；`AppModal`、`Badge`、`CollectionDetailShowcase`、`InventoryActionDialogHeader` 与 `QuantityControl` 不得进入首屏同步闭包。领域页面、全局弹窗和操作表现继续按 ADR-040/043 的玩家意图或自适应预热边界加载。

ADR-040 的 JS 硬门禁收紧为原始 `400000` 字节、gzip `125000` 字节；CSS 门禁继续为原始 `110000` 字节、gzip `23000` 字节。生产构建把 `react-router` 和非首屏共享 UI 加入禁止模块。架构检查拒绝恢复共享 UI barrel、任何 `shared/ui/index.tsx` 导入、任何活动 Web `react-router` 导入，以及缺少 popstate 订阅、push/replace、数字历史导航或同源保护的导航实现。不得通过 `manualChunks`、同步 vendor chunk、统计根变更或提高门禁规避。

## 不变量

- Startup 画面、文案、资源、ARIA、出现时序、登录阶段和失败重试不变。
- 五个主页面、图鉴、查询参数、系统前进/后退、Telegram BackButton、滚动恢复和页面保活结果不变。
- 玩家导航意图仍先准备目标页面模块且不等待模块 Promise；ADR-043 的网络门禁、自动顺序和 Battle 禁止自动预热规则不变。
- REST、OpenAPI、身份、会话、React Query、刷新范围、操作恢复、幂等、数据库 RPC、资产和业务结果不变。
- Zod 输入/输出校验、数据库最终事实来源和前端 Supabase 边界不因包体优化削弱。
- 本裁决不修改 API contracts、数据库 schema、migration、产品功能或玩家文案。

## 验收

本地影响域必须通过格式、ESLint、Web/API/Contracts TypeScript、OpenAPI 漂移、架构检查和生产构建；发布前执行全量静态回归。构建必须满足 JS `400000 / gzip 125000`、CSS `110000 / gzip 23000`，禁止模块为零且没有 Vite 大 chunk 警告。仓库内不得存在 `shared/ui/index.tsx`、其导入或 `react-router` 依赖。

同一部署 SHA 的 Telegram iOS 与 Android 必须覆盖首次登录、再次登录、普通入口、`BTL_` 入口、五个主导航、查询参数替换、图鉴进入/返回、系统后退/前进、Telegram BackButton、任务/支付恢复/操作结果跳转和非法路径回正。页面筛选、选择、滚动、未提交状态、隐藏页查询门禁、API 请求数量与顺序必须保持既有结果；Startup DOM、文案、动画和出现时序不得变化。资源瀑布不得包含 React Router，非首屏模块仍只在对应意图、真实恢复或 ADR-043 允许的后台预热后请求。静态构建结果不得记录为真实 Telegram 验收通过。
