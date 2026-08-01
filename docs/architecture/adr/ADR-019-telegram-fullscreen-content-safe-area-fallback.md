# ADR-019：Telegram 原生顶部控件安全区回退

## 状态

已接受。

## 背景

[Telegram Mini Apps 官方协议](https://core.telegram.org/bots/webapps)定义 `safeAreaInset` 表示设备系统安全区，`contentSafeAreaInset` 表示不会被 Telegram 原生控件覆盖的内容安全区。五个主页的头像、资产入口和页内返回按钮必须位于这两类区域之后。

2026-08-01 的 Telegram iOS 真机画面确认：左侧关闭控件覆盖在 WebView 内容首行，而客户端回报的顶部安全值未把资产栏推离该区域。第一次修复把回退绑定到 `isFullscreen = true`，但重新打开后的真机仍在 `isFullscreen = false` 时显示覆盖 WebView 的原生顶部控件，因此该状态不能用于判断原生控件是否占用内容区域。真机截图中原生控件占用约 35 CSS px，全局壳层需要同时保留触控间距。

## 裁决

全局壳层的顶部起点固定使用设备安全区、Telegram 内容安全区和原生顶部控件回退值的最大值。官方客户端回报值始终优先；仅当 Telegram WebApp 的 `platform` 为 `ios` 或 `android`，且设备与内容安全区的顶部最大值小于 44 CSS px 时，平台同步层才将原生控件回退值设为 44 CSS px。该判断不依赖 `isFullscreen`，因为退出或未进入全屏不代表移动客户端的原生关闭、返回和更多控件不覆盖 WebView。普通浏览器与 Telegram Desktop/Web 不设置该回退值，安全区事件返回更大真实值时继续使用真实值。

回退值只在 `platform/telegram` 与全局壳层中维护。交易、游戏、开盒、藏品和任务页不得增加独立偏移；头像、资产栏、页面内容起点和页内返回按钮共用同一计算结果。

## 结果

五个主页保留原有组件、视觉风格、导航、状态和业务行为。Telegram iOS/Android 全屏成功、全屏失败或客户端状态未及时回正时，原生顶部控件与全局资产栏都不再共用同一垂直区域；官方客户端给出更大安全值时布局继续自动扩展，Telegram Desktop/Web 不产生额外顶部留白。
