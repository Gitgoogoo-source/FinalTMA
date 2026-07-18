# PokePets 运行架构

## 事实来源

`docs/product/功能说明文档.md` 是唯一产品功能来源。本次实现固定使用 SHA-256：

```text
940379b4d3ed663b68ffc96784a60f37654baac6d2dabb9fd54c34b85e00bb3e
```

架构文档只记录技术边界，不复制价格、概率、奖励或产品状态规则。目录、OpenAPI 和 migration 均为生成物，生成结果必须与上述文档校验和绑定。

## 运行时

- Web：React、Vite、TypeScript，运行在 Telegram Mini App。
- API：同一 Vercel Project 内的 `app`、`integrations`、`jobs` 三个 Node.js 24 Function 网关。
- Database：Supabase Postgres 17，仅暴露 `api` schema；浏览器不加载 Supabase SDK。
- Blockchain：TON Connect 验证钱包，Tact 合约完成 NFT Mint。
- Deployment：Vercel Pro；测试与生产使用相同 Git commit 和 migration 序列。

## 依赖方向

```text
apps/web -> packages/contracts
api -> packages/server/http
packages/server/http -> packages/server/modules
packages/server/modules -> packages/contracts + api schema RPC
api schema RPC -> private database schemas
```

禁止反向依赖、跨领域深层导入、浏览器访问 Supabase、Node 层组合多次资产写入。

## 可信边界

前端只提交动作、目标标识、数量和幂等键。价格、余额、库存、资格、奖励、随机结果、任务进度和链上状态均由服务端重新校验，并由单个数据库事务裁决。

所有玩家写请求以 UUID `Idempotency-Key` 作为 `operation_id`。数据库对规范化请求计算哈希；相同键和相同请求返回原结果，相同键和不同请求返回 `IDEMPOTENCY_KEY_REUSED`。

会话令牌只在运行内存保存，绝对有效期 15 分钟。只有 `POST /api/auth/telegram` 接收 Telegram `initData`。账号为 `banned` 时前端立即清空全部业务内容，只渲染空白界面。

## 数据库权限

内部 schema 对 `public`、`anon`、`authenticated` 和 `service_role` 撤销直接表权限。`service_role` 只获得 `api` schema 中明确列出的函数执行权。玩家 RPC 使用 `session_id` 再次验证会话、账号和资源归属。

## 操作恢复

写操作状态固定为 `pending`、`succeeded`、`failed`、`unknown`。随机结果和资产结果只生成一次。前端遇到 `unknown` 后禁止相关导航，只通过 `GET /api/operations/:operation_id` 恢复原操作。

## 生成物

- `generated/catalog/catalog-v1.json`
- `packages/contracts/openapi/openapi.json`
- `supabase/migrations/*.sql`
- `apps/web/public/tonconnect-manifest.json`

生成物禁止手工维护；漂移检查必须在临时目录生成后比较。
