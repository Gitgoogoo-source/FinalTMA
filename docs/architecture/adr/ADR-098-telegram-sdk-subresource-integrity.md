# ADR-098：Telegram 官方 SDK 子资源完整性与受控升级

- 状态：已接受
- 日期：2026-08-30
- 启动恢复修订：2026-09-07

## 背景

Telegram 官方要求 Mini App 在其他脚本前从 `telegram.org` 加载 `telegram-web-app.js`。原入口使用没有版本参数、`integrity` 或 `crossorigin` 的远程脚本；该脚本在认证前进入第一方页面执行域，能够读取 Telegram `initData`、修改 DOM 或拦截后续 bearer 请求。HTTPS 和只允许 `telegram.org` 的 CSP 降低了来源范围，但不能证明实际返回字节未经替换。

项目继续使用 Telegram 官方远程 SDK，不引入社区封装、不把 SDK 打入 Vite 首屏闭包，也不增加备用 CDN。Telegram 当前官方文档使用 `https://telegram.org/js/telegram-web-app.js?63` 并要求位于其他脚本之前；查询参数用于标识当前官方版本，内容真实性由 SRI 哈希裁决，不能把查询参数本身视为不可变保证。

## 已批准制品

2026-08-30 从官方 HTTPS URL 重新取得的制品事实为：

- URL：`https://telegram.org/js/telegram-web-app.js?63`
- 字节数：`116510`
- `Last-Modified`：`Tue, 14 Jul 2026 09:31:36 GMT`
- SHA-256：`3549138a7934039fe7dfd1291a4ee739bd2b705a614308053a8b08a87d85c451`
- SRI SHA-384：`sha384-UIU2aXwkvBIU//NSd8KQvPQc3/EvwMoKj+m2qYgtQAtF1u3Vvhf5+pjstVoLvU3i`
- CORS：`Access-Control-Allow-Origin: *`

## 唯一结论

`apps/web/index.html` 只能有一个跨源脚本：上述精确 Telegram URL。该标签必须位于应用 module 之前，同时包含 `id="telegram-sdk"`、`async`、批准的 SHA-384 `integrity` 和 `crossorigin="anonymous"`。不得添加 `defer` 或 `blocking` 重新阻塞应用启动。不得使用内联 `onerror`、动态插入、无 SRI 的第二地址、备用 CDN、内联脚本或静默降级。

根路径和全部前端深链继续共用唯一 CSP。`script-src` 固定只包含 `'self'` 与 `https://telegram.org`，不增加通配符、协议来源、`unsafe-inline`、`unsafe-eval` 或其他脚本域。SRI 不匹配或 CORS 失败时，浏览器必须阻止 SDK。应用入口先渲染既有启动画面，`sdk-ready.ts` 观察唯一脚本的 `load` / `error` 事件并确认 `window.Telegram.WebApp`，只有成功后才按需加载 `initialize.ts`、初始化 Telegram 布局、账号语言并挂载认证流程。布局初始化不进入 SDK 未就绪时的首屏同步闭包。`async` 允许启动画面先执行，不允许登录提前执行；启动参数在此期间保留在原位置，不自行解析或存储身份数据。

SDK 已加载时立即继续；正在加载时最多等待 `TELEGRAM_SDK_TIMEOUT_MS`（12 秒，自应用开始等待时计时）。脚本缺失、加载失败、完成后没有 WebApp 或等待超时均进入明确失败状态；即使错误事件早于应用模块执行，12 秒上限仍保证结束等待。失败画面使用 `Adventure Paused` / `冒险暂时未能开启`，说明暂时未能开启冒险并提供 `Try Again` / `重新尝试`。重试仅完整刷新当前页面，保留 Telegram 原有入口参数和链接；不注入第二脚本、不改哈希、不无限自动刷新。失败后迟到的 SDK 不自动开始认证，须由用户重试开启新的启动流程。失败前后都不能发送 `initData`、创建 session 或改载未固定脚本。控制台只记录固定诊断码，不记录用户身份或 URL fragment。

2026-09-07 的真实 iPhone 证据表明：同步脚本请求在主页面已返回后等待超过一分钟，阻塞 `<body>`、游戏容器和所有 API。此次修订替换同步加载方式，保留官方 URL、制品哈希和来源边界。外部网络不可达时，应用保证有可操作失败界面，不宣称可以绕过 SDK 进入游戏。

Vite 首屏 JS/CSS 门禁保持不变；远程 SDK 不计入 Vite chunk，因此 production build 通过不能代替 SRI、CORS、CSP 和真实 WebView 验收。

## 受控升级

每次 Telegram SDK 升级必须在同一个提交中完成以下全部步骤：

1. 重新读取 Telegram 官方 Mini Apps 文档，确认当前精确脚本 URL和加载顺序。
2. 从官方 HTTPS origin 下载精确字节，复核状态码、MIME、CORS、字节数、`Last-Modified`、SHA-256 与 SHA-384。
3. 对新旧脚本做来源审查，重点检查新增网络、存储、动态执行、凭据和桥接行为。
4. 同时更新 HTML、静态架构门禁、本 ADR 的制品记录和验收证据；禁止只修改 URL 或只修改哈希。
5. 完成静态构建、线上响应和真实 iPhone Telegram + Safari Web Inspector 验收后，才能接受新制品。

如果 Telegram 在既有 URL 下替换字节，应用按设计失败关闭。恢复路径只能是审核新制品并发布新的 URL/哈希，或使用 ADR-075 的维护隔离；不得删除 SRI、扩大 CSP 或临时加载未审核脚本。回滚只能回到仍能由官方 origin 提供且字节与旧批准哈希一致的版本。

## 验收

`pnpm architecture:check` 必须结构化确认 CSP `script-src` 精确集合、唯一外部脚本、精确 URL、SHA-384、匿名 CORS、异步加载、标签先于应用 module 和不存在错误回退。构建产物的 `index.html` 必须保留相同属性，首屏体积门禁不得新增同步依赖。

`pnpm test:web:startup` 覆盖 SDK 预先就绪、延迟成功、加载拒绝、缺失、超时、超时后迟到和事件清理。隔离浏览器检查必须延迟或拒绝 SDK，确认启动界面可见、超时可重试、认证请求为零；解除阻塞后必须走正常启动门禁，不伪造登录。

部署后同时检查根路径与深链 CSP、官方 SDK 的 200/MIME/CORS/字节哈希以及 Console 中没有 integrity、CORS 或 CSP 错误。真实 iPhone Telegram 必须证明 `window.Telegram.WebApp` 可用，登录、重新认证、主题、安全区、返回按钮、分享和支付桥接保持原行为。负向验证使用不发布的错误哈希，必须看到浏览器阻止 SDK且没有 `/api/auth/telegram` 请求；验证结束立即清除该临时状态。

本 ADR 补充 ADR-010 中只限定 Telegram origin 的脚本边界，也保持 ADR-054 的 `connect-src` 精确端点裁决不变。
