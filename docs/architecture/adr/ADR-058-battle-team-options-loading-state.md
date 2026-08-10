# ADR-058：Battle 队伍候选首次加载状态

- 状态：已接受
- 日期：2026-08-10

## 背景

Battle 的 `team_select` 与可接受邀请页面都从 `battle.team_options` 读取本人可用藏品。查询尚未返回时，React Query 的 `data` 为空，原页面级 `loading` 却只包含 bootstrap、identity、invite 与 room；`TeamSelector` 因而把请求期间的空数组当成真实空结果，短暂显示“没有符合条件的可用藏品”，随后才渲染实际藏品。

## 裁决

Web 以页面是否处于 `team_select`，或是否处于 `invite_status=available` 的接受页，形成唯一 `teamOptionsRequired` 条件。该条件同时决定 `battle.team_options` 是否启用，以及其首次 `isLoading` 是否并入既有页面级 `loading`。

首次读取期间 `TeamSelector` 固定显示“正在读取本人可用藏品”，并沿用既有 loading 规则禁用“邀请好友”“随机匹配”或接受动作。只有首次读取完成后，当前搜索与分页确实没有可见项时，才允许显示“没有符合条件的可用藏品”。已有数据的后台刷新不清空列表，也不重新切换到首次加载状态。

不新增本地副本、占位藏品、默认队伍或服务端文案，不改变 API、DTO、缓存键、请求次数、数据库、资产、reservation、匹配、接受或结算裁决。

## 验收

- 格式、ESLint、TypeScript、架构、完整静态门禁与生产构建通过。
- Git Integration 部署同一提交后，在真实 iPhone Telegram 从 Battle 首页进入队伍选择；Safari Web Inspector 对同一次 `team-options` 请求证明 pending 期间 DOM 只有加载状态且按钮禁用，响应后直接渲染实际藏品，不出现错误空状态。
- 有效邀请的接受者队伍选择复用同一条件；若当前账号确实没有符合条件的藏品，必须在响应完成后才显示真实空状态。
