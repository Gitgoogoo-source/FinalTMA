# AI 编码说明与规则文件

---

## 1. 项目定位

本项目是一个运行在 Telegram Mini App 内的开盲盒抽卡小游戏，包含以下核心系统：

- 用户资产展示：头像、游戏积分“K-coin”、游戏积分“Fgems”、Stars、TON 钱包状态。
- 开盒抽卡：三档盲盒、单抽、十连 9 折、Telegram Stars 支付、保底、奖励池、库存。
- 交易市场：购买、出售、出售管理、改价、下架、手续费、市场价格健康。
- 藏品成长：藏品展示、升级、合成/进化、分解、出售入口。
- 图鉴系统：收集进度、系列图鉴、图鉴奖励、排行榜、链上 NFT 同步。
- 任务系统：邀请、Telegram 分享、7 日签到、每日任务、交易任务、链上任务、奖励领取。
- TON 钱包和 NFT：TON Connect、钱包验证、Mint 队列、链上交易状态。
- 后台运营：盲盒、概率池、藏品、任务、活动 banner、市场手续费、支付、风控、审计。

---

## 2. 技术栈固定规则

除非开发者明确要求，否则不要随意替换技术栈。

| 层级 | 固定方案 |
|---|---|
| 前端 | React + Vite + TypeScript |
| 前端服务端数据 | TanStack Query |
| 前端本地 UI 状态 | Zustand |
| 样式 | Tailwind CSS + 自研组件 |
| 后端 API | Vercel Functions，Node.js，放在 `/api` |
| 数据库 | Supabase Postgres |
| 数据库业务逻辑 | Supabase RPC / Postgres Function |
| 数据权限 | Supabase RLS |
| 支付 | Telegram Stars Bot Payments API |
| 钱包 | TON Connect |
| NFT | TON NFT Collection / Item |
| 校验 | Zod |
| 测试 | Vitest + Playwright + SQL tests |

禁止无理由引入：Next.js、Prisma、tRPC、Redux、MobX、Express 独立服务器、MongoDB、Firebase、GraphQL、第三方支付 SDK。

如确实需要新增依赖，必须说明：

1. 为什么现有依赖无法满足。
2. 新依赖用于哪个模块。
3. 是否影响包体积、性能、安全和部署。
4. 需要修改哪些 `package.json`。

---

## 3. 最高优先级业务原则

这些规则优先级高于所有实现细节。

1. 前端只负责展示、交互和发起请求。
2. 前端不能决定抽卡结果。
3. 前端不能扣减或增加 K-coin、Fgems、Stars。
4. 前端不能直接修改库存、挂单、任务状态、图鉴奖励、保底次数。
5. 所有核心写操作必须以后端 API + Supabase RPC + 数据库事务为准。
6. 所有资产变化必须写入 `economy.currency_ledger`。
7. 所有支付结果必须以后端收到 Telegram `successful_payment` 为准。
8. 所有市场交易必须在数据库事务中完成。
9. 所有库存占用必须通过库存锁处理。
10. 所有任务奖励、邀请奖励、分红奖励必须由服务端判断。
11. 所有钱包地址、签名、Mint 状态必须由后端校验。
12. 前端不能保存私钥、Bot Token、Supabase service role key、TON 私钥、管理员密钥。

---

## 4. AI 防幻觉规则

AI 在编写代码前必须遵守以下规则。

### 4.1 不允许凭空假设

禁止直接假设以下内容已经存在：

- 某个文件已经存在。
- 某个函数已经实现。
- 某个数据库表已经创建。
- 某个 RPC 已经存在。
- 某个字段名、枚举值、状态值已经存在。
- 某个 API 路径已经存在。
- 某个 npm 包已经安装。
- 某个环境变量已经配置。

如果需要使用某个函数、类型、RPC、表、字段、组件，必须先检查现有代码或项目规则。

### 4.2 修改前必须先定位

在执行编码任务前，优先查找以下文件：

- `package.json`
- `pnpm-workspace.yaml`
- `apps/web/src/app/router.tsx`
- `apps/web/src/api/client.ts`
- `packages/validation/src/*`
- `packages/domain/src/*`
- `packages/server/src/*`
- `packages/db-types/src/database.types.ts`
- `supabase/migrations/*`
- `supabase/rpc/*`
- 相关 feature 目录，例如 `apps/web/src/features/box/*`

如果项目中没有相关文件，才允许新建；新建时必须遵守目录规范。

### 4.3 不确定时的处理方式

遇到不确定情况时，不要编造。应采用以下方式：

- 如果缺少字段：先标记为 `TODO: confirm field name`，不要乱写字段名。
- 如果缺少 RPC：创建明确命名的 RPC 文件，并同步说明需要数据库 migration。
- 如果缺少类型：在 `packages/validation` 或相关 `*.types.ts` 中定义，不要散落在组件内部。
- 如果业务规则不明确：不要自行改规则，保留最小实现并注明假设。
- 如果涉及资产、支付、库存、市场交易：必须走后端和 RPC，不能临时在前端计算。

### 4.4 禁止“看起来能跑”的假实现

禁止以下行为：

- 用 `Math.random()` 在前端生成抽卡结果。
- 在前端直接给用户加 K-coin 或 Fgems。
- 用前端状态模拟真实购买成功。
- 用 localStorage 保存真实余额、库存、钱包签名、支付结果。
- 用假数据替代服务端结果并作为正式逻辑。
- 在组件里硬编码数据库字段名而没有类型支持。
- 在 API 里跳过 session 校验。
- 在 API 里直接相信请求体里的 `user_id`。
- 在 API 里直接拼 SQL 执行业务交易。
- 在没有幂等键的情况下实现支付、购买、领取、合成等写操作。

---

## 5. 项目目录使用规则

### 5.1 前端页面和功能

前端主项目在：

```txt
apps/web/src/
```

功能模块必须放在：

```txt
apps/web/src/features/<feature-name>/
```

推荐结构：

```txt
features/box/
├── pages/
├── components/
├── hooks/
├── box.api.ts
└── box.types.ts
```

规则：

- 页面组件放 `pages/`。
- 业务 UI 组件放 `components/`。
- 请求和交互逻辑放 `hooks/`。
- API 调用放 `<feature>.api.ts`。
- 当前模块类型放 `<feature>.types.ts`。
- 通用 UI 放 `shared/ui/`。
- 通用工具放 `shared/lib/`。
- 不要把大型业务逻辑写进 React 组件。

### 5.2 后端 API

Vercel Functions 放在：

```txt
api/
```

每个 API 文件职责必须单一：

```txt
api/market/buy.ts              # 只负责购买挂单
api/inventory/evolve.ts        # 只负责合成/进化
api/tasks/claim.ts             # 只负责领取任务奖励
```

API 只负责：

1. 校验 HTTP method。
2. 校验 session。
3. 校验参数。
4. 生成幂等键或读取幂等键。
5. 调用 Supabase RPC。
6. 返回标准响应。

API 不负责：

- 直接计算资产变更。
- 直接决定抽卡结果。
- 直接转移库存。
- 直接判断复杂任务奖励。
- 直接绕过 RPC 改多张业务表。

### 5.3 后端共享逻辑

后端复用逻辑放在：

```txt
packages/server/src/
```

例如：

```txt
packages/server/src/auth/verifyTelegramInitData.ts
packages/server/src/db/rpc.ts
packages/server/src/payments/telegramStars.ts
packages/server/src/ton/tonConnect.ts
packages/server/src/security/rateLimit.ts
```

规则：

- API 文件中不要重复实现认证、RPC、错误处理、支付解析。
- 复用逻辑先放到 `packages/server`。
- `packages/server` 只能被后端引用，不能被前端引用。

### 5.4 数据库文件

数据库 migration 放在：

```txt
supabase/migrations/
```

RPC 放在：

```txt
supabase/rpc/
```

RLS 放在：

```txt
supabase/rls/
```

seed 放在：

```txt
supabase/seed/
```

SQL 测试放在：

```txt
supabase/tests/
```

规则：

- 新表必须有 migration。
- 新核心写操作必须有 RPC。
- 新用户可访问数据必须考虑 RLS。
- 新业务规则必须有 SQL test 或 API test。
- 不要手动修改生成的 `database.types.ts`。

---

## 6. 命名规则

### 6.1 文件命名

| 类型 | 规则 | 示例 |
|---|---|---|
| React 组件 | PascalCase | `AssetBar.tsx` |
| Hook | camelCase，必须以 use 开头 | `useBuyListing.ts` |
| API 调用文件 | feature.api.ts | `market.api.ts` |
| 类型文件 | feature.types.ts | `box.types.ts` |
| 后端 API 文件 | kebab-case | `create-listing.ts` |
| SQL RPC | snake_case | `market_buy_listing.sql` |
| migration | 递增编号 + 描述 | `000009_market.sql` |
| 测试文件 | `.test.ts` / `.spec.ts` | `market.test.ts` |

### 6.2 数据库命名

- schema：小写单词，例如 `core`、`economy`、`market`。
- table：复数 snake_case，例如 `user_balances`。
- column：snake_case，例如 `created_at`。
- enum/status：小写 snake_case，例如 `active`、`sold_out`、`payment_pending`。
- RPC：动词 + 业务对象，例如 `market_buy_listing`。

### 6.3 状态命名

状态值必须统一，不要随意新增近义词。

示例：

```txt
blind_box.status:
- not_started
- active
- paused
- ended
- sold_out

listing.status:
- active
- sold
- cancelled
- expired

item_instance.status:
- available
- locked
- listed
- consumed
- decomposed
- minting
- minted
- transferred

payment.status:
- created
- pending
- paid
- failed
- refunded
- expired
```

新增状态前必须检查 `packages/domain/src/statuses.ts` 和数据库 enum / check constraint。

---

## 7. API 统一规则

### 7.1 标准响应结构

所有 API 返回结构必须统一：

```ts
{ ok: true, data: T }
```

或：

```ts
{
  ok: false,
  error: {
    code: string,
    message: string,
    details?: unknown
  }
}
```

不要在不同 API 中混用不同格式。

### 7.2 写操作必须具备幂等性

以下操作必须有幂等保护：

- 创建开盒订单。
- Telegram Stars 支付回调。
- 发放开盒结果。
- 市场购买。
- 创建挂单。
- 改价。
- 下架。
- 升级。
- 合成。
- 分解。
- 签到。
- 领取任务奖励。
- 领取图鉴奖励。
- 邀请奖励发放。
- 创建 Mint 队列。

幂等键可来自：

- 客户端生成的 `idempotency_key`。
- Telegram payment charge id。
- webhook event id。
- 数据库唯一约束。

### 7.3 API 不可信输入规则

所有请求参数必须经过 Zod 校验。

禁止：

- 直接使用 `req.body`。
- 直接相信 `user_id`。
- 直接相信价格、手续费、奖励数量。
- 直接相信前端传入的抽卡结果。
- 直接相信前端传入的任务完成状态。

必须：

- 从 session 获取当前用户。
- 从数据库读取真实价格、库存、状态、规则。
- RPC 内再次校验关键业务条件。

---

## 8. 前端编码规则

### 8.1 React 组件规则

组件应保持轻量：

- 只负责展示和用户交互。
- 不直接处理复杂业务规则。
- 不直接调用 Supabase。
- 不直接修改真实资产、库存、交易状态。
- 不在组件里写大量请求逻辑。

推荐：

```txt
Page -> hooks -> feature.api.ts -> api-client -> Vercel API -> Supabase RPC
```

### 8.2 TanStack Query 规则

- 服务端数据必须用 TanStack Query 管理。
- 资产、库存、市场列表、任务、图鉴、钱包状态都属于服务端数据。
- 关键操作成功后必须 invalidate 相关 query。
- 资产类操作不要做危险乐观更新。
- 支付、购买、合成、分解、任务奖励必须等待服务端结果。

### 8.3 Zustand 规则

Zustand 只用于 UI 状态：

- 当前 tab。
- 当前选中盲盒。
- 当前筛选项。
- 弹窗开关。
- 临时输入值。

禁止用 Zustand 保存：

- 真实 K-coin 余额。
- 真实 Fgems 余额。
- 真实库存。
- 真实挂单状态。
- 支付成功状态。
- 钱包签名结果。

### 8.4 UI 展示规则

- 前端可以展示建议价格，但最终价格和手续费以后端返回为准。
- 前端可以展示保底进度，但真实保底状态以后端返回为准。
- 前端可以展示可能获得和概率，但真实奖励池版本以后端绑定订单为准。
- 前端可以展示支付按钮，但支付成功以后端 webhook 为准。
- 所有操作完成后通过全局 Toast / Modal 展示服务端返回结果。

---

## 9. 后端编码规则

### 9.1 API handler 固定流程

每个后端 API 按以下顺序实现：

1. 校验 HTTP method。
2. 解析请求体或 query。
3. Zod 校验参数。
4. 校验 session 或 admin 权限。
5. 限流和风控检查。
6. 调用 Supabase RPC。
7. 处理 RPC 返回。
8. 返回标准响应。

不要把业务事务散落在 API 代码里。

### 9.2 session 规则

- Telegram 用户 API 必须使用 `requireSession`。
- 后台 API 必须使用 `requireAdmin`。
- `user_id` 必须从 session 得到。
- 请求体里的 `user_id` 只能作为查询过滤条件的辅助参数，不能作为当前用户身份。

### 9.3 Supabase service role 规则

- service role key 只能出现在后端环境变量中。
- 前端禁止引用 `supabaseAdmin`。
- 前端禁止访问 service role key。
- 后端使用 service role 也必须执行业务权限判断，不能因为是 service role 就跳过校验。

### 9.4 错误处理规则

错误码必须清晰，例如：

```txt
AUTH_SESSION_EXPIRED
BOX_NOT_ACTIVE
BOX_SOLD_OUT
PAYMENT_NOT_CONFIRMED
BALANCE_NOT_ENOUGH
ITEM_NOT_AVAILABLE
ITEM_LOCKED
LISTING_NOT_FOUND
LISTING_NOT_ACTIVE
TASK_NOT_COMPLETED
TASK_ALREADY_CLAIMED
WALLET_PROOF_INVALID
MINT_ALREADY_PENDING
RATE_LIMITED
```

禁止直接向前端暴露：

- 数据库内部错误详情。
- service role 信息。
- webhook secret。
- Bot token。
- SQL 原文。

---

## 10. 数据库和 RPC 规则

### 10.1 数据库是核心真相源

以下数据以数据库为准：

- 用户身份。
- 资产余额。
- 资产流水。
- 盲盒状态。
- 奖励池版本。
- 抽卡结果。
- 保底状态。
- 库存实例。
- 库存锁。
- 市场挂单。
- 订单成交。
- 任务进度。
- 奖励领取。
- 图鉴进度。
- 钱包验证。
- Mint 状态。

### 10.2 Ledger 规则

所有 K-coin 和 Fgems 变化必须写入 `economy.currency_ledger`。

禁止：

- 只更新 `user_balances` 不写 ledger。
- 删除 ledger。
- 随意 update ledger。
- 没有 source_type/source_id 的资产变化。

推荐字段：

```txt
id
user_id
currency
amount
direction
source_type
source_id
balance_after
metadata
created_at
```

### 10.3 余额规则

- 扣款必须防止余额为负。
- 市场购买必须锁定并发。
- 任务奖励必须防重复领取。
- 支付发货必须防重复处理。
- 分红必须可追溯来源。

### 10.4 库存实例规则

每一份藏品都应该是独立实例：

```txt
inventory.item_instances
```

这样才能支持：

- 藏品编号。
- 独立等级。
- 独立战力。
- 独立挂售。
- 独立合成。
- 独立分解。
- 独立 Mint。
- 链上 NFT 映射。

### 10.5 库存锁规则

涉及以下操作时必须锁定库存：

- 挂售。
- 购买成交中。
- 合成。
- 分解。
- Mint。
- 后台处理异常订单。

同一 item instance 同一时间只能有一个 active lock。

### 10.6 RPC 安全规则

RPC 必须：

- 校验用户身份。
- 校验资源归属。
- 校验状态。
- 校验余额。
- 校验库存锁。
- 使用事务。
- 写操作日志。
- 返回明确结果。

RPC 不应：

- 信任前端传入的价格、奖励、概率。
- 信任前端传入的任务完成状态。
- 忽略并发锁。
- 没有唯一约束就处理支付或奖励。

---

## 11. 开盒抽卡规则

### 11.1 开盒流程

真实流程必须是：

```txt
前端选择盲盒
→ 后端创建开盒订单
→ Telegram Stars 支付
→ 后端收到 successful_payment
→ RPC 处理抽卡
→ 创建抽卡结果和藏品实例
→ 更新保底
→ 返还 100 K-coin
→ 写 ledger
→ 前端展示结果
```

### 11.2 禁止行为

- 禁止前端生成抽卡结果。
- 禁止前端更新保底次数。
- 禁止支付未成功就发放奖励。
- 禁止没有奖励池版本就抽卡。
- 禁止直接修改概率池历史版本。

### 11.3 奖励池规则

- 奖励池必须有版本。
- 订单创建时绑定当前奖励池版本。
- 运营修改概率时必须新建版本。
- 历史订单必须能追溯当时的概率和奖励池。

### 11.4 保底规则

- 每款盲盒有独立保底。
- `user_id + box_id` 唯一。
- 是否命中保底由 RPC 判断。
- 命中目标稀有度后是否重置由 `pity_rules` 决定。

---

## 12. Telegram Stars 支付规则

### 12.1 支付真相源

支付成功只认 Telegram webhook 中的 `successful_payment`。

前端状态、支付弹窗关闭、用户点击完成，都不能作为支付成功依据。

### 12.2 支付订单规则

支付订单必须记录：

```txt
order_id
user_id
business_type
business_id
stars_amount
invoice_payload
status
created_at
paid_at
```

支付成功必须记录：

```txt
telegram_payment_charge_id
provider_payment_charge_id
invoice_payload
raw_update
```

### 12.3 幂等规则

- `telegram_payment_charge_id` 必须唯一。
- webhook event 必须先落库。
- 同一支付不能重复发货。
- 支付处理失败要能重试。

---

## 13. 市场交易规则

### 13.1 创建挂单

创建挂单必须：

1. 校验藏品属于当前用户。
2. 校验藏品状态为 `available`。
3. 校验藏品可交易。
4. 创建库存锁。
5. 创建 listing。
6. 写 listing event。

### 13.2 购买挂单

购买挂单必须在一个事务内完成：

1. 锁定 listing。
2. 校验 listing 为 active。
3. 校验买家不是卖家，或按业务规则允许/禁止。
4. 校验买家 K-coin 足够。
5. 扣买家 K-coin。
6. 卖家到账。
7. 平台手续费入账。
8. 转移 item instance owner。
9. 更新 listing 状态。
10. 写 order、order_items、ledger、events。

### 13.3 禁止行为

- 禁止前端直接把挂单改成 sold。
- 禁止没有库存锁就上架。
- 禁止购买时只改 owner 不写订单。
- 禁止只扣买家不写卖家到账。
- 禁止只更新余额不写 ledger。

---

## 14. 藏品成长规则

### 14.1 升级

- 升级消耗 Fgems。
- 升级必定成功。
- 升级结果以后端 RPC 返回为准。
- 挂售中、锁定中、Mint 中的藏品不能升级。

### 14.2 合成/进化

规则：

- 消耗 3 份相同藏品。
- 消耗 K-coin。
- 每个系列有 3 个形态。
- 低阶可以进化到中阶，中阶可以进化到高阶。
- 合成有失败概率。
- 失败后返还 1 个主藏品。
- 主藏品为 3 个中等级最高的那一个。
- 其余藏品和 K-coin 不返还。

禁止前端决定成功或失败。

### 14.3 分解

- 只能分解用户拥有的重复藏品。
- 挂售中、锁定中、Mint 中的藏品不能分解。
- 分解奖励 Fgems 以后端规则为准。
- 分解后 item instance 状态改为 `decomposed`。
- 必须写 ledger 和 inventory event。

---

## 15. 任务和邀请规则

### 15.1 邀请关系

- invitee 只能绑定一个 inviter。
- 邀请关系由后端根据 Telegram deep link / start payload 判断。
- 前端不能手动指定 inviter。
- 用户不能邀请自己。

### 15.2 首次开盒奖励

被邀请人完成首次开盒后：

- 邀请人获得 500 K-coin。
- 被邀请人获得 500 K-coin。
- 奖励只能发一次。
- 必须写 ledger。

### 15.3 分红

- 邀请人获得好友开盒积分收益的 10% 分红。
- 分红基数必须由后端定义和计算。
- 分红必须写 `referral_commissions` 和 ledger。

### 15.4 签到和任务

- 签到状态以后端返回为准。
- 任务进度以后端返回为准。
- 领取奖励必须防重复。
- 未完成任务不能领取。
- 已领取任务不能重复领取。

---

## 16. 图鉴和排行榜规则

### 16.1 图鉴进度

图鉴应基于用户首次获得记录，而不是当前库存。

原因：用户出售、分解、Mint 或转移藏品后，已发现记录仍应保留。

### 16.2 图鉴奖励

- 是否可领取由后端判断。
- 每个里程碑只能领取一次。
- 奖励可能包括 K-coin、Fgems、Star 展示奖励、道具、限定装饰。
- 奖励必须写 ledger 或 inventory event。

### 16.3 排行榜

- 排行榜不应每次页面打开实时重算全部用户。
- 应通过定时任务或物化结果刷新。
- 分数规则放数据库或后台配置。

---

## 17. TON 钱包和 NFT 规则

### 17.1 钱包连接

- 前端只调用 TON Connect。
- 前端只展示公开地址和连接状态。
- 不保存私钥。
- 不保存助记词。
- 不把签名结果当作最终可信结果。
- ton_proof 必须由后端验证。

### 17.2 Mint 队列

Mint 必须走队列：

```txt
用户请求 Mint
→ 后端校验钱包和藏品
→ RPC 锁定藏品实例
→ 创建 mint_queue
→ 后端/cron 执行链上 Mint
→ 成功后绑定 NFT item address
→ 失败后记录错误并允许重试或解锁
```

### 17.3 链上同步

- 链上 NFT 同步不能覆盖数据库核心库存，必须做映射。
- 链上查询可能延迟，前端必须展示 pending 状态。
- Mint 成功、失败、重试都要记录链上交易状态。

---

## 18. 后台管理规则

后台功能必须和前台隔离。

后台 API 必须：

- 使用 `requireAdmin`。
- 校验管理员角色权限。
- 对高风险操作写 `ops.admin_audit_logs`。
- 对概率、奖励、库存、手续费、用户资产调整进行二次确认。

后台禁止：

- 直接删除历史支付记录。
- 直接删除抽卡结果。
- 直接覆盖旧概率池版本。
- 无审计修改用户余额。
- 无审计修改市场挂单。

概率修改必须新建奖励池版本，而不是覆盖历史版本。

---

## 19. 环境变量规则

### 19.1 前端可用变量

前端只允许使用公开变量，例如：

```txt
VITE_APP_ENV
VITE_API_BASE_URL
VITE_TONCONNECT_MANIFEST_URL
```

### 19.2 后端私密变量

以下变量只能在 Vercel 后端环境中使用：

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
SESSION_SECRET
TON_API_KEY
TON_WALLET_PRIVATE_KEY
ADMIN_SESSION_SECRET
```

禁止将私密变量暴露到前端。

---

## 20. 测试规则

### 20.1 必须测试的高风险场景

每次实现以下功能时，必须补充测试：

- Telegram 登录。
- Stars 支付回调幂等。
- 开盒保底。
- 十连 9 折价格。
- 支付成功后发货。
- 余额不可为负。
- 市场并发购买同一挂单。
- 挂售后不能升级/合成/分解。
- 下架后库存恢复。
- 合成失败返还主藏品。
- 任务奖励不能重复领取。
- 邀请首开盒奖励只能发一次。
- 图鉴奖励不能重复领取。
- Mint 队列不能重复创建。

### 20.2 测试文件位置

- 前端单元测试：`tests/unit/`
- API 测试：`tests/api/`
- E2E 测试：`tests/e2e/`
- SQL 测试：`supabase/tests/`

---

## 21. AI 编码输出要求

AI 每次完成代码修改后，必须输出以下内容：

```txt
变更摘要：
- 修改了什么功能
- 涉及哪些文件
- 是否新增数据库 migration / RPC / 类型 / 测试

关键逻辑：
- 认证如何处理
- 参数如何校验
- 是否走 RPC
- 是否具备幂等性
- 是否刷新前端 query

测试情况：
- 已添加哪些测试
- 已运行哪些测试
- 未运行的测试和原因

风险与假设：
- 哪些字段或业务规则是假设
- 哪些地方需要开发者确认
```

禁止只说“已完成”而不说明文件和逻辑。

---

## 22. AI 任务执行模板

当开发者给出任务时，AI 应按此模板理解和执行：

```txt
任务目标：
明确要实现哪个功能。

涉及模块：
前端 feature、后端 API、RPC、数据库表、测试。

先检查：
列出需要先查看的文件。

实现计划：
1. 类型和 schema
2. 前端 API client
3. Hook
4. UI 组件
5. 后端 API
6. RPC / migration
7. 测试

不得修改：
列出不相关文件，避免过度改动。

验收标准：
列出用户可见结果和业务安全条件。
```

---

## 23. 常见任务的正确落点

| 任务 | 前端文件 | 后端文件 | 数据库文件 |
|---|---|---|---|
| 增加资产栏字段 | `features/assets/*` | `api/me/assets.ts` | 可能需要 `economy` 表或 view |
| 新增盲盒 | `features/box/*` | `api/boxes/*` | `gacha.blind_boxes`、`drop_pool_versions` |
| 实现单抽 | `features/box/hooks/useCreateOpenOrder.ts` | `api/boxes/create-open-order.ts` | `gacha_create_order` |
| 处理支付成功 | 不由前端处理 | `api/telegram/webhook.ts` | `gacha_process_paid_order`、`payments.*` |
| 市场购买 | `features/trade/*` | `api/market/buy.ts` | `market_buy_listing` |
| 出售藏品 | `features/trade/sell/*` | `api/market/create-listing.ts` | `market_create_listing` |
| 改价 | `features/trade/manage/*` | `api/market/update-price.ts` | `market_update_listing_price` |
| 下架 | `features/trade/manage/*` | `api/market/cancel-listing.ts` | `market_cancel_listing` |
| 升级 | `features/collection/*` | `api/inventory/upgrade.ts` | `inventory_upgrade_item` |
| 合成 | `features/collection/*` | `api/inventory/evolve.ts` | `inventory_evolve_item` |
| 分解 | `features/collection/*` | `api/inventory/decompose.ts` | `inventory_decompose_item` |
| 签到 | `features/tasks/*` | `api/tasks/check-in.ts` | `task_daily_check_in` |
| 任务领取 | `features/tasks/*` | `api/tasks/claim.ts` | `task_claim_reward` |
| 图鉴奖励 | `features/album/*` | `api/album/claim-reward.ts` | `album_claim_milestone` |
| 钱包连接 | `features/wallet/*` | `api/wallet/connect.ts` | `core.user_wallets` |
| Mint | `features/wallet/*` | `api/wallet/mint.ts` | `wallet_enqueue_mint` |
| 后台概率配置 | `apps/admin/*` | `api/admin/drop-pools.ts` | `drop_pool_versions` |

---

## 24. 代码风格规则

- 使用 TypeScript strict。
- 不使用 `any`，除非有明确注释说明。
- 不使用魔法字符串；状态、币种、稀有度应来自 domain 常量。
- 不在组件中写大段数据转换逻辑。
- 不在 API 中重复写相同认证逻辑。
- 不在多个地方重复定义同一类型。
- 错误码集中维护。
- 所有异步请求必须处理 loading、error、success 状态。
- 用户可见文案保持中文。
- 业务日志和错误日志不要包含敏感信息。

---

## 25. 最终检查清单

提交任何功能前，AI 必须自检：

```txt
[ ] 是否遵守前端只展示、后端/RPC 决策？
[ ] 是否没有在前端修改真实资产？
[ ] 是否没有在前端生成抽卡结果？
[ ] 是否没有信任请求体里的 user_id？
[ ] 是否所有写操作都经过 Zod 校验？
[ ] 是否核心写操作走 RPC？
[ ] 是否涉及资产变化都写 ledger？
[ ] 是否涉及库存都处理锁？
[ ] 是否支付、领取、购买等操作具备幂等性？
[ ] 是否更新或新增了类型？
[ ] 是否避免手动修改生成的数据库类型？
[ ] 是否没有暴露 service role、Bot token、私钥？
[ ] 是否补充了必要测试？
[ ] 是否说明了假设和风险？
```

---

## 26. 一句话总规则

如果一个功能涉及资产、支付、库存、抽卡、交易、奖励、任务、钱包或 NFT，AI 必须默认它是高风险业务逻辑，不能在前端实现最终结果，必须通过后端 API、数据库 RPC、事务、幂等、审计和测试来完成。
