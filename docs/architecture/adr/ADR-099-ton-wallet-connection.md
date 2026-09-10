# ADR-099：顶部 TON 钱包连接

## 决定

2026-09-10 启用顶部资产栏的 TON 钱包入口，使用官方 `@tonconnect/ui-react` 3.0.2。Wallet 从 dormant registry 移入 active App registry；Mint、钱包奖励任务及 Mint 对账调度保持休眠。

钱包入口按需加载完整能力（SDK、弹窗、样式、钱包 API contracts），不在首屏预取钱包状态，不提高 400000 B 的首屏 JS 上限。全局弹窗渲染也延迟到首次打开，模块下载失败由加载器接住，渲染失败由局部错误边界隔离。浏览器会缓存失败模块 URL，因此资源失败后的重试刷新文档，并通过一次性的 sessionStorage 标记恢复原弹窗。账号语言菜单复用同一加载器，资产数字展示复用小组件，以保持首屏预算。原有资产、VIP、Stars 处理逻辑保持不变。

连接流程：读取账号绑定状态、等待 SDK 恢复、清理旧传输连接、向后端请求一次性 challenge、打开 SDK 默认钱包列表、在钱包内授权、服务端核验 `ton_proof`、数据库事务原子保存绑定。SDK 恢复的地址本身不证明账号绑定，UI 区分“已连接”和“已绑定账号”。取消、超时、卸载和网络失败均清理连接监听并允许重试；验证和断开复用 operation recovery、幂等键及查询刷新。显式关闭钱包弹窗时终止未完成的授权等待并删除待恢复 challenge；页面卸载只清理监听，保留恢复信息。钱包 SDK 异步打开不能中断，取消后的迟到打开会被关闭，重试串行等待旧打开及关闭通知结束。

连接前将 userId、一次性 challenge 和到期时间写入 localStorage，不额外保存钱包密钥或签名。延迟加载的恢复协调器在 Telegram 账号恢复后，只为当前账号的有效 challenge 打开钱包面板；面板等待 SDK 恢复或迟到 bridge 回包，再校验账号、nonce、期限并调用相同后端验证流程。已提交并成功绑定的地址通过钱包状态确认，避免重复提交；过期、其他账号和错误 nonce 不自动绑定。

钱包公钥链上查询使用独立的 `getTonWalletEnv()`，只要求 `TON_NETWORK`、`TON_API_BASE_URL`；`TON_API_KEY` 为可选配置，未配置时使用官方公共查询额度（1 请求/秒），Mint 仍要求 API key。Mint 的合集、金额、签名私钥和元数据配置继续由 `getTonEnv()` 严格校验。

数据库复用已有钱包表及 RPC。新 forward-only migration 在验证和断开时串行化同账号修改，并对地址增加事务锁；已被其他账号记录的地址即使断开也不能重新归属，避免旧 upsert 返回其他账号的钱包。约束为一账号一个 verified 地址、一个地址一个账号，历史归属保持不可转移。钱包绑定和解绑不由前端直接写库。

公开同源 manifest 保持 EvoMyPet 生产身份，并设置 JSON/CORS 响应头。Telegram 钱包返回链接为 `https://t.me/EvoMyPet_bot/evomypet`。本地与预览环境连接时，钱包仍需访问公开 HTTPS manifest；真实绑定的 proof 域名须与 API `APP_BASE_URL` 一致。

CSP 按官方 `https://config.ton.org/wallets-v2.json` 的完整钱包列表放行 HTTPS SSE bridges 和图标（包含 SDK 内置备用图标），快照见 `tools/web/ton-wallet-origins.json`。没有限定品牌钱包；后续官方列表新增域名需同步白名单。脚本策略仍为 self，TON SDK analytics 关闭。SDK 内置语言目前只有 en/ru，本项目钱包面板支持英语/简体中文，SDK 选择器使用英语。

## 验证与发布

- `pnpm test:web:wallet`：取消、重复事件、超时、卸载、网络失败，以及真实 Ed25519 签名的合法/篡改/跨域/过期/错误 challenge/未知网络验证。
- `tools/db/ton_wallet_rpc.test.mjs`：使用空的本地 `wallet_rpc_test` 数据库（默认端口 55439），并通过 `WALLET_TEST_PG_MODULE` 指向已安装的 `pg` 模块。执行真实 wallet schema 和 migration，验证重放、归属和双连接并发；identity、operations、tasks 是隔离测试替身，不代表完整 Supabase 集成验收。
- `pnpm typecheck`、`pnpm lint`、`pnpm i18n:check`、`pnpm architecture:check`、`pnpm build`。
- 发布顺序：先应用 `20260910125845_enable_verified_ton_wallet.sql`，再发布 Web/API。不得仅上线入口而跳过 RPC 修复。
- 浏览器模拟连接不代替真实 Telegram iOS/Android 钱包授权。生产需验证 manifest、wallet API、钱包确认返回、服务端绑定、重开恢复、取消重试和断开。

## 本次本地验证结果

2026-09-10：初次开发的连接与签名测试 11 项通过；隔离 PostgreSQL 上的 RPC/migration、同地址跨账号竞争、同账号多地址竞争通过。浏览器用模拟账号打开实际顶部资产栏、钱包面板及官方完整钱包选择器，不发送线上钱包绑定请求。真实 Telegram/钱包批准返回及生产迁移、部署尚未执行。

## 官方依据

- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Telegram Blockchain Guidelines](https://core.telegram.org/bots/blockchain-guidelines)
- [TON Connect 接入](https://docs.ton.org/applications/ton-connect/get-started)
- [连接与 ton_proof](https://docs.ton.org/applications/ton-connect/how-to/connect)
- [SDK Telegram 返回策略](https://github.com/ton-connect/sdk/tree/main/packages/ui#use-inside-tma-telegram-mini-apps)
- [SDK 版本变更](https://github.com/ton-connect/sdk/blob/main/packages/ui-react/CHANGELOG.md)

## 审查缺陷修复

新增回归覆盖延迟钱包列表在取消/超时后返回、取消后立即重试、排队重试取消、SDK 恢复已有钱包、恢复后迟到回包、challenge 的账号/期限/nonce 校验、旧请求不能清除新请求，以及无需 Mint 配置的真实链上查询调用路径（网络响应使用替身）。浏览器故障注入验证全局弹窗模块失败后游戏保留、刷新恢复原面板；组件模拟验证重载后后台验证仅执行一次、迟到 proof 恢复和跨账号隔离。真实 Telegram iOS/Android 钱包批准与生产 Supabase 集成仍须单独验收。

修复验证：钱包测试 27 项通过；类型、Lint、格式、OpenAPI、i18n、架构检查通过。最终 Web 构建首屏 JS 为 399899 B / gzip 124681 B，未提高预算。真实 SDK 选择器打开、取消、再次打开通过浏览器验证。

发布配置核查发现生产尚无 TON 查询配置，因此钱包只读查询支持官方无 key 模式，生产配置主网 `https://toncenter.com/api/v2`。需要更高链上回退查询额度时可配置 `TON_API_KEY`；普通钱包的 StateInit 验证不消耗该查询额度。依据：[TON Center API v2 authentication](https://docs.ton.org/api/v2/authentication)。
