# ADR-001：运行时与部署

## 决定

项目使用 pnpm monorepo。React/Vite Web 与三个 Node.js 24 Vercel Function 网关部署在同一 Vercel Pro Project。持续开发使用真实的独立 Vercel 与 Supabase Postgres 17 项目；正式上线时新建另一套独立生产项目。本次未部署 TON 的真实开发环境只调度支付对账和不变量检查 Cron（每 5 分钟）及每日幂等清理；完成 testnet Collection 与全部 TON 配置后，Mint 对账才恢复为每 5 分钟调度。正式生产环境固定运行四项 Cron。

## 约束

真实开发环境和未来生产环境必须部署同一 Git commit 与同一 migration 序列。环境差异只允许域名、项目 ID、合约地址和密钥。生产部署需要用户明确授权。
