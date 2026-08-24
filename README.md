# EvoMyPet Telegram Mini App

EvoMyPet 是盲盒类 Telegram Mini App。产品唯一事实来源是 [功能说明文档](docs/product/功能说明文档.md)，技术边界从 [系统总览](docs/architecture/README.md) 开始，发布与验收从 [发布手册](docs/operations/release.md) 开始。

## 项目结构

```text
api/                    Vercel 三个薄网关
apps/web/               React + Vite Mini App
apps/api/               Functions 领域、工作流与平台适配
packages/api-contracts/ REST 契约、错误注册表与 OpenAPI
contracts/ton/          Tact 合约、部署与验证命令
assets/source/          不含二进制，仅保留资源发布说明
supabase/schemas/       声明式业务 Schema
supabase/migrations/    baseline、product_data_v1、api_security
generated/              Catalog、Battle 与资产校验清单
tools/product_data/     目录、盲盒、充值、任务与 Battle 数据生成链
tools/                  契约、数据库、架构、资产与 Manifest 门禁
docs/                   产品、架构、ADR 与运维资料
```

## 静态门禁

```sh
pnpm install --frozen-lockfile
pnpm product-data:build
pnpm catalog:pin-assets
pnpm contracts:openapi
pnpm validate:static
pnpm chain:build
pnpm assets:check:catalog
pnpm assets:check:development
```

`pnpm build` 不编译 TON 合约，并依据 `APP_ENV` 在 Web 构建后执行对应资产门禁；既有生产 Storage 使用同一组 210 张正式母版生成的 420 张运行时藏品图。Telegram 分享图由全局 production 门禁检查，休眠的 TON Connect 图标不阻塞当前 MVP，完整规则见[发布手册](docs/operations/release.md)。项目不包含本地功能测试；最终功能验收只在 `@EvoMyPet_bot` 的真实 Telegram Mini App 按[验收清单](docs/operations/acceptance.md)执行。生产品牌与既有云环境切换由 [ADR-086](docs/architecture/adr/ADR-086-evomypet-production-cutover.md) 固定。

身份启动与日常资产读取分别使用 `identity.initial` 和 `identity.summary`；前者只形成当前 session generation 的入口恢复快照，后者是普通刷新唯一使用的身份摘要。完整边界见 [ADR-049](docs/architecture/adr/ADR-049-identity-initial-state-and-summary-read-model.md)。
