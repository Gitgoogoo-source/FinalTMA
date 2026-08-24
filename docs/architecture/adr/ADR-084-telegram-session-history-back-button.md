# ADR-084：Telegram 会话历史原生返回按钮

## 背景

[Telegram Mini Apps 官方协议](https://core.telegram.org/bots/webapps#backbutton)从 Bot API 6.1 起提供 `Telegram.WebApp.BackButton`。Mini App 可以显示或隐藏 Telegram 标题栏中的原生返回按钮，并监听点击事件；[Web Events 协议](https://core.telegram.org/api/web-events#web-app-setup-back-button)规定按钮显示时客户端发送 `back_button_pressed`，按钮未显示时由客户端保留关闭 WebView 的行为。项目不能修改 Telegram 原生关闭按钮的图标、文案或默认动作，只能在存在安全的应用内上一页时显示官方 BackButton，并自行完成返回。

活动 Web 已使用浏览器 History API 统一处理五个主导航、查询参数、图鉴、任务、支付恢复、操作结果跳转和系统前进/后退，但原生 BackButton 只由图鉴与休眠 Mint 页面局部注册。该实现把按钮状态绑定到页面组件，而不是当前历史是否存在安全的应用内前项；五个主导航之间已经产生应用内历史时仍显示关闭按钮，页面卸载还可能与其他页面争用 `show()`、`hide()` 和事件清理。

## 决策

每次 Web 文档启动建立一个只属于当前 TMA WebView 运行期的导航会话。`platform/navigation` 在当前浏览器历史项的 `history.state` 中保存命名空间隔离的 `session_id`、从 `0` 开始的 `index` 和调用方原始 state；该元数据只存在于当前浏览器历史，不写入 `localStorage`、`sessionStorage`、Telegram CloudStorage、API 或数据库。

当前文档首次历史项固定为 `index = 0`。登录后的普通入口、推荐入口与合法 Battle 入口使用 `replaceState` 归一化路径，因此继续属于同一个会话根。真实 `pushState` 页面跳转把 `index` 增加 1；五个底部主导航与其他页面跳转使用同一规则。`replaceState` 保留当前 `index`，查询参数替换、非法路径回正和入口归一化不得制造返回层级。未携带新 state 且目标 `pathname + search + hash` 与当前地址完全相同时直接忽略，不生成没有可见页面变化的假历史。浏览器 `popstate` 恢复目标历史项记录的 index、调用方 state、路径、查询和 hash；从后退位置再次 push 时由浏览器删除原前进分支。

认证成功后的全局 Provider 只挂载一个 Telegram 返回控制器。当前历史项属于本导航会话且 `index > 0` 时调用 `BackButton.show()`；`index = 0` 时调用 `BackButton.hide()`，由 Telegram 恢复原生关闭按钮。点击原生返回时，控制器再次确认当前存在安全前项且统一操作导航锁未生效，然后只执行一次 `history.go(-1)`；操作导航锁生效期间不得借原生返回绕过既有锁。组件卸载时必须移除同一个事件处理器并隐藏 BackButton。图鉴、休眠 Mint 和其他领域页面不得直接读取或控制 Telegram BackButton；页面内既有返回按钮继续调用统一浏览器导航。

页面刷新、WebView 重新创建或重新打开 TMA 都建立新的导航会话，当前加载项重新成为 `index = 0`，不猜测或恢复旧 WebView 的可返回性。非 Telegram 浏览器、没有 BackButton 的客户端和不支持 Bot API 6.1 的旧客户端静默保留浏览器自身导航与 Telegram 原生关闭行为，不显示自制的 Telegram 标题栏替代品。

## 不变量

- 原生 BackButton 只改变页面导航，不调用 `Telegram.WebApp.close()`，不提交业务命令，不新增 API、RPC、数据库写入、查询预取或持久化。
- 返回必须恢复目标历史项原有的路径、查询、hash 和调用方 state；五个主页面继续按既有常驻策略恢复筛选、选择、滚动与未提交界面状态。
- `replaceState`、相同地址空跳转、入口归一化和非法路径回正不得使根页面错误显示返回按钮。
- 任何领域页面、弹窗或休眠功能不得拥有第二个 BackButton 监听器；全局控制器是唯一 `show/hide/onClick/offClick` 生命周期所有者。
- Telegram 标题栏的安全区、全局顶部资产栏、底部导航、页面布局、操作导航锁、数据库最终事实来源和前端 Supabase 边界保持不变。

## 验证

架构检查必须确认会话元数据、初始根、push 递增、replace 保位、相同地址跳过、单一 `popstate`、全局 BackButton 控制器及页面局部所有权删除。影响域通过格式、ESLint、Web/Contracts TypeScript、架构检查、生产构建与 `git diff --check`，发布前执行全量静态回归。

同一部署 SHA 的真实 Telegram iOS 与 Android 分别从普通入口和合法 Battle 入口验证：首次页面显示关闭；底部五个主导航和图鉴等页面真实跳转后显示原生返回；连续点击依次恢复上一历史项；回到 `index = 0` 后恢复关闭；查询参数 replace、相同主导航重复点击、非法路径回正、页面刷新和重新打开不产生虚假返回层。Safari Web Inspector 单独核对 URL、`history.state`、`popstate`、控制台和网络；原生按钮外观与触摸结果必须以真实 Telegram 客户端为准。返回不得新增业务请求；页面因既有 stale/refresh scope 规则发生的权威回正继续单独记录。
