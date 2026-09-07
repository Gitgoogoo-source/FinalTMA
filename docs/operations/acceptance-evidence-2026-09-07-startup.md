# 2026-09-07 Telegram SDK 启动恢复

## 影响范围

本次修复只修改 Web SDK 加载、启动等待和失败重试。官方 SDK URL、SRI SHA-384、匿名 CORS、CSP、身份校验、API 与数据库定义保持原语义。没有 migration、清库、Bot 配置或支付操作。

SDK 使用 async，首屏先显示既有启动画面。`sdk-ready.ts` 最多等待 12 秒，只在 SDK 可用后按需加载原 Telegram 布局初始化并挂载 App。失败后显示 `Adventure Paused` 和 `Try Again`，重试完整刷新当前 URL；迟到 SDK 不自动登录。

## 修复前真实设备证据

- 设备：iPhone iOS 18.7.2，Telegram Mini App，通过 iPhone Mirroring 和 Safari Web Inspector。
- 域名：`final-tma-pi.vercel.app`；旧提交 `33dc0136c494fe7fc1ffaf94d1a186fcc47e5ba3`；部署 `dpl_GFFCxf65iRcyC17xQNTGVSAYhQNQ`。
- 20:49:09（Asia/Shanghai）在 iPhone 的 Mini App 菜单点击 Reload Page。主文稿 249 毫秒返回，游戏 JS/CSS 来自缓存；Telegram SDK 请求超过一分钟仍没有响应状态。
- 20:49:52 Inspector 只读检查：`readyState=loading`、`hasBody=false`、`hasRoot=false`、`hasTelegram=false`、`hasLaunchData=true`、`apiRequests=0`。唯一已解析脚本 `async=false,defer=false`。
- 结论：同步外部脚本阻塞 HTML 解析。以上事实不证明 Telegram 官方服务全面故障，也不能区分手机网络、代理线路与远端节点故障。

## 本地验证

- PASS：7 项 SDK 状态测试，覆盖已就绪、延迟成功、超时及迟到、加载错误、缺失脚本或 WebApp、提前发生的错误、取消与监听器清理。
- PASS：现有 3 项新用户引导测试。
- PASS：Lint、全项目 typecheck、受影响文件 Prettier、architecture、i18n、生产构建、production 资产检查、build manifest。
- PASS：首屏 JS 399610 B / gzip 124387 B，CSS 55833 B / gzip 12913 B；未修改预算上限。
- PASS：Chrome 打开隔离 HTTP 测试服务提供的生产构建。只有测试响应把 SDK 地址改为本地永不返回或故意错误的脚本，SRI 与 CSP 保留。永不返回时先显示启动画面，超时出现失败与重试，点击按钮重新开始加载。错误制品也进入失败界面；失败测试累计 API 请求为零。
- 隔离 HTTP 服务与故障脚本只位于 `/tmp`，不会进入 Git 或正式运行路径。自动化替身和 Chrome 测试均不作为真实 Telegram 登录成功证据。

## 发布及真实设备验收

发布前尚未执行新提交的线上验证。发布结果与新的真实设备复验记录在本任务交付报告中；只有对应提交的实际结果才能用于接受修复，不复用旧部署的正常登录记录。
