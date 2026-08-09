# ADR-051：操作注册中心稳定命令与选择性信号订阅

- 状态：已接受
- 日期：2026-08-09

## 背景

五个主页面按 ADR-037 首次访问后持续挂载。原操作注册中心把 `run`、`preload`、`present`、`hydrate` 命令与 `isBlocked`、导航锁、恢复队列、转盘展示 epoch 合并在同一个 React Context value 中。重型 Runtime 的 operation 阶段、结果或展示状态变化会生成新的完整 value，经 `RuntimeValueBridge` 写入轻量 Facade；根 Context 随后广播全部消费者，使未使用已变化字段的常驻页面也重新渲染。只给 Facade value 增加 `useMemo` 不能解决问题，因为 Runtime value 本身仍随 operation 状态变化。

## 决策

操作注册中心使用一个在 `OperationRegistryProvider` 生命周期内永不替换的 `OperationRegistryStore` 作为唯一 Context value。Store 提供身份稳定的 `run`、`preload`、`present` 和 `hydrate` 命令，命令通过内部 ref 委托给按意图动态加载的 Runtime controller；Runtime controller 不进入 React Context，也不通过 React state 回写 Facade。

动态状态固定拆为四类选择性信号：每个 `RecoverableRouteId` 独立的阻塞布尔值、全局导航锁、恢复队列活动状态和转盘展示 epoch。Store 为每类信号维护独立订阅频道，Runtime 发布新派生状态时先比较旧值，只通知实际改变的频道。领域组件通过 `useOperationBlocked(routeId)` 订阅一个明确 route；底部导航、统一恢复发现和转盘分别通过专用 Hook 订阅自己的单一信号。只执行命令的组件使用 `useOperationCommands()`，不订阅任何动态状态。聚合式 `useOperationRegistry()` 固定删除，活动和休眠源码都不得恢复该接口。

完整 operation 记录、阶段、结果、错误、动画、弹窗、恢复轮询和表现模块继续由 `OperationRegistryRuntimeProvider` 的 React state 持有。Store 只保存用于 UI 订阅的派生信号、Runtime controller ref、首次意图和待水合交接状态，不保存业务结果，不成为资产、奖励或业务裁决事实来源。

Runtime 通过稳定 host 在 layout 阶段挂载 controller，并分别发布派生信号。首次意图在 Runtime 接管前继续由 Facade 提供 route 阻塞和导航锁；只有 Runtime 已发布同 route 阻塞事实后才原子移除 Facade 临时信号。水合交接为每次 `hydrate` 分配单调递增的内存 epoch；Facade 的恢复队列临时信号保留到 Runtime 发布不小于该 epoch 的提交信号，随后与 Runtime 恢复队列状态原子合并。Runtime 卸载使用实例身份校验，旧实例的迟到发布或清理不得覆盖新 controller。

ADR-044 的两个恢复入口继续通过 `useEffectEvent` 调用最新 `hydrate`，不得把 hydrator 身份放回 effect dependency。ADR-040 的首屏动态边界继续有效：轻量 Store、Context 和 Facade 可进入首屏，重型 Runtime、领域表现和结果 CSS 只能在玩家意图或真实恢复需要后加载。

## 不变量

- operation UUID、幂等键、阶段、原操作查询、刷新范围、权威序号和数据库裁决不改变。
- `pending`、`unknown`、终态展示、进化回执、前后台清理和 session generation 隔离不改变。
- Telegram `deactivated`、文档隐藏、离线、`pagehide` 与重新激活的恢复生命周期不改变。
- 不新增 API、RPC、数据库字段、migration、浏览器持久化或网络请求。
- 不通过 `React.memo`、冻结 Context value、提前加载 Runtime 或降低结果刷新来规避重渲染。

## 验收

架构门禁必须证明聚合 Hook、`RuntimeValueBridge`、Facade `runtimeValue` state 和 Runtime 内层 Operation Context 均不存在；Context value 是一次创建的 Store；所有消费者只使用稳定命令或专用选择 Hook；恢复 effect 继续使用 `useEffectEvent`；重型 Runtime 继续处于首屏禁止模块集合。

影响域必须通过格式、ESLint、Web TypeScript、架构检查和生产构建；发布前执行既有全量静态门禁。生产构建继续满足 ADR-040/046 的首屏闭包预算和禁止模块要求。

真实开发环境使用同一部署 SHA 在 Telegram iOS 与 Android 验证：先访问全部五个主页面使其常驻，再分别执行开盒、市场命令、转盘及未决 operation 冷恢复。一个信号没有变化时，其无关消费者不得产生由操作注册中心触发的额外 render commit；命令只提交一次，底部导航锁无闪断，Runtime 只加载一次，恢复只查询原 operation ID，控制台无 React maximum update depth，网络请求、结果弹窗、资产、库存和数据库终态与改造前一致。静态结果和普通浏览器结果不能替代真实 Telegram 验收。
