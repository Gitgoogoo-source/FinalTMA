# ADR-044：操作 Runtime 稳定委托与恢复水合

- 状态：已接受
- 日期：2026-08-09

## 背景

轻量 `OperationRegistryProvider` 按 ADR-040 常驻首屏，重型 `OperationRegistryRuntimeProvider` 通常只在玩家意图或发现真实待恢复 operation 时动态挂载；默认开盒页首屏事实就绪后允许按 ADR-021/040 通过同一动态任务提前挂载 Runtime 并准备开盒表现，以消除首次开盒的通用处理闪屏。真实 iPhone Telegram WebView 验收发现：`pending` 或 `unknown` 转盘 operation 重进会正确请求重型 Runtime，但 Runtime 每次发布新的 Context value 都会改变 Facade `hydrate` 的函数身份；消费入口恢复快照中 `blocking_operations` 的 effect 因依赖该函数而再次注入同一 operation，内层状态再发布新 value，最终触发 React maximum update depth。

## 决策

消费 `identity.initial.recovery.blocking_operations` 与统一恢复发现结果的两个 effect 使用 React `useEffectEvent` 调用最新 `hydrate`。该入口快照固定存于当前 session generation 的内存外部状态，不由 React Query 刷新。`hydrate` 继续由 Facade 在 Runtime 未加载时排队、Runtime 就绪后直接委托，但函数身份不再属于两个 effect 的重新执行条件。完整 Runtime value bridge 已由 [ADR-051](ADR-051-operation-registry-selective-subscription.md) 替代；Runtime 只发布按 route 阻塞、导航锁、恢复队列和展示 epoch 拆分的选择性信号，水合提交使用单调内存 epoch 交接，任何信号发布都不得重新触发相同 snapshot 的水合。

架构门禁永久检查两个恢复 effect 均通过 `useEffectEvent` 调用 `hydrate`，并拒绝把 `hydrate` 恢复到 effect dependency。该门禁与 ADR-040 的首屏同步闭包和禁止模块门禁同时执行，不能通过提前加载重型 Runtime 规避稳定性问题。

## 不变量

- `pending`、`unknown`、终态、权威序号、原 operation ID、轮询节奏、刷新范围、幂等键和数据库裁决均不改变。
- 首屏仍只加载轻量 Facade；重型 Runtime 仍只在玩家意图或真实恢复需要后请求。
- Runtime 状态发布仍须通过选择性信号更新导航锁、恢复队列和 wheel presentation epoch，不允许冻结信号或跳过真实变化来消除循环。
- 不新增浏览器持久化、结果恢复、业务提交、数据库字段、RPC 或 migration。

## 验收

本地影响域必须通过格式、ESLint、Web TypeScript、架构检查和生产构建；发布前执行既有全量静态门禁。生产构建继续满足 ADR-040 的四项字节预算、禁止模块为零且没有大 chunk 警告。

真实 iPhone Telegram WebView 必须分别覆盖无未决 operation、`wheel.spin pending`、同一 operation 转为 `unknown`、最终转为 `failed` 四次冷重进。无未决与终态重进不得请求重型 Runtime；`pending`、`unknown` 必须加载 Runtime 并只查询原 operation ID，控制台没有 React maximum update depth，网络没有第二次 `wheel.spin` 提交。最终数据库读回必须证明没有该 operation 的账本、奖励或转盘结果，资产、库存和原账本基线不变，恢复队列为零。
