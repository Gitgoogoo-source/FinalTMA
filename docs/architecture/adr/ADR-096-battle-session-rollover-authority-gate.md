# ADR-096：Battle 会话换代权威恢复门禁

- 状态：已接受
- 日期：2026-08-30

## 背景

访问令牌保持 15 分钟绝对有效且不使用 Refresh Token。自然过期时，Web 清除旧 session generation 的查询、领域内存和恢复快照，使用当前 Telegram `initData` 交换新令牌，再以 `identity.initial` 恢复当前账号事实。Battle 页面也以 session generation 为组件和查询隔离边界，因此旧 generation 的 room 状态必须被清除，不能跨身份边界保留。

既有成功恢复顺序先把新 session 的 `recovering` 设为 `false`，随后才发布 `identity.initial.recovery`。`PersistentPages` 会在 generation 改变时重建 Battle；这个中间渲染没有旧 room，也尚未看见当前 `battle_participation`。随后恢复快照出现时，Battle 已经按 `room = null` 推导出 `home`，并把仍在进行的 participation 显示成“恢复当前 Battle”按钮。可见页面生命周期又与自动 `battle.bootstrap` 并行触发直接 room 读取，所以数据库房间返回后页面可以自动回到原战斗，但期间短暂暴露了错误首页和手工恢复入口。数据库房间、stake、reservation、动作和结算均未丢失；缺陷属于新 generation 内权威状态尚未到达时的前端排序竞态。

## 裁决

会话自然恢复成功时固定按“清除旧 generation 敏感状态 → 为仍处于 `recovering` 的新 generation 写入 `identity.summary` 与 `identity.initial.recovery` → 将同一 generation 的 `recovering` 设为 `false`”发布。页面只能在恢复快照与摘要均已属于当前 generation 后重新挂载。15 分钟绝对有效期、单次自动恢复、内存令牌、无 Refresh Token、旧 generation 清除和不自动重做资产操作全部保持不变。

Battle 把“当前 generation 的 `battle_participation` 非空且本地尚无同 generation room snapshot”定义为传输层权威恢复门禁。门禁不是第九种业务页面状态，根节点不得写入 `data-battle-page-state`，不得渲染 `home`、档位、业务按钮、错误、Toast、Alert、手工重试或“恢复当前 Battle”；只显示既有“正在找回冒险”“请稍候，伙伴们正在重新集合”反馈。只有以下任一数据库权威事实到达后才能退出门禁：

1. `battle.bootstrap` 返回当前 viewer-specific room snapshot；
2. 由 participation 的 `room_id` 读取到 viewer-specific room snapshot；
3. 新一次 `battle.bootstrap` 明确返回 `participation = null`，证明当前账号已无进行中的 Battle。

`battle.bootstrap` 是新 generation 的首选单一读取。页面 presence 恢复在 bootstrap 初次读取中或权威门禁未解除时不得并行发起第二个 room/bootstrap 读取。首选读取失败，或返回 participation 但缺少 room 时，Battle 使用既有受 session generation 约束的协调器按 `0ms、1s、2s、此后每 5s` 静默读取该 room；room 读取没有形成可发布事实时，再顺序重读 bootstrap 以处理房间同期终结。读取只在 `/game` 活动、文档可见、Telegram 活动且浏览器在线时发出，条件不满足时保留门禁并暂停业务请求。所有重试先复核 generation；旧 generation 的完成结果不得写入当前页面。

首个权威快照到达时先应用 room、用 `latest_action_sequence` 初始化表现游标并标记该 generation 已取得新鲜 authority，再开放 presence lifecycle。紧随其后的 lifecycle 恢复消费这次新鲜事实，不重复读取；后续真正的隐藏返回、Telegram 重新激活或网络恢复仍按既有规则重新读取 room 并建立新 lease。进入 `active_turn` 后继续停止 heartbeat；门禁、重试和会话换代都不提交动作、不改变 deadline、不重播历史事件，也不读写任何资产、房间或结算数据。

Battle 首页只表示数据库已经确认当前账号没有进行中 participation，删除 participation 提示和手工“恢复当前 Battle”入口。数据库仍是唯一事实来源；网络持续失败时页面保持无操作的恢复门禁，不能用缺失响应推导首页。

## 不变量

- 不修改 API、OpenAPI、数据库 schema、migration、RPC、15 分钟令牌期限、Battle 状态、金额、时限、presence、动作或结算契约。
- 不跨 session generation 保存 room、查询缓存、动作表现、operation、恢复结果或敏感数据。
- 不自动重提创建、匹配、接受、取消、攻击、换宠或任何资产操作。
- 产品第 21 章仍只有八种 Battle 业务页面状态；权威恢复门禁属于身份和查询之间的非业务加载边界。
- Ably 仍只提供失效通知，viewer-specific REST snapshot 与数据库仍为最终事实来源。

## 验收

静态门禁必须证明恢复快照先于 `recovering = false` 发布、Battle 权威门禁先于八状态根节点渲染、门禁期间 presence 不发起并行刷新，并证明源码不存在“恢复当前 Battle”和旧 participation notice。

同一 deployment SHA 的真实 iPhone Telegram 与 Safari Web Inspector 必须在真实 `active_turn` 中跨过访问令牌绝对到期点，保存到期前后 DOM、Network、Console 和数据库 room 引用。只允许一次旧令牌 401、一次认证交换及新 generation 的权威 Battle 读取；从恢复页到原 `battle` 的整个区间不得出现 `data-battle-page-state="home"`、“恢复当前 Battle”、可点击档位或业务按钮，不得重放旧动作，也不得产生新的 `battle.action`。恢复后 room ID、双方、当前行动方、round、ordinal、HP、deadline 和最新 action sequence 必须与数据库权威快照一致，并能继续完成后续合法行动。等待房和 lobby 作为影响域重验，必须分别自动回到原状态并恢复新 lease；网络暂时失败时保持门禁，恢复联网后自动回正。静态检查、桌面浏览器或等待房结果不能替代真实 active-turn 结论。
