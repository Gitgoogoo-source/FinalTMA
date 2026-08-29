# ADR-092：低延迟按钮按下音效

- 状态：已接受
- 日期：2026-08-29
- 替代：[ADR-091](ADR-091-global-button-click-audio.md) 的运行时资源、播放引擎与触发时机

## 背景

真实 iPhone Telegram WebView 与 Safari Web Inspector 诊断确认，页面导航与按钮业务处理没有阻塞，卡顿来自音效链路。ADR-091 等到触屏 `pointerup` 之后的可信 `click` 才调用三个 `HTMLAudioElement` 播放器；原始 `button-click-music.mp3` 解码后在首个可听波形前存在约 `47.483ms` 静音，可听主体结束后另有约 `97.891ms` 静音。用户因此先经历按下到抬起，再经历音频前导空白，声音无法与按压反馈同步。

用户已裁决按钮音效改为按下即响，并接受玩家按下按钮后滑开取消时仍可能已经听到短促反馈。音效继续只表示按钮被按下，不表示导航、请求、资产变更或业务操作成功。

## 唯一结论

原始 `button-click-music.mp3` 作为母版原样保留，SHA-256 固定为 `5230a59c6cae7c0b7937099c064de2e51289a632c44f5b4128fb4499feda25e9`，不进入 Web 运行时引用。运行时只引用同目录的 `button-click-music.runtime.wav`：从母版裁掉前导与尾部静音，头尾各保留约 `2ms` 安全区并应用对应的短淡入淡出；格式固定为 `44.1kHz`、双声道、`16-bit PCM WAV`，时长 `0.041474s`，SHA-256 固定为 `8bd9dbce6c80a818d1542c550a140d003d077b5776d35922a97d9daa022f968e`。衍生文件不得改变原可听主体的音高、节奏或统一音色。

应用入口继续立即动态加载独立的按钮音频模块。模块创建一个 `latencyHint: "interactive"` 的 `AudioContext`，同源获取并只解码一份运行时 WAV 为复用 `AudioBuffer`，通过固定 `35%` 的共享 `GainNode` 输出。每次反馈创建一次轻量 `AudioBufferSourceNode`，结束后立即断开；最多允许八个短源同时存活，超过上限时停止最早的源，避免恶意或异常高频输入累积资源。不得继续创建 `HTMLAudioElement` 播放池、重置 `currentTime` 或为每次反馈重新获取、解码音频。

捕获阶段监听可信主指针的 `pointerdown`。事件必须满足 `isPrimary=true`、主按钮 `button=0`，且目标向上最近的控件必须是原生 `button`、按钮型 `input` 或具有 `button`、`radio`、`tab` 语义的可用控件；满足后在原始事件调用栈内恢复音频上下文并立即排定播放。随后的同一控件可信 `click` 必须去重。iOS Telegram WebView 可能在 `pointerup` 与 `click` 之间先执行零延迟定时器，因此 `pointerup` 不得立即清除去重状态；状态保留至对应 `click` 消费，最迟在一秒后自动清除，`pointercancel` 则立即清除。键盘、VoiceOver 或其他没有对应 `pointerdown` 的可信 `click` 作为无障碍后备播放一次。程序触发的非可信事件、非主指针、非主鼠标键、原生 `disabled`、`aria-disabled="true"`、`inert`、`hidden`、输入、普通画面及从非按钮区域开始的滚动或拖动均静默。

运行时 WAV 尚未完成解码、Web Audio 不可用、上下文恢复被浏览器拒绝、资源加载或解码失败、系统静音时，只允许省略当次表现并在后续真实交互重试准备；不得阻塞控件动作、显示技术错误、重试业务操作或改变前端、API、数据库状态。模块热替换或卸载时必须移除全部全局监听器、停止并断开活动源、断开增益节点并关闭自身上下文。

按钮音频上下文与 ADR-082 的开盒专用程序化音频上下文保持隔离。本裁决不改变开盒音色、动画时间轴、Telegram 触觉、按钮业务处理、路由、支付、资产、随机、资格、保底、藏品、API、RPC、数据库、环境变量、CSP 或持续成本。

## 验证

影响域先执行按钮音频文件的 Prettier、ESLint 与 Web TypeScript 检查；发布前执行仓库完整静态验证和 Production Build。构建产物必须只包含一份哈希运行时 WAV，不得包含原始 MP3；构建后的 WAV 必须与源衍生文件 SHA-256 一致。媒体检查必须确认运行时 WAV 为 `44.1kHz` 双声道 PCM、时长 `0.041474s`、文件头无时间偏移，首尾连续静音各不超过 `3ms`，无削波和额外可听内容。

真实设备验收分成两轮。第一轮关闭 Safari Web Inspector，在设备取消静音、媒体音量可听的真实 iPhone Telegram 中逐项按下文字按钮、图标按钮、底部导航、页签、弹窗按钮和按钮式卡片，确认声音与按下同步、音色一致、快速连续按压不漏播或爆音；禁用控件、输入、普通画面以及从非按钮区域开始的滚动和拖动保持静默。按住按钮后滑开可以已经播放一次，但不得触发第二次声音或业务动作。

第二轮连接 Safari Web Inspector，确认运行时 WAV 只有一次同源成功获取与一次解码，`AudioContext` 能在真实用户激活后进入 `running`，每次主指针按下只创建一个 `AudioBufferSourceNode`，后续 `click` 不重复创建，键盘或 VoiceOver 后备点击创建一次，控制台没有 CSP、资源、解码、未处理 Promise 或运行时错误。事件证据必须同时覆盖真实 iPhone Telegram WebView 的 `pointerdown` 与后续 `click`，防止桌面浏览器事件顺序掩盖 iOS 在两者之间执行零延迟定时器的问题。静态检查、构建、普通浏览器试听、程序触发的非可信点击和 Inspector 播放链路证据均不能替代第一轮真实 iPhone 人耳结论。
