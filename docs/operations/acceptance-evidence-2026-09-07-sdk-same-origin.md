# 2026-09-07 同源 Telegram SDK 启动修复

## 根因证据

- 修复前提交：`7e368f27e44b42ad48ad5a43d57682e83102174e`。
- Vercel 项目：`final-tma` / `prj_KtKxzhjL44OZc1kJxWbgbHRBWg3C`；production 部署 `dpl_DGvNokQFBPb9uCnWKxmebQRXGd7t`。
- 域名：`final-tma-pi.vercel.app`。真实 iPhone iOS 18.7.2，通过 iPhone Mirroring 操作 Telegram Mini App，Safari Web Inspector 附加同一页面。
- 21:09 Asia/Shanghai，Inspector 显示 `https://telegram.org/js/telegram-web-app.js?63` SSL 连接错误。页面从准备画面进入 Adventure Paused。
- 无敏感数据的只读诊断：`sdkReady=false`、`readyState=complete`、`apiRequests=0`。本次进入失败在 SDK 加载阶段，未开始业务 API。
- Mac 多条下载尝试也发生 SSL 超时；这些证据不定位具体运营商、代理节点或 Telegram 远端故障。

## 修复

用户明确批准同源分发同一份经哈希校验的官方 SDK。保留原始字节和 SRI，HTML 改为同源静态制品，CSP script-src 缩小到 self；架构门禁检查文件哈希、精确标签与无外部脚本。同步 ADR-010、ADR-098、安全边界、架构说明及验收规范。

制品获取经过公开资源转发，原始长度、SHA-256、SHA-384 与既有批准值完全相同；记录位于 vendor/SOURCE.md。该转发服务不进入正式运行路径。未调整业务规则、API、身份校验或数据库；没有 migration、清库或账号配置动作。

## 本地验证

- PASS：7 项启动状态测试、3 项新用户引导测试。
- PASS：Lint、全项目 typecheck、受影响文件 Prettier、architecture。
- PASS：APP_ENV=production pnpm build（含资产与 manifest 门禁）。
- PASS：构建 HTML 引用同源制品且不存在远程 SDK；构建复制的 SDK SHA-256 与批准值一致。
- PASS：临时修改 SDK 一个换行，架构门禁拒绝未知字节；原始制品已还原。

## 发布与真机验收

本文件记录发布前证据。部署及对应提交的真实 iPhone 进入游戏结果由独立验证执行后补充；本地检查不代表已恢复登录。
