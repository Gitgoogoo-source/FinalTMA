# ADR-019：Telegram 原生顶部控件安全区回退

## 状态

已接受。

## 背景

[Telegram Mini Apps 官方协议](https://core.telegram.org/bots/webapps)定义 `safeAreaInset` 表示设备系统安全区，`contentSafeAreaInset` 表示不会被 Telegram 原生控件覆盖的内容安全区。五个主页的头像、资产入口和页内返回按钮必须位于这两类区域之后。

2026-08-01 的 Telegram iOS 真机画面确认：左侧关闭控件覆盖在 WebView 内容首行，而客户端回报的顶部安全值未把资产栏推离该区域。第一次修复把回退绑定到 `isFullscreen = true`，但重新打开后的真机仍在 `isFullscreen = false` 时显示覆盖 WebView 的原生顶部控件，因此该状态不能用于判断原生控件是否占用内容区域。第二次修复把 44 CSS px 当成相对屏幕顶部的绝对最小值，但真机已经上报约 47 CSS px 的设备安全区，`max(47, 44)` 仍是 47，无法避让位于设备安全区之后的原生控件行。真机截图中原生控件占用约 35 CSS px，全局壳层需要在设备安全区之后继续保留 44 CSS px 控件与触控间距。

## 裁决

平台层先计算客户端已报告的顶部值 `reportedTop = max(safeAreaInset.top, contentSafeAreaInset.top)`。仅当 Telegram WebApp 的 `platform` 为 `ios` 或 `android` 时，再计算原生控件补充量 `controlsInset = max(0, safeAreaInset.top + 44 - reportedTop)`；全局壳层的唯一顶部起点为 `reportedTop + controlsInset`。因此设备安全区之后固定保留 44 CSS px 原生控件与触控间距，而官方 `contentSafeAreaInset.top` 已经覆盖该区域时补充量自然为零，官方更大值继续优先。该判断不依赖 `isFullscreen`，因为退出或未进入全屏不代表移动客户端的原生关闭、返回和更多控件不覆盖 WebView。普通浏览器与 Telegram Desktop/Web 的补充量固定为零。

回退值只在 `platform/telegram` 与全局壳层中维护。交易、游戏、开盒、藏品和任务页不得增加独立偏移；头像、资产栏、页面内容起点和页内返回按钮共用同一计算结果。

## 结果

五个主页保留原有组件尺寸、视觉风格、导航、状态和业务行为。iPhone 已上报的设备安全区不会再抵消原生控件行补充量；Telegram iOS/Android 全屏成功、全屏失败或客户端状态未及时回正时，原生顶部控件与全局资产栏都不再共用同一垂直区域。Telegram Desktop/Web 不产生额外顶部留白。
