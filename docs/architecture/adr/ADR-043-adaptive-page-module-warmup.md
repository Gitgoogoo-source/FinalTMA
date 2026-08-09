# ADR-043：自适应页面模块预热

- 状态：已接受
- 日期：2026-08-09

## 背景

原后台调度在首页加载后使用一个并发批次加载交易、Battle、藏品、任务和图鉴模块，没有判断网络类型、省流量设置、页面可见性或 Telegram 活动状态。该行为会在玩家尚未表达导航意图时争抢首屏后的带宽，并在未知或受限网络中下载较大的 Battle 页面。模块加载入口同时分散在 `React.lazy`、路由和后台调度中，失败缓存与重试语义不统一。

## 决策

路由层维护唯一 `PreloadablePagePath = MainPagePath | "/album"` 页面模块注册表。所有 `React.lazy`、玩家导航意图和后台调度只调用 `loadPageModule(path)`；同一路径复用同一个进行中或已成功 Promise。动态 import 失败时只删除对应失败 Promise，允许后续明确玩家意图重新加载。

默认开盒页仅在当前 session generation 页面活动、认证返回或回退 `identity.initial` 已把摘要写入 `identity.summary`、`gacha.bootstrap` 与目录快照均已完成读取、开盒规则完整并且当前所选箱子主图已成功解码时调用 `markFirstScreenReady(generation)`。`AppRouter` 只在 `/` 收到同 generation 信号后异步加载后台调度器；首屏任一条件失败、会话已更换或直接进入 `/game` 时不启动自动预热。日常摘要后续刷新不重新触发首屏恢复快照。

自动调度必须同时满足以下全部条件：`document.readyState === "complete"`、`document.visibilityState === "visible"`、浏览器在线、Telegram 未收到 `deactivated`、Network Information 明确提供 `saveData === false` 且 `effectiveType === "4g"`。Network Information 不存在或任一字段不完整均属于未知网络，禁止自动预热；该判断只影响性能优化，不影响页面功能与玩家主动导航。调度监听 `load`、`online`、`offline`、`visibilitychange`、Network Information `change` 及 Telegram `activated/deactivated`。条件失效时取消尚未开始的 idle 或 timer；已经开始的动态 import 不能中止，允许当前模块完成，但条件恢复前不得开始下一个。

自动顺序唯一固定为藏品、任务、交易、图鉴。每个 idle 时段只准备一个页面，前一个成功后才安排下一个。Battle 不在自动列表，只能由玩家导航意图或真实路由进入触发。自动模块加载失败后终止本次 Web 运行期的整个自动序列，不循环、不自动重试；玩家随后明确导航时仍通过已清除失败 Promise 的统一 loader 重试。

五个底部导航在非锁定且目标非当前页时，以 `pointerenter`、`pointerdown`、键盘 `focus` 和点击兜底准备目标模块。图鉴入口及图鉴内跳转、任务去完成、库存出售到市场、月卡详情、支付恢复和操作结果的程序化跳转在 `navigate()` 前调用同一准备入口。导航不等待模块 Promise，既有 Suspense 继续承担页面加载反馈。

页面模块准备只执行对应页面的动态 import 及其 CSS 依赖，不挂载页面，不调用 `prefetchApiQuery`、React Query 或任何市场、库存、任务、图鉴、Battle API。REST、OpenAPI、数据库、缓存新鲜度、页面状态、业务规则和玩家文案不变。

## 不变量

- 未知网络、慢速网络、省流量、离线、隐藏或 Telegram `deactivated` 时没有自动页面 chunk。
- Battle 永远不进入后台自动预热序列。
- 自动序列严格串行，单次空闲调度只加载一个页面模块。
- 玩家意图优先且导航立即发生；导航锁定时不响应意图预热。
- 模块预热与页面业务数据预取严格分离，数据库仍是业务最终事实来源。
- ADR-040 的首屏 JS/CSS 硬预算不提高，非首屏页面不得进入首屏同步闭包。

## 验收

本地静态影响域必须通过格式、ESLint、Web TypeScript、架构检查和生产构建，发布前执行既有全量静态回归。生产构建必须继续满足 ADR-040/046 的 JS `400000 / gzip 125000` 与 CSS `110000 / gzip 23000` 硬门禁。

同一部署 SHA 的 Telegram Android 与 iOS 必须分别验证：首屏完成前无自动预热；合格 4G、非省流量且前台时四个小页面严格串行；Battle 不出现在后台瀑布；省流量、2G/3G、未知网络、离线、隐藏和 `deactivated` 没有自动页面 chunk；恢复合格条件后才继续。触摸、指针和键盘导航必须在意图时开始目标 chunk 且路由立即切换；只预热未进入页面时不得出现目标领域 API。自动加载失败后不得继续或循环重试，随后明确点击目标页必须能够重新尝试。静态通过不等同于 Telegram 真机验收通过。
