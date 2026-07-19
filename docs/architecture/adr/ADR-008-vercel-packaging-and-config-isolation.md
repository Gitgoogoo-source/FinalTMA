# ADR-008：Vercel 函数打包与配置隔离

- 状态：已接受
- 日期：2026-07-19

## 背景

Vercel 将根目录三个 Function 入口编译为 JavaScript，但不会把 workspace 包的 TypeScript 源码作为可直接执行的运行时包。workspace `package.json` 若将运行时导出指向 `.ts`，部署产物会在 Node.js 24 运行时解析到未打包的源码并以 `ERR_MODULE_NOT_FOUND` 退出。

数据库适配器此前复用全量服务端环境变量解析器，导致只读 Catalog RPC 也强制依赖尚未启用的 Telegram 与 TON 凭据，扩大了模块间配置耦合。

## 决策

`@pokepets/api` 与 `@pokepets/api-contracts` 增加独立 TypeScript 构建配置。类型条件固定指向 `src/*.ts`，运行时条件固定指向 `dist/*.js`；构建阶段必须先生成两个 workspace 的 `dist`，再构建 Web 和打包 Vercel Functions。根目录三个 Function 入口仍只依赖 `@pokepets/api/entrypoints`，并以 Vercel 支持的 `export default { fetch }` Web Standard 签名返回 `Response`，不绕过模块边界。

Vercel rewrite 使用 `__route` 传递原始 API 路径，并会把 source 的命名捕获 `path` 自动附加到查询字符串。两者都是部署基础设施字段，必须在严格业务输入校验前剥离；业务契约不得声明名为 `__route` 或 `path` 的输入字段。

数据库适配器只解析 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`。核心会话、Telegram、Cron 与支付支持配置由 `getEnv()` 校验；邀请链接由 `getReferralEnv()` 校验 Bot 用户名与 Mini App short name；钱包链上公钥查询、Mint permit 与 Mint 对账只通过 `getTonEnv()` 校验 TON 配置。未启用的外部集成不得以占位值绕过校验，也不得阻塞不依赖该集成的 API。

## 不变量

- `SUPABASE_SERVICE_ROLE_KEY` 只存在于 Vercel 服务端 Secret，不进入 Web 构建、日志或 Git。
- `dist` 是构建产物且保持 Git 忽略；新机器运行 `pnpm dev` 或 `pnpm dev:web` 时先由对应 `predev` 脚本生成所需 workspace 产物。
- 浏览器不安装 Supabase SDK，不读取 Supabase URL 或密钥。
- 数据库写入仍只调用 `api` schema RPC，权限、幂等与事务边界不变。
- 不配置假的 Telegram、TON、支付或合约数据。
