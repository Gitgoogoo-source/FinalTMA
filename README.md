# PokePets Telegram Mini App

PokePets 是盲盒类 Telegram Mini App。产品唯一事实来源是 [功能说明文档](docs/product/功能说明文档.md)，技术边界从 [系统总览](docs/architecture/README.md) 开始，发布与验收从 [发布手册](docs/operations/release.md) 开始。

## 项目结构

```text
api/                    Vercel 三个薄网关
apps/web/               React + Vite Mini App
apps/api/               Functions 领域、工作流与平台适配
packages/api-contracts/ REST 契约、错误注册表与 OpenAPI
contracts/ton/          Tact 合约、部署与验证命令
supabase/schemas/       声明式业务 Schema
supabase/migrations/    baseline、product_data_v1、api_security
generated/              目录与资产校验清单
tools/product_data/     目录、盲盒、充值与任务数据生成链
tools/                  契约、数据库、架构、资产与 Manifest 门禁
docs/                   产品、架构、ADR 与运维资料
```

## 静态门禁

```sh
pnpm install --frozen-lockfile
pnpm product-data:build
pnpm contracts:openapi
pnpm validate:static
pnpm chain:build
pnpm assets:check:development
```

`pnpm build` 不编译 TON 合约，并依据 `APP_ENV` 在 Web 构建后执行对应资产门禁；当前真实开发只接受已锁定的 210 张 development-only 藏品图，正式生产规则见[发布手册](docs/operations/release.md)。项目不包含本地功能测试；功能验收只在独立真实开发环境按[验收清单](docs/operations/acceptance.md)执行。
