# ADR-098：Telegram 官方 SDK 子资源完整性与受控升级

- 状态：已接受
- 日期：2026-08-30
- 同源分发裁决：2026-09-07，用户明确同意按推荐修复

## 背景与裁决

2026-09-07，真实 iPhone Telegram 的 Safari Web Inspector 显示从 `https://telegram.org/js/telegram-web-app.js?63` 加载脚本时 SSL 失败。页面已完成加载，`window.Telegram.WebApp` 不存在，业务 API 请求为零。此前异步加载和 12 秒失败提示只能避免白屏，无法恢复该网络下的登录。

用户批准用游戏域名分发同一份经过哈希校验的官方 SDK，替代运行时从 Telegram 域名下载的旧规则。该规则不替换 SDK 实现、不放宽身份校验、不添加第三方 CDN，也不改变业务功能。官方文档的远程引用方式记录为上游接入说明；本项目采用经用户裁决的同字节同源分发方式。

## 唯一有效制品

- 上游来源：`https://telegram.org/js/telegram-web-app.js?63`
- 发布路径：`/vendor/telegram-web-app.3549138a7934.js`
- 仓库文件：`apps/web/public/vendor/telegram-web-app.3549138a7934.js`
- 字节数：`116510`
- SHA-256：`3549138a7934039fe7dfd1291a4ee739bd2b705a614308053a8b08a87d85c451`
- SRI SHA-384：`sha384-UIU2aXwkvBIU//NSd8KQvPQc3/EvwMoKj+m2qYgtQAtF1u3Vvhf5+pjstVoLvU3i`

保存上游原始字节，不格式化、不压缩改写、不加入 Vite 模块闭包。ESLint 和 Prettier 排除该第三方制品，架构检查直接计算文件 SHA-384 并与批准值核对。部署必须包含同一份字节，不能在构建时下载浮动版本。

## 加载与安全边界

`apps/web/index.html` 只引用上述同源制品。标签位于应用 module 之前，含 `id="telegram-sdk"`、`async`、上述 `integrity` 与 `crossorigin="anonymous"`。不得添加内联事件、动态备用脚本、无校验回退或绕过认证。根路径和所有前端深链的 `script-src` 只含 `'self'`；其他 CSP 指令保持既有边界。

应用先渲染启动画面，`sdk-ready.ts` 观察唯一脚本并确认 `window.Telegram.WebApp`，成功后才初始化布局、语言和认证。等待上限为 12 秒；缺失、网络错误、完整性失败、没有 WebApp 或超时均关闭认证并显示可整页重试的失败界面。迟到 SDK 不自动登录。日志不得包含身份数据、令牌或 URL fragment。

## 升级与回滚

升级时核对官方文档与制品来源，审查新增网络、存储、动态执行和桥接行为；在同一提交中更新独立文件、内容标识路径、HTML SRI、架构检查和制品文档。执行静态检查、生产构建和真实 iPhone Telegram + Safari Web Inspector 验证。不能删除完整性校验来接受未知字节。回滚必须同时恢复 HTML、制品和对应哈希，使用 GitHub 自动部署。

## 验收

架构检查验证无外部脚本、唯一 SDK、精确路径、原始字节哈希、SRI、匿名 CORS 属性、异步属性、顺序与无回退。启动单测覆盖预先就绪、延迟、缺失、错误、超时、迟到和监听器清理；首屏 Vite JS/CSS 预算保持不变，独立 SDK 大小另行记录。

部署后验证同源 SDK 的 HTTP 200、JavaScript MIME 和哈希，以及根路径和深链 CSP。真实 iPhone Telegram 必须通过真实登录进入默认游戏页，Inspector 确认 SDK 就绪、认证成功、无完整性或 CSP 错误，且不再请求远程 SDK。失败测试必须阻止认证，不能伪造登录。实际执行结果单独记录于验收报告，定义验收条件不代表已通过。
