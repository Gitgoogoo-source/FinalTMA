# ADR-047：Battle 分层运行时加载

- 状态：已接受
- 日期：2026-08-09

## 背景

`main@3a19eeb` 的生产构建中，首次进入 `/game` 下载的 `GamePage` JS 为原始 `306797` 字节、gzip `84008` 字节，CSS 为原始 `64819` 字节、gzip `12396` 字节。静态依赖归因显示 Ably SDK、完整 Battle 技能轨迹播放器、轨迹样式，以及实际只属于任务页转盘/远征面板的 `game-page.css` 同时进入 Battle 首次下载。八种页面状态、倒计时、REST 权威恢复、操作区和结果队列本身不是主要负载，不能通过延迟业务读取、动作提交、倒计时或数据库裁决规避下载问题。

## 决策

Battle 首次进入只同步加载 `BattleView`、八种页面状态、倒计时、REST 权威与恢复、`BattleArena` 控件和布局、轻量本地反馈及 `battle-core.css`。Ably SDK 固定进入 `battleRealtimeRuntime` 动态模块；技能轨迹播放器和 `battle-effects.css` 固定进入 `battleEffectPlayer` 动态模块。`GamePage` 不再导入 `game-page.css`，该文件只由实际组合转盘的任务页导入。动态加载 Promise 成功后复用，失败时删除缓存，允许下次明确意图或恢复再次尝试。

进入非 `home` 的任一权威页面状态后立即并行准备 realtime 与特效运行时，不等待网络类型。`home` 数据稳定后，只有页面可见、浏览器在线、Telegram active、Network Information 明确为 `saveData === false` 且 `effectiveType === "4g"` 时，才在 idle 时准备这两个功能内运行时；未知网络、慢速网络、省流量、离线、隐藏或 Telegram deactivated 不自动下载。Battle 根节点的触摸、指针和键盘焦点属于玩家意图并立即准备运行时，不等待 Promise，也不阻止原点击。该行为只发生在玩家已经进入 Battle 页面之后，不把 `/game` 页面模块加入 ADR-043 的首页自动页面预热序列，也不预取 Battle 业务数据。

Realtime token 请求与 Ably 动态模块下载并行开始。连接达到 `connected` 前，当前页面按既有邀请/接受/lobby `2` 秒、`active_turn` `1` 秒 REST 节奏回正；只有模块、token、订阅或连接实际失败，或浏览器真实离线时，才把状态标记为 `offline`。Ably 仍只触发失效后的 REST 读取，不成为业务事实来源。

技能或换宠反击的业务命令与特效运行时准备并行。模块仍在下载时只在战场行内显示“战斗准备中”，不增加第九种页面状态，不覆盖倒计时，不锁定已由权威快照开放的操作。动态 import、样式或 Web Animations 失败时跳过本次重表现，继续应用 viewer-specific 事件、生命、击倒、权威换宠与终局，并允许后续动作重新加载；表现失败不得重提业务命令。

生产构建对“`GamePage` 静态闭包减去应用入口已交付静态闭包”定义 Battle 增量核心。硬门禁固定为 JS 原始 `160000` 字节、gzip `45000` 字节，CSS 原始 `45000` 字节、gzip `9000` 字节。Battle 增量核心禁止包含 Ably、`battleEffectPlayer.ts` 或带 `data-trajectory` 的重特效 CSS。动态 preload 对已经执行入口 JS 的去重由 ADR-048 补充。不得通过提高预算、改变统计根、把静态依赖伪装成同步 vendor chunk 或延迟业务 API 规避门禁。

## 不变量

- 产品第 21 章的八种页面状态、页面选择顺序、3 秒 lobby 锁定倒计时和每次行动 15 秒不变。
- 玩家动作、heartbeat、offline、REST snapshot、`state_version`、动作游标、幂等 operation、数据库 RPC、资产与结算不变。
- 按钮和倒计时由权威快照立即开放；运行时模块和动画不得成为业务动作的前置条件。
- Ably 只作 subscribe-only 失效通知；连接前和故障后的 REST 恢复保持数据库最终事实来源。
- 命中、伤害、生命、击倒、换宠与结果只消费 viewer-specific 权威事件；本地反馈不宣称业务成功。
- 不新增 API、OpenAPI 字段、环境变量、数据库 schema、migration、页面状态或玩家可操作功能。

## 验收

静态影响域必须通过格式、ESLint、Web TypeScript、架构检查和生产构建。构建必须输出并通过 Battle 增量核心四项硬预算，静态闭包中的 Ably、重特效播放器和轨迹 CSS 必须为零；任务页继续拥有转盘样式。当前实现基线为 JS `93823 / gzip 30374` 字节、CSS `36434 / gzip 7828` 字节。

同一部署 SHA 的 Telegram iOS 与 Android 必须分别验证：首次进入 Battle 首页时首包不请求 Ably 和重特效 chunk；合格 4G 前台 idle 可自动准备，受限或未知网络不自动准备；触摸、指针、键盘意图及非首页权威状态立即开始准备且不延迟页面切换、业务请求、倒计时或按钮。快速点击技能时网络瀑布中的业务请求与运行时下载并行，下载期间只出现“战斗准备中”，15 秒倒计时持续；模块加载失败后 HP、动作权、结果和操作仍按权威事件前进，后续动作可以重试。连接建立前、Ably 失败和重连过程必须保持既有 1—2 秒 REST 回正且不产生重复命令。静态构建通过不能替代这些真机证据。
