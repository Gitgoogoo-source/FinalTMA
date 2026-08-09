# ADR-048：Battle 动态预加载入口去重

- 状态：已接受
- 日期：2026-08-09

## 背景

`main@05acc631c5a1f37fb3857d0d68a8f0199aae1183` 的真实 iPhone Telegram WebView 验收确认：首次进入 Battle 首页只同步取得核心资源，但第一次触摸触发 realtime 与重表现运行时后，Vite 生成的动态 preload 映射又包含已经执行的应用入口 `assets/index-*.js`。iOS 18.7.2 Safari Web Inspector 的 Resource Timing 与网络请求均显示该入口再次以 `link` 发起 `200` 响应并传输 `112561` 字节。

`battleRealtimeRuntime` 对应用入口共享帮助函数的真实 ESM 依赖是正确依赖；重复传输来自动态 preload 提示对已执行入口的再次提示。全局修改缓存响应只能掩盖重复请求，删除真实依赖或复制入口代码都会破坏模块边界。

## 决策

Web 构建通过 Vite `modulePreload.resolveDependencies` 处理动态 preload 依赖。仅当目标文件匹配 `battleRealtimeRuntime-*.js` 且宿主为 JavaScript 时，从提示中删除 `assets/index-*.js`；realtime 动态模块、真实 ESM 依赖、样式和重表现运行时提示全部保留。浏览器加载 realtime 时由已经执行的原生模块记录复用应用入口，不再次创建入口的 `modulepreload` 请求。

`battleRuntimeBudget.ts` 同时解析 `GamePage` 的动态 preload 映射。生产构建中应用入口 JS 依赖数量必须为零；发现 `assets/index-*.js` 即构建失败。不得通过提高预算、关闭全部动态 preload、恢复 Ably 到 Battle 核心、复制入口代码或修改全局缓存策略规避该门禁。

## 不变量

- ADR-047 的 Battle 核心、realtime 与重表现三层边界、触发时机和失败降级不变。
- `battleRealtimeRuntime` 的真实 ESM 依赖不变；只调整构建生成的资源提示。
- 八种页面状态、业务动作、REST/Ably 恢复、倒计时、权威事件、API、数据库、资产与结算不变。
- 不新增环境变量、API、OpenAPI 字段、数据库 schema、migration 或玩家可见文案。

## 验收

生产 build 必须输出 `Battle dynamic preload entry JS: 0`。`GamePage` 动态 preload 映射可以包含 realtime、重表现及其 CSS，但不得包含 `assets/index-*.js`。

相同部署 SHA 的 Telegram iOS 与 Android 必须分别从全新 WebView 进入 Battle 首页：首次交互前应用入口资源只有一次 `script` 加载；第一次触摸或其他玩家意图后 realtime 与重表现运行时开始下载，但应用入口的 Resource Timing 记录仍只有一次，并且不得新增 `link` 或 `modulepreload` 入口请求。静态构建通过不能替代真机网络证据。
