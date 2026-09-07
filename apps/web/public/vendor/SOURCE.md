# Telegram SDK 原始制品

上游：<https://telegram.org/js/telegram-web-app.js?63>。

文件：`telegram-web-app.3549138a7934.js`，116510 字节。保持原始字节，不格式化或压缩改写。

SHA-256：`3549138a7934039fe7dfd1291a4ee739bd2b705a614308053a8b08a87d85c451`。

SHA-384 SRI：`sha384-UIU2aXwkvBIU//NSd8KQvPQc3/EvwMoKj+m2qYgtQAtF1u3Vvhf5+pjstVoLvU3i`。

2026-09-07 上游在当前网络 SSL 超时。此次通过 Google Translate 的公开资源转发路径下载上游脚本，取得的原始字节与 ADR-098 中 2026-08-30 已批准的 SHA-256、SHA-384 及长度完全一致，因此未升级或替换 SDK。该转发地址不进入游戏运行路径。

游戏只从同源静态文件加载；构建不下载外部脚本；架构检查与浏览器 SRI 分别验证本地字节与实际响应。受控升级规则见 `docs/architecture/adr/ADR-098-telegram-sdk-subresource-integrity.md`。
