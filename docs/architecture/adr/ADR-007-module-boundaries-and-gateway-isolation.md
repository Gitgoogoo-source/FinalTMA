# ADR-007：模块边界与网关隔离

- 状态：已接受
- 日期：2026-07-19

## 背景

旧结构把页面组合放进领域 UI，把三个 Function 网关的路由与 handler 放进同一全局注册表，并把盲盒、充值、进化、钱包、Mint 和回调声明集中在非所有者模块。该结构扩大了运行时依赖面，也使目录名无法准确表达业务所有权。

## 决策

Web 固定采用 `app → pages → domains/workflows → platform/shared` 的依赖方向。`app` 拥有启动、门禁、Provider、恢复协调、Router 和全局壳层；`pages` 是唯一跨领域 UI 组合层；`domains` 只公开本领域 UI 与实际被调用的类型；`workflows` 拥有跨请求恢复流程；`platform` 和 `shared` 不依赖业务领域。Web 领域之间禁止互相导入。

API 固定采用 `entrypoints → http → domains/workflows → platform` 的依赖方向。`app`、`integrations`、`jobs` 各自拥有独立契约 registry 和完整 handler map，`createGateway` 必须显式接收当前 registry 与 handler map。任一网关不得导入另两个网关的 registry 或 handler。API 领域只映射输入并调用单个具名 RPC，不得导入其他 API 领域；支付、退款、操作恢复、定时任务和 Mint 对账由 workflow 编排。

契约包固定导出 `/app`、`/integrations`、`/jobs`、`/server` 与无路由副作用的 `/common`。Web 只能导入 `/app`；三个 API entrypoint 只能导入各自网关契约；`/server` 只供 OpenAPI 生成和服务端静态校验。路由 ID、HTTP 方法、URL、请求、响应、错误码和 refresh scope 保持不变。

数据库声明文件按物理所有者拆分。共享不可变模板属性继续属于 `catalog.templates`；盲盒档位属于 `gacha.boxes`；充值档位属于 `payments.topup_products`；进化保底属于 `evolution.pity`；钱包与 Mint 继续使用内部 `onchain` schema，但由独立声明文件拥有；支付回调和 Mint 对账分别声明。所有 `api.*` RPC 名称和参数保持不变。

初始空库固定由 `baseline`、`product_data_v1`、`api_security` 三份迁移建立。产品数据生成链按 catalog、gacha、payments、tasks 分工，由一个入口生成唯一产品数据迁移和既有 Catalog manifest。

## 不变量

- 不改变产品功能、用户可见行为、operation `use_case` 或数据库 RPC 名称。
- OpenAPI 与 Catalog manifest 必须保持字节级一致。
- 根目录三个 Vercel 入口和 `contracts/ton` 保持原位。
- 不保留旧目录转发、旧脚本别名或双注册表兼容层。
- 不新增本地功能测试或测试代码。

## 执行门禁

`tools/architecture/check.py` 对上述目录集合、依赖方向、网关契约、空目录、派生契约脚手架、页面组合边界和文档物理所有者执行静态校验。
