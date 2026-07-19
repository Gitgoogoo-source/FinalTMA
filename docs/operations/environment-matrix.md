# 环境矩阵

| 项目        | 本地                  | 真实开发                                                               | 真实生产                 |
| ----------- | --------------------- | ---------------------------------------------------------------------- | ------------------------ |
| Git commit  | 当前工作提交          | 持续开发提交                                                           | 与开发验收通过的提交相同 |
| Node / pnpm | Node 24 / pnpm 11.1.3 | Node 24 / pnpm 11.1.3                                                  | Node 24 / pnpm 11.1.3    |
| Vercel      | `vercel dev`          | `final-tma` Project，`APP_ENV=development`                             | 未来独立 Pro Project     |
| Supabase    | 本地 Postgres 17      | `final-tma-real-test`（ref `ebewtjerusxcioegpzjd`）Postgres 17 Project | 未来独立 Postgres 17     |
| Telegram    | 开发 Bot              | 开发 Bot 与开发 webhook                                                | 生产 Bot 与生产 webhook  |
| TON         | testnet               | testnet collection                                                     | mainnet collection       |
| 数据        | 非业务本地数据        | 独立真实开发与验收数据                                                 | 真实生产数据             |

真实开发与生产只允许域名、项目 ID、Bot、合约地址和密钥不同。生产必须使用在真实开发环境完成验收的同一 Git commit、同一 OpenAPI、同一目录版本和同一迁移序列。

Web 公开构建当前不需要 `VITE_*`。API 机密配置以根 `.env.example` 为唯一名称清单，真实值只进入对应 Vercel Project Secret。真实开发与生产必须分别配置至少 32 字节的 `IDENTITY_SECURITY_SECRET`，且不得与 `REFERRAL_CODE_SECRET` 共用。任何 `SUPABASE_SERVICE_ROLE_KEY`、`IDENTITY_SECURITY_SECRET`、`TELEGRAM_BOT_TOKEN`、`CRON_SECRET`、`TELEGRAM_WEBHOOK_SECRET`、TON API Key 或签名私钥均不得进入浏览器环境。
