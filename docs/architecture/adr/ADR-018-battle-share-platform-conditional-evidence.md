# ADR-018：Battle 平台条件型分享证据与发布门禁

## 状态

已接受。

## 背景

[Telegram Mini Apps 官方协议](https://core.telegram.org/bots/webapps)为 `shareMessage(message_id, callback)` 定义成功 callback，并定义 `shareMessageSent` 与 `shareMessageFailed` 事件。官方失败事件包含 `USER_DECLINED`、`MESSAGE_SEND_FAILED`、`UNSUPPORTED`、`MESSAGE_EXPIRED` 与 `UNKNOWN_ERROR`，但没有规定“调用超过固定 deadline 未回调即 unknown”。`UNKNOWN_ERROR` 是客户端已经发出的明确失败事件，不是应用根据无回调自行推断的状态。

Battle 另有一条发生在房间进入 `waiting` 之前的 Prepared inline message 创建 saga。该服务端路径允许外部结果未知，并继续使用原 `create_operation_id`、同一 room、同一 bearer invite、60 秒恢复、超时作废/退款、幂等与一致性控制。它与 `waiting` 房间中用户打开 Telegram 原生分享面板后的 callback 不是同一状态机。

## 裁决

`waiting` 房间分享反馈固定分类如下：

| 平台结果                                               | 产品语义                                                     | 证据状态                              |
| ------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------- |
| `USER_DECLINED` 或 callback 明确返回未发送             | 用户关闭面板或取消分享；显示既定可重试本地反馈，不是发送失败 | 已有本地取消反馈路径；不要求故障证据  |
| `shareMessageSent` 或成功 callback                     | 挑战卡已发送；房间继续等待首位有效对手                       | 已有真实运行证据                      |
| `MESSAGE_SEND_FAILED` 或 Telegram 官方等价明确失败事件 | 显示既定失败/重试反馈；不改变房间、资产或业务裁决            | `PLATFORM_CONDITIONAL`                |
| 固定时限内没有 callback                                | Telegram 官方没有定义该结果                                  | `NOT_APPLICABLE_BY_PLATFORM_CONTRACT` |

Web 只接受当前 session generation、当前创建者 `waiting` room 且由本房间实际发起分享的 callback 或全局事件。切换房间、进入终态、离开再进入 `/game` 或重新认证时使旧尝试失效；分享反馈只保存在内存，不进入 API、数据库、资产刷新、分享状态机或 Battle 业务成功判定。

不得为取得运行证据新增 waiting 分享 timeout、用户可见 unknown、测试 API、mock、故障注入开关、断网验收、Bot/群权限篡改或临时代码。Prepared inline message 创建阶段的 60 秒恢复及安全控制保持不变。

## 发布门禁

平台明确发送失败依赖真实 Telegram 故障，发布时以 Telegram 官方协议、实现中的明确失败路径、房间/会话反馈隔离和既有恢复机制收口，不要求虚构确定性触发。未来真实 `MESSAGE_SEND_FAILED` 或官方等价事件自然发生时，按既有观测规范追加脱敏运行证据；除非实际行为与本文不一致，否则不重新阻塞已经关闭的原始 Battle 第 4 项。

原始 Battle 第 4 项固定关闭为 `CLOSED_WITH_PLATFORM_CONDITIONAL_EVIDENCE`：A/H 为 V09 `PASS`，B–G 为 04C `PASS`，跨房间分享反馈隔离为 V09 `PASS`，B/C/D 同房间并发、唯一赢家 UI 与恢复为 V12 `PASS`，I 为 `PLATFORM_CONDITIONAL`，J 为 `NOT_APPLICABLE_BY_PLATFORM_CONTRACT`。I 不得写成真实 PASS，J 不得写成 PASS、FAIL、TODO 或待实现功能。

## 结果

本裁决只收敛分享证据分类和发布门禁，不改变用户可见功能、金额、房间或分享状态机、资产规则、API、DTO、OpenAPI、数据库、migration、Cron、环境变量、Bot 配置、Telegram 群设置或错误码。Prepared inline message 创建阶段的结果未知仍按独立服务端路径恢复，`waiting` 分享不再推断平台未定义的 no-callback unknown。
