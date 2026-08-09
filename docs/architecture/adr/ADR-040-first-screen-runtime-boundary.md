# ADR-040：首屏运行时与样式边界

- 状态：已接受
- 日期：2026-08-08

## 背景

生产构建曾把操作结果舞台、进化目录、非首屏页面、全量浏览器路由契约和单体全局样式同时放入首次进入链路。单个入口文件的体积不能证明首屏边界成立，因为默认开盒页和首屏契约是独立异步根，它们的同步依赖仍会形成同一首屏下载闭包。

## 决策

Web 首屏固定为入口、默认 `GachaPage` 和 `client-routes/first-screen` 三个根及其全部同步 import 闭包，并覆盖首屏可用前由入口无条件发起的应用 JS。Telegram 初始化完成后、React 渲染前只预取首屏契约；认证后运行时直接挂载轻量操作 Facade，完整 `OperationRegistryRuntimeProvider` 不在启动阶段请求。Facade 在玩家 `pointerdown`、键盘 `focus`、直接执行操作或发现真实待恢复 operation 时复用同一动态加载任务；模块就绪前先锁定重复动作，模块失败不发送业务 API，并保留重新加载入口。交易、Battle、藏品、任务、转盘、图鉴等页面继续在用户导航或受控后台策略下加载，不进入三个首屏根的同步闭包。后台页面模块预热的启动握手、网络条件、顺序、失败与玩家意图规则全部由 [ADR-043](ADR-043-adaptive-page-module-warmup.md) 接管；Battle 不再自动预热。共享 UI 直接依赖和原生浏览器导航边界由 [ADR-046](ADR-046-first-screen-direct-dependency-and-native-navigation.md) 固定。

轻量 `OperationRegistryProvider` 只提供稳定 Context、首次意图队列、会话 generation 隔离和加载失败重试；重型 `OperationRegistryRuntimeProvider` 才持有操作阶段、幂等键、原 operation 恢复、刷新范围、导航锁、前后台清理和通用处理层。消费 bootstrap 与统一发现结果的恢复 effect 固定通过 `useEffectEvent` 调用最新 `hydrate`，其重新执行只由 operation snapshot、会话和恢复活动条件决定；Runtime 发布新的展示状态不得使相同 snapshot 再次水合。首次运行时代码尚未就绪时只接受一个玩家操作，后续重复动作立即拒绝；运行时挂载后沿用既有完整并发与恢复规则。开盒、进化、分解、市场、转盘和图鉴的结果组件、图片数据及 CSS 分别由 `presentation-loader` 按 `use_case` 动态加载。按钮 `pointerdown`、键盘 `focus` 和提交入口复用缓存加载任务；表现模块与业务请求并行。表现模块失败只重载表现，不重提业务操作；运行时或契约模块在业务请求发出前加载失败时明确失败，不创建 `unknown`。开盒三秒仪式从专用表现组件实际挂载后开始，仪式与权威结果缺一不可。

顶部充值与 VIP 弹窗使用独立动态模块。用户意图或支付恢复只负责打开相应模块；加载失败保留支付订单和导航意图，重新打开只加载 UI。模块准备期间只显示玩家可理解的通用画面，不展示服务器、请求、operation ID 或后端术语。

浏览器固定导入 `@pokepets/api-contracts/app-client` 及其 `app-client/errors` 子边界。`app-client` 按首屏、市场、库存、任务、Battle、转盘、图鉴等领域缓存动态 route loader，并在输入、成功响应和恢复结果进入 UI 前执行 Zod 校验。错误码集合与错误文案/恢复策略分离：基础 Schema 只加载稳定错误码，领域运行时按需加载错误定义。服务端 `/app` registry 只包含当前活动路由；Wallet 与 Mint 只存在于 `/dormant-app`，活动 App handler map 和 OpenAPI 不含对应端点，直接请求继续得到 `API_ROUTE_NOT_FOUND`。

原 `global.css` 永久删除。reset、设计变量、共享按钮/卡片/基础弹窗、Startup、应用壳、顶部资产栏、底部导航、通用处理层和默认开盒页分别形成首屏 CSS；市场、Battle、藏品、任务、图鉴、充值/VIP 弹窗和六类结果舞台由所属异步模块导入 CSS。保持现有选择器、特异性和块内顺序，不引入 CSS Modules 或 cascade layer。Vite 默认 CSS code splitting 负责在异步模块执行前加载对应 CSS。构建目标为 `es2023`，当前 Telegram WebView 基线使用原生 module preload，因此 Vite 的 module preload polyfill 固定关闭。

生产构建插件遍历三个首屏根的同步 chunk 图，对 JS 与关联 CSS 文件去重后逐文件累计原始和 gzip 字节。架构检查固定入口在 React 渲染前只能调用已经登记的 `preloadFirstScreenContracts()`，新增任何无条件启动预取必须先纳入同一门禁；重型 `OperationRegistryRuntimeProvider` 进入闭包直接失败。硬门禁固定为 JS `400000 / gzip 125000` 字节、CSS `110000 / gzip 23000` 字节；非首屏页面、非首屏 route contract、六类结果表现、完整 Battle 模型、非首屏共享 UI、React Router、进化目录 JSON、dormant Wallet/Mint 和 `global.css` 任一进入闭包即失败。门禁不得使用 `manualChunks`、同步 vendor chunk、提高 warning 阈值或改变统计根规避。

## 不变量

- REST、OpenAPI、错误码、金额、概率、库存、数据库 RPC、幂等键和恢复语义不变。
- 表现组件只接收已经通过对应 route Schema 校验的判别结果；数据库仍是业务最终事实来源。
- 表现加载失败不得造成第二次业务提交，重复点击继续由同一 operation 记录锁定。
- 后台页面模块预热必须遵守 ADR-043；首屏静态门禁不等同于 Telegram 真机性能通过。
- `NewMarker` 使用 session generation 隔离的外部内存快照，只在操作运行时或藏品页首次需要时加载；账号切换、封禁和敏感状态清理必须清空快照。
- 本裁决不修改数据库、migration、产品功能文档或玩家最终结果。

## 验收

影响域必须通过格式、ESLint、Web/API/Contracts TypeScript、OpenAPI 漂移、架构检查和生产构建。架构检查必须同时禁止启动预取重型 Runtime、共享 UI barrel、React Router，以及禁止恢复 effect 把 `hydrate` 身份作为重新执行条件。生产构建必须打印四项首屏闭包字节并满足硬门禁，Vite 不得再出现大 chunk 警告，禁止模块数量必须为零。真实开发环境还必须在 Telegram iOS 与 Android 覆盖首次登录、默认开盒、充值/VIP、六类结果、未决/unknown 恢复、导航前进/后退和专用 chunk 阻断；首屏操作意图前不得请求 `OperationRegistryRuntimeProvider`，第一次操作必须立即反馈且只提交一次，真实恢复存在时运行时必须加载并接管。`pending` 与 `unknown` 重进不得因 Runtime 状态发布重复水合同一 snapshot，必须持续查询同一 ID、控制台没有 React maximum update depth 错误，并在终态后停止恢复。验证无 FOUC、无重复提交、表现失败只重载 UI，并用资源瀑布证明运行时、领域 JS/CSS 只在对应意图或真实恢复需要后请求。静态结果不得记录为真机验收通过。
