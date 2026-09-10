# 弹窗本地验收

运行 `pnpm dev:web`，打开 <http://localhost:5173/dev/dialog-review.html>。

这是开发专用入口，生产构建只使用 `index.html`，不会包含此页面。页面只允许 localhost 开发环境，使用内存模拟账户和奖励，所有 fetch 均被本地模拟处理，未配置的请求直接拒绝；不调用真实 API、支付或 Telegram 权限。示例价格、奖励与日期仅用于布局检查，宠物图使用缺图回退。

- 页面按钮打开实际 VIP、充值、进化确认、分解确认、远征组件和加载占位。支持中文/英文切换。可以使用 `?view=vip&lang=zh` 直接打开状态。
- “运行回归检查”使用实际 OperationRegistryProvider 和 API 契约，验证双击单次提交、权威奖励数量、成功通知收起、未知结果保留和恢复、只查询原 operation ID、技术错误文案过滤、普通弹窗中的反馈焦点范围，以及未确认的进化结果不可跳过。
- 类型检查：`pnpm exec tsc --noEmit -p apps/web/dev/tsconfig.json`。
- 实际 Telegram 原生权限、真实 Stars 支付回调和手机 WebView 仍需发布后的真机验收；本页不替代这些结果。
