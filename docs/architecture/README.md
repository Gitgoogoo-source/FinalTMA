# PokePets 系统总览

## 事实来源

`docs/product/功能说明文档.md` 的全部章节是唯一产品功能来源。`PRODUCT_DATA_CHECKSUM_BOUNDARY` 上方内容由 Catalog v1 数据生成器解析；下方产品扩展不进入 Catalog v1 migration 或 manifest。

已发布 Catalog v1 的 immutable `product_checksum` / release identity 固定为：

```text
de521f2687086cb358fb557a4a7ada3bc3c5fc132d673f0256b4573028ddba46
```

该值不是当前产品文档全文 SHA。生成器另计算并打印 boundary 上方源文档 SHA-256，仅用于诊断；Catalog v1 release identity 必须同时与 tracked manifest 和 product-data migration 一致。架构文档只记录技术边界，不复制价格、概率、奖励或产品状态规则。

## 运行时

- Web：React、Vite、TypeScript，运行在 Telegram Mini App。
- Monster Tamer：登录后的 React 全屏覆盖层；Phaser 延迟挂载，读取真实可用藏品，进度与逐回合战斗由服务端裁决。
- API：同一 Vercel Project 内的 `app`、`integrations`、`jobs` 三个 Node.js 24 Function 网关。
- Database：Supabase Postgres 17，仅暴露 `api` schema；浏览器不加载 Supabase SDK。
- Blockchain：TON Connect 验证钱包，Tact 合约完成 NFT Mint。
- Deployment：Vercel Pro；真实开发环境与未来生产环境使用相同 Git commit 和 migration 序列。

## 依赖方向

```text
apps/web -> @pokepets/api-contracts/app
apps/web/src/domains/monster-tamer -> authenticated overlay + Phaser bridge
monster-tamer Web -> @pokepets/api-contracts/app
monster-tamer API -> api schema RPC -> monster_tamer + read-only catalog/inventory
api -> apps/api/entrypoints
apps/api/entrypoints -> gateway-specific contracts + http
apps/api/http -> injected route registry + handler map
apps/api/domains -> one api schema RPC per handler
apps/api/workflows -> domain capabilities + platform adapters
api schema RPC -> private database schemas
contracts/ton -> TON blockchain
```

禁止反向依赖、跨领域深层导入、浏览器访问 Supabase、Node 层组合多次资产写入。

Monster Tamer 领域拥有启动卡片、全屏覆盖层、React HUD 和 Phaser 生命周期。它只通过统一 API client 使用已登录内存会话；Phaser 不接收会话或 API 能力，只提交动作意图。数据库 RPC 读取正式目录与当前可用藏品，且只能写 `monster_tamer` 自身进度与战斗状态。

## 可信边界

前端只提交动作、目标标识、数量和幂等键。价格、余额、库存、资格、奖励、随机结果、任务进度和链上状态均由服务端重新校验，并由单个数据库事务裁决。

所有玩家写请求以 UUID `Idempotency-Key` 作为 `operation_id`。数据库对规范化请求计算哈希；相同键和相同请求返回原结果，相同键和不同请求返回 `IDEMPOTENCY_KEY_REUSED`。

会话令牌只在运行内存保存，绝对有效期 15 分钟。只有 `POST /api/auth/telegram` 接收 Telegram `initData`。账号为 `banned` 时前端立即清空全部业务内容，只渲染空白界面。

## 数据库权限

内部 schema 对 `public`、`anon`、`authenticated` 和 `service_role` 撤销 schema、表、序列和函数权限。`service_role` 只获得 `api` schema 的使用权和其中函数的执行权。玩家 RPC 使用 `session_id` 再次验证会话、账号和资源归属。

## 操作恢复

前端内存操作阶段固定为 `confirming → submitting → pending/unknown → succeeded/failed`；数据库持久状态为 `pending`、`unknown`、`succeeded`、`failed`。随机结果和资产结果只生成一次，`unknown` 只查询原 `operation_id`。开盒与转盘从提交前反馈到结果确认完成持续锁定领域操作和底部导航；进化在未决阶段锁定新提交和底部导航，终态由专用覆盖弹窗处理；其余命令只阻止同一 `use_case` 再次提交。开盒、转盘及进化的成功或失败结果在服务端确认展示前持续恢复，确认时间由当前用户的领域专用 RPC 原子记录。

## 生成物

- `generated/catalog/catalog-v1.json`
- `packages/api-contracts/openapi/openapi.json`
- `supabase/migrations/*_baseline.sql`
- `supabase/migrations/*_product_data_v1.sql`
- `supabase/migrations/*_api_security.sql`
- `apps/web/public/tonconnect-manifest.json`

生成物禁止手工维护；漂移检查必须在临时目录生成后比较。

## 架构资料

- [领域映射](domain-map.md)
- [运行时](runtime.md)
- [事务与数据](data-transactions.md)
- [操作恢复](operation-recovery.md)
- [安全边界](security-boundaries.md)
- [技术裁决](adr/ADR-001-runtime-and-deployment.md)
- [模块边界与网关隔离](adr/ADR-007-module-boundaries-and-gateway-isolation.md)
- [Vercel 函数打包与配置隔离](adr/ADR-008-vercel-packaging-and-config-isolation.md)
- [开盒页运行期视图状态](adr/ADR-009-gacha-runtime-view-state.md)
- [正式藏品图片资源](adr/ADR-010-catalog-image-assets.md)
- [Monster Tamer 登录后嵌入式游戏](adr/ADR-011-monster-tamer-embedded-game.md)
