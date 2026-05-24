---
description: FinalTMA 第三阶段「成长系统」开发规则：升级、合成、分解、图鉴、图鉴奖励、排行榜
globs:
  - "api/inventory/**/*.ts"
  - "api/album/**/*.ts"
  - "api/cron/**/*.ts"
  - "apps/web/src/features/collection/**/*"
  - "apps/web/src/features/album/**/*"
  - "apps/web/src/api/endpoints.ts"
  - "apps/web/src/shared/constants/queryKeys.ts"
  - "apps/web/src/app/router.tsx"
  - "apps/web/src/shared/constants/routes.ts"
  - "packages/validation/src/inventory.schemas.ts"
  - "packages/validation/src/album.schemas.ts"
  - "packages/server/src/db/rpc.ts"
  - "supabase/migrations/**/*.sql"
  - "supabase/tests/**/*.sql"
alwaysApply: false
---

# FinalTMA Stage 3 Growth System AI Coding Rules

## 0. 本文件当前定位和强制总规则

本文件用于记录第三阶段「成长系统」的当前真实状态和后续开发边界。

当前事实以这三个来源为准：

1. 本地仓库真实文件。
2. `项目功能与界面说明.md`。
3. Supabase 真实 schema / migration / RPC 签名 / 远程数据。


- 本地仓库存在一批第三阶段占位文件，但多数是 0 行空文件，不能视为已实现。
- 远程 Supabase 项目 ref 为 `omopnbourswzyeigotbs`。
- 远程第三阶段规则表、图鉴册、里程碑、排行榜配置表当前仍为空。
- 远程已存在部分第三阶段写操作 RPC，但缺少详情、图鉴进度、排行榜等查询 RPC。


本规则文件用于约束 AI 在开发第三阶段「成长系统」时的行为，目标是减少幻觉、减少重复造轮子、避免破坏第二阶段交易闭环。

第三阶段范围：

- 藏品升级：消耗 `FGEMS`，等级和战力提升，升级必定成功。
- 藏品合成 / 进化：消耗 3 份相同藏品 + `KCOIN`，按服务端成功率生成下一形态；失败返还等级最高主藏品，其余材料和 KCOIN 不返还。
- 藏品分解：只能分解重复藏品，获得 `FGEMS`。
- 图鉴：基于永久发现记录 `album.user_discoveries` 展示收集进度。
- 图鉴奖励：达到里程碑后由后端判断是否可领取。
- 排行榜：每周图鉴榜，基于数据库统计生成，不在前端计算真实排名。

---

## 1. 当前项目事实，编码前必须遵守

### 1.1 技术与目录事实

当前项目是 `pnpm` monorepo：

- 根项目名：`tma-game`
- 包管理器：`pnpm@11.1.3`
- 根目录 `engines.node`: `>=24.0.0`
- workspace：
  - `apps/*`
  - `packages/*`
  - `contracts`

当前前端包是：

- `apps/web`
- 包名：`@tma-game/web`
- React + Vite + TypeScript
- 主要依赖：React Router、TanStack Query、Zod、Zustand、TMA SDK、TON Connect。

当前 Vercel API 位于根目录：

- `api/**`

当前共享校验位于：

- `packages/validation/src/inventory.schemas.ts`
- `packages/validation/src/album.schemas.ts`
- `packages/validation/src/market.schemas.ts`

当前服务端共享能力位于：

- `packages/server/src/db/rpc.ts`
- `api/_shared/handler.ts`
- `api/_shared/requireSession.ts`
- `api/_shared/parseBody.ts`
- `api/_shared/validate.ts`

不要改技术栈。不要引入新的 API 框架。不要把第三阶段写成 Next.js App Router。当前项目就是 Vercel Functions + Vite 前端。

---

### 1.2 当前前端事实

当前已接入路由：

- `/box`
- `/collection`
- `/trade`
- `/game`
- `/tasks`

当前还没有接入 `/album` 路由：

- `apps/web/src/shared/constants/routes.ts` 里没有 `album`。
- `apps/web/src/app/router.tsx` 里没有 `/album` route。
- `apps/web/src/shared/constants/nav.ts` 底部导航没有图鉴入口。

注意：`apps/web/src/features/album/` 目录已经存在，但目前是空占位文件，不代表图鉴功能已经实现。

当前 `API_ENDPOINTS.inventory` 只有：

- `list: "/inventory/list"`

当前还没有：

- `/inventory/detail`
- `/inventory/upgrade`
- `/inventory/evolve`
- `/inventory/decompose`
- `/inventory/activity`

当前也没有 `API_ENDPOINTS.album`。开发第三阶段时必须补齐：

- `/album/progress`
- `/album/series`
- `/album/items` 或沿用当前占位文件里的 `/album/discoveries`，二者必须先给选择并统一命名
- `/album/claim-reward`
- `/album/leaderboard`

当前 `queryKeys.inventory` 只有：

- `root`
- `list(userId)`

当前还没有 album query keys。开发第三阶段时必须补齐：

- `inventory.detail(userId, itemId)`
- `inventory.activity(userId, query)`
- `album.root`
- `album.progress(userId, query)`
- `album.series(userId, query)`
- `album.items(userId, query)`
- `album.leaderboard(userId, query)`

当前 `CollectionPage` 已有并已实际使用：

- `useInventory()`
- `selectedItemId`
- `selectedItem`
- `CharacterHero`
- `CharacterGrid`
- 空库存状态
- 加载状态
- 错误重试状态

不要重写整个 `CollectionPage`。第三阶段应该在现有 `selectedItem` 机制上扩展成长操作。

当前 collection 下已经存在这些 0 行占位文件，不能视为已实现：

- `CharacterDetailSheet.tsx`
- `CharacterInfoCard.tsx`
- `CollectionSellEntry.tsx`
- `CollectionCancelEntry.tsx`
- `UpgradePanel.tsx`
- `EvolvePanel.tsx`
- `DecomposePanel.tsx`
- `useItemDetail.ts`
- `useInventoryActivity.ts`
- `useUpgradeItem.ts`
- `useEvolveItem.ts`
- `useDecomposeItem.ts`

当前 `collection.api.ts` 已有：

- `fetchInventory()`
- `normalizeInventoryResponse()`
- `normalizeInventoryItem()`

当前 `collection.types.ts` 已有：

- `CollectionInventoryItem`
- `level`
- `power`
- `status`
- `nftMintStatus`
- `isTradeable`
- `isUpgradeable`
- `isEvolvable`
- `isDecomposable`
- `isMintable`

不要为同一字段另起一套命名。前端 UI 使用已有类型扩展，不要重复定义冲突类型。

当前 album 下已经存在这些 0 行占位文件，不能视为已实现：

- `album.api.ts`
- `album.types.ts`
- `pages/AlbumPage.tsx`
- `components/AlbumGrid.tsx`
- `components/AlbumItemCard.tsx`
- `components/AlbumProgress.tsx`
- `components/AlbumSeriesTabs.tsx`
- `components/ClaimAlbumRewardButton.tsx`
- `components/LeaderboardPanel.tsx`
- `components/LeaderboardRow.tsx`
- `components/MilestoneRewardRow.tsx`
- `components/WalletSyncPanel.tsx`
- `hooks/useAlbumProgress.ts`
- `hooks/useAlbumSeries.ts`
- `hooks/useClaimAlbumReward.ts`
- `hooks/useLeaderboard.ts`
- `hooks/useWalletNftSync.ts`

---

### 1.3 当前 API 事实

已有 `api/inventory/list.ts` 是第三阶段接口的参考模板。新 API 必须沿用它的模式：

- `withApiHandler(...)`
- `requireSession(req)`
- `validate(schema, input)`
- `callRpcRaw(...)`
- `RpcError` 错误映射
- 返回标准 API response
- 不直接信任前端传入的 `user_id`

当前这些第三阶段 API 文件已经存在，但都是 0 行空占位，不能视为已实现：

- `api/inventory/detail.ts`
- `api/inventory/upgrade.ts`
- `api/inventory/evolve.ts`
- `api/inventory/decompose.ts`
- `api/inventory/activity.ts`
- `api/album/progress.ts`
- `api/album/series.ts`
- `api/album/discoveries.ts`
- `api/album/claim-reward.ts`
- `api/album/leaderboard.ts`
- `api/cron/refresh-leaderboard.ts`

已有 `api/market/create-listing.ts` 是写操作 API 的参考模板。升级、合成、分解、领取图鉴奖励都应参考这个文件的写法：

- `parseJsonBody`
- 从 header 或 body 读取 `idempotency_key`
- Zod schema 校验
- 从 session 获取 `userId`
- 调用 `api` schema 下的 RPC
- 标准化 RPC 返回值
- 映射 RPC 错误成稳定错误码
- 配置 rate limit action

所有核心写操作必须走 Supabase RPC。API 层只做：

1. 鉴权
2. 参数校验
3. 幂等键读取
4. RPC 调用
5. 错误映射
6. 返回值标准化

API 层禁止实现真实业务扣费、库存转移、合成概率、奖励发放。

---

### 1.4 当前数据库事实

Supabase 当前已存在第三阶段相关表，但大量规则数据为空。

远程项目 `omopnbourswzyeigotbs` 截至 2026-05-24 的核验结果：

已存在且有数据的关键表：

- `inventory.item_instances`：10 行
- `inventory.item_instance_events`：16 行
- `inventory.inventory_locks`：3 行
- `album.user_discoveries`：4 行

已存在但当前为空、开发第三阶段前必须补齐规则或生成逻辑的表：

- `inventory.upgrade_rules`
- `inventory.evolution_rules`
- `inventory.decompose_rules`
- `inventory.upgrade_logs`
- `inventory.evolution_attempts`
- `inventory.evolution_consumed_items`
- `inventory.decompose_logs`
- `album.books`
- `album.book_items`
- `album.milestones`
- `album.milestone_claims`
- `album.score_rules`
- `album.weekly_leaderboards`
- `album.leaderboard_entries`

不要在前端写假规则。不要在 UI 中硬编码升级消耗、合成成功率、分解奖励、图鉴里程碑。规则必须来自数据库。

如果需要补规则数据：

- 可以先编写本地 migration 或 seed SQL。
- 不允许直接应用到远程 Supabase。
- 必须先把 SQL 内容交给用户审核，用户确认后才能推送应用。

---

### 1.5 当前已存在的 RPC 事实

开发前需要先检查数据库中 RPC 是否仍存在。远程项目 `omopnbourswzyeigotbs` 截至 2026-05-24 实际存在以下 RPC：

- `api.inventory_list_user_items(p_user_id, p_statuses, p_limit, p_offset)`
- `api.inventory_upgrade_item(p_user_id, p_item_instance_id, p_idempotency_key)`
- `api.inventory_evolve_item(p_user_id, p_item_instance_ids, p_idempotency_key)`
- `api.inventory_decompose_item(p_user_id, p_item_instance_id, p_idempotency_key)`
- `api.album_claim_milestone(p_user_id, p_milestone_id)`

如果这些 RPC 签名和当前代码不一致，必须以数据库实际签名为准，并同步 API 层调用参数。

重要不一致：

- validation 里 `InventoryDecomposeItemBodySchema` 使用 `item_instance_ids` 批量数组，但远程 RPC 当前只有单个 `p_item_instance_id`。
- validation 里 `AlbumClaimMilestoneRewardBodySchema` 要求 `idempotency_key`，但远程 `api.album_claim_milestone` 当前没有 `p_idempotency_key` 参数。
- 如果要把图鉴领奖改成严格幂等键模式，必须新增或修改 RPC migration，并先让用户审核 SQL。

第三阶段还需要新增或补齐：

- `api.inventory_get_item_detail`
- `api.inventory_get_upgrade_preview`，可合并进 detail
- `api.inventory_get_evolution_preview`，可合并进 detail
- `api.inventory_get_decompose_preview`，可合并进 detail
- `api.inventory_decompose_items`，用于批量分解；如果不做批量，API 必须限制一次只分解一个
- `api.album_get_progress`
- `api.album_list_books`
- `api.album_get_items` 或 `api.album_get_discoveries`，命名必须先统一
- `api.album_get_leaderboard`
- `api.album_refresh_weekly_leaderboard`

---

## 2. 不允许 AI 做的事

### 2.1 不允许凭空创造项目事实

禁止：

- 假设已有 `/album` 路由。
- 假设 `features/album` 目录不存在。
- 假设 `features/album` 目录里的空占位文件已经实现。
- 假设 `api/inventory/*`、`api/album/*`、`api/cron/refresh-leaderboard.ts` 的空占位文件已经实现。
- 假设 `API_ENDPOINTS.album` 已存在。
- 假设 `queryKeys.album` 已存在。
- 假设数据库规则表已有数据。
- 假设前端可以直接调用 Supabase。
- 假设前端能决定升级消耗、合成成功率、分解奖励、里程碑状态。
- 假设用户 ID 可以从 body/query 读取并信任。
- 假设图鉴进度基于当前库存。
- 假设分解后要删除图鉴点亮记录。
- 假设 listed / locked / minting 藏品可以升级、合成、分解。

如果缺少信息，必须先搜索现有文件或数据库迁移。仍不确定时，写 TODO 注释并保持行为保守，不要编造逻辑。

---

### 2.2 不允许破坏第二阶段交易闭环

禁止改坏以下第二阶段能力：

- 市场挂单创建
- 市场购买
- 出售管理
- 改价
- 下架
- 市场筛选
- 交易手续费
- 挂售库存锁定

第三阶段只能读取 `market` 状态来判断藏品是否可成长，不能绕过 `market` 的锁定逻辑。

挂售中藏品必须视为：

- 不可升级
- 不可合成
- 不可分解
- 不可 Mint

---

### 2.3 不允许在前端实现核心业务

前端只能做展示、输入、确认、调用 API、展示结果。

前端禁止：

- 扣 KCOIN
- 扣 FGEMS
- 增加 FGEMS
- 决定合成成功或失败
- 计算真实随机数
- 修改库存状态
- 修改图鉴进度
- 判断里程碑真实可领取
- 生成排行榜真实排名
- 信任本地缓存作为最终状态

所有真实结果以后端 API 返回为准，后端 API 又必须以 Supabase RPC 事务结果为准。

---

### 2.4 不允许直接改 ledger 历史

`economy.currency_ledger` 是不可变账本。

禁止：

- update ledger
- delete ledger
- 前端构造 ledger
- API 层直接拼接余额变化
- 只改 `economy.user_balances` 不写 ledger

资产变化必须通过现有或新增 RPC 完成，且必须写入 ledger。

---

## 3. 编码前强制检查清单

每次让 AI 编写第三阶段代码前，先执行这些检查：

1. 阅读 `项目功能与界面说明.md` 中与本次任务相关的章节。
2. 检查目标文件是否已存在，且确认是否是 0 行空占位文件。
3. 检查同类模块现有写法。
4. 检查 validation schema 是否已定义。
5. 检查 API_ENDPOINTS 是否已有路径。
6. 检查 queryKeys 是否已有缓存 key。
7. 检查 RPC 签名是否和 API 调用一致。
8. 检查数据库表是否已有规则数据。
9. 检查操作是否会影响交易锁。
10. 检查成功后需要 invalidate 哪些 query。
11. 检查失败时是否会产生脏数据。
12. 如果涉及 SQL，只能先写本地 migration / seed，不能直接推送应用到远程 Supabase。

如果以上任意项无法确认，不要继续大改，先补验证或写最小实现。

---

## 4. 第三阶段推荐开发顺序

AI 必须按以下顺序开发，禁止先写复杂 UI：

0. 开发前对齐：
   - 重新核验 `项目功能与界面说明.md` 相关章节。
   - 确认当前空占位文件要“补实现”还是“改名后补实现”。
   - 如果命名有多套方案，先给用户选择，不要同时保留两套。
   - 确认 SQL 只写本地文件，等用户审核后再推远程。

1. 数据库 seed / migration：
   - `inventory.upgrade_rules`
   - `inventory.evolution_rules`
   - `inventory.decompose_rules`
   - `album.books`
   - `album.book_items`
   - `album.milestones`
   - `album.score_rules`
   - `album.weekly_leaderboards`

2. 数据库 RPC / 查询能力：
   - 库存详情
   - 升级预览
   - 合成预览
   - 分解预览
   - 图鉴进度
   - 图鉴册列表
   - 排行榜查询
   - 排行榜刷新
   - 对齐分解单个 / 批量的 RPC 签名
   - 对齐图鉴奖励是否新增 `p_idempotency_key`

3. Vercel API：
   - `api/inventory/detail.ts`
   - `api/inventory/upgrade.ts`
   - `api/inventory/evolve.ts`
   - `api/inventory/decompose.ts`
   - `api/inventory/activity.ts`
   - `api/album/progress.ts`
   - `api/album/series.ts`
   - `api/album/items.ts` 或当前占位 `api/album/discoveries.ts`，先统一命名再实现
   - `api/album/claim-reward.ts`
   - `api/album/leaderboard.ts`
   - `api/cron/refresh-leaderboard.ts`

4. 前端 API 和 hooks：
   - 扩展 `API_ENDPOINTS`
   - 扩展 `queryKeys`
   - 扩展 `collection.api.ts`
   - 新增 `album.api.ts`
   - 新增 collection 成长 hooks
   - 新增 album hooks

5. Collection UI：
   - 详情面板
   - 升级面板
   - 合成面板
   - 分解面板
   - 成长结果弹窗

6. Album UI：
   - `/album` 路由
   - 图鉴进度
   - 图鉴册 tabs
   - 图鉴物品网格
   - 图鉴里程碑
   - 排行榜面板

7. 测试：
   - 数据库测试
   - API 测试
   - 前端单元测试
   - E2E 手动验收

---

## 5. API 编写规则

### 5.1 所有写操作 API 必须使用这个流程

写操作包括：

- `POST /inventory/upgrade`
- `POST /inventory/evolve`
- `POST /inventory/decompose`
- `POST /album/claim-reward`
- `POST /cron/refresh-leaderboard`，受保护

注意：以上 API 文件当前是空占位文件，尚未实现。

必须流程：

1. `withApiHandler`
2. `requireSession(req)`，cron 除外，但 cron 必须验证 secret
3. `parseJsonBody`
4. `validate(ZodSchema, normalizedInput)`
5. `getIdempotencyKey(req)`，适用于用户写操作
6. 从 session 获取 `userId`
7. 调用 `callRpcRaw(..., { schema: "api" as never })`
8. 捕获 `RpcError`
9. 映射稳定错误码
10. 标准化返回值

禁止从 body/query 中使用 `user_id` 作为真实用户 ID。若 body 中带了 `user_id`，最多用于检测非法输入或忽略。

当前 `api.album_claim_milestone` RPC 没有幂等键参数，因此 `POST /album/claim-reward` 有两种方案，必须先给用户选择：

- 方案 1：修改 RPC，增加 `p_idempotency_key`，严格符合本文件幂等规则。优点是规则一致；缺点是需要 SQL migration 和用户审核后远程应用。
- 方案 2：暂时沿用 `album.milestone_claims` 唯一约束做重复领取保护。优点是改动小；缺点是不完全符合“所有用户写操作都显式传幂等键”的规则。

---

### 5.2 API 返回规则

成功返回必须通过 `withApiHandler` 标准成功结构，不要手写裸 JSON。

前端期望：

```ts
{
  ok: true,
  success: true,
  data: ...
}
```

错误返回必须是标准错误结构：

```ts
{
  ok: false,
  success: false,
  error: {
    code: string,
    message: string,
    details?: unknown
  }
}
```

不要返回混乱字段：

- 不要一会儿 `success`，一会儿 `ok`
- 不要一会儿 `itemId`，一会儿 `item_instance_id`
- 后端 API 返回给前端优先使用 snake_case，前端 normalizer 转 camelCase

---

### 5.3 推荐错误码

升级：

- `ITEM_NOT_FOUND`
- `ITEM_NOT_OWNER`
- `ITEM_NOT_AVAILABLE`
- `ITEM_NOT_UPGRADEABLE`
- `ITEM_MAX_LEVEL`
- `UPGRADE_RULE_NOT_FOUND`
- `INSUFFICIENT_FGEMS`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_CONFLICT`

合成：

- `EVOLVE_ITEM_COUNT_INVALID`
- `EVOLVE_DUPLICATE_ITEM_IDS`
- `ITEM_NOT_FOUND`
- `ITEM_NOT_AVAILABLE`
- `ITEM_NOT_EVOLVABLE`
- `EVOLVE_REQUIRES_SAME_TEMPLATE_AND_FORM`
- `EVOLVE_RULE_NOT_FOUND`
- `INSUFFICIENT_KCOIN`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_CONFLICT`

分解：

- `ITEM_NOT_FOUND`
- `ITEM_NOT_OWNER`
- `ITEM_NOT_AVAILABLE`
- `ITEM_NOT_DECOMPOSABLE`
- `DECOMPOSE_REQUIRES_DUPLICATE`
- `DECOMPOSE_RULE_NOT_FOUND`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_CONFLICT`

图鉴奖励：

- `MILESTONE_NOT_FOUND`
- `MILESTONE_NOT_REACHED`
- `MILESTONE_ALREADY_CLAIMED`
- `REWARD_CONFIG_INVALID`

排行榜：

- `LEADERBOARD_NOT_FOUND`
- `LEADERBOARD_REFRESH_FORBIDDEN`
- `LEADERBOARD_REFRESH_FAILED`

---

## 6. 数据库与 RPC 规则

### 6.1 升级规则

升级必须满足：

- item 属于当前用户
- item.status = `available`
- template.upgradeable = true
- item.level < template.max_level
- 找到 active `inventory.upgrade_rules`
- 用户 FGEMS 足够
- 升级必定成功
- 扣 FGEMS
- 更新 level、power、lock_version、updated_at
- 写 `inventory.upgrade_logs`
- 写 `inventory.item_instance_events`
- 写 `economy.currency_ledger`

禁止：

- 升级 listed / locked / minting / consumed / decomposed item
- 前端自扣 FGEMS
- 无 ledger 的升级

---

### 6.2 合成 / 进化规则

合成必须满足：

- 正好 3 个 item instance
- 3 个 id 不重复
- 3 个 item 都属于当前用户
- 3 个 item 都是 `available`
- 3 个 item 同 template
- 3 个 item 同 form
- template.evolvable = true
- 找到 active `inventory.evolution_rules`
- 用户 KCOIN 足够
- 后端决定随机结果

成功时：

- 3 个旧 item status = `consumed`
- owner_user_id = null
- 创建 1 个新 item_instance
- 新 item owner_user_id = 当前用户
- 写 `inventory.evolution_attempts`
- 写 `inventory.evolution_consumed_items`
- 写 `inventory.item_instance_events`
- 扣 KCOIN 并写 ledger
- 如果产生新 template，应写入 `album.user_discoveries`

失败时：

- 等级最高、战力最高、获取时间最早的 item 为主藏品
- 主藏品保留为 available
- 其余两个 status = consumed
- KCOIN 不返还
- 不创建目标 item
- 写 attempts / consumed_items / events / ledger

禁止：

- 前端决定成功失败
- API 层生成随机结果
- 合成 listed / locked / minting item
- 不写 attempts 直接改库存

---

### 6.3 分解规则

分解必须满足：

- item 属于当前用户
- item.status = `available`
- template.decomposable = true
- 同 template + same form 的 available 数量 >= 2
- 找到 active `inventory.decompose_rules`
- 发放 FGEMS
- item status = `decomposed`
- owner_user_id = null
- 写 `inventory.decompose_logs`
- 写 `inventory.item_instance_events`
- 写 `economy.currency_ledger`

禁止：

- 分解用户唯一的一份藏品
- 分解 listed / locked / minting item
- 分解后删除 `album.user_discoveries`
- 前端直接增加 FGEMS

---

### 6.4 图鉴规则

当前第三阶段图鉴按 `template_id` 点亮，而不是按 `form_id` 点亮。

图鉴进度必须基于：

- `album.user_discoveries`
- `album.book_items`

不是基于当前库存。

这意味着：

- 用户出售藏品后，图鉴不熄灭
- 用户分解藏品后，图鉴不熄灭
- 用户 Mint 或链上转移后，图鉴不熄灭

如果未来要做形态图鉴，必须先改表结构，不要在前端硬凑。

---

### 6.5 图鉴奖励规则

领取奖励必须满足：

- milestone active
- milestone 所属 book active
- 用户 collected_count >= milestone.required_count
- 用户未领取过该 milestone
- 奖励 JSON 可被后端奖励函数处理

领取后必须：

- 写 `album.milestone_claims`
- 应用奖励到 ledger
- 返回奖励结果
- 前端刷新资产和图鉴状态

禁止：

- 前端判断真实可领取后直接发奖励
- 重复领取重复发奖
- milestone reward 为空还显示可领取

---

### 6.6 排行榜规则

排行榜真实分数必须由数据库或服务端任务生成。

前端只展示：

- rank
- display_name
- avatar_url
- score
- completion_percent
- collected_count
- total_count
- rare_count
- epic_count
- legendary_count
- mint_count
- generated_at

禁止前端：

- 计算真实 score
- 生成 rank
- 排序后当作真实排名
- 用假用户填充榜单

当没有榜单数据时，显示“榜单生成中”或空状态。

---

## 7. 前端开发规则

### 7.1 Collection 页面扩展规则

不要重写 `CollectionPage`。在现有结构上新增：

- `CharacterDetailSheet`
- `GrowthActionBar`
- `UpgradePanel`
- `EvolutionPanel` 或沿用当前占位文件名 `EvolvePanel`
- `DecomposePanel`
- `GrowthResultModal`
- `ItemStatusBadge`

新增 hooks：

- `useInventoryDetail` 或沿用当前占位文件名 `useItemDetail`
- `useUpgradeItem`
- `useEvolveItem`
- `useDecomposeItems` 或沿用当前占位文件名 `useDecomposeItem`
- `useGrowthInvalidation`

当前仓库已有 `EvolvePanel.tsx`、`useItemDetail.ts`、`useDecomposeItem.ts` 等空占位文件。实现前必须先统一命名方案；如果要改名，先给用户选择，不要新增一套同义文件并同时保留旧占位。

`CharacterHero` 只负责展示顶部大图和基础状态，不要塞入过多业务逻辑。

`CharacterGrid` 只负责选择藏品，不要实现升级、合成、分解。

---

### 7.2 UpgradePanel 展示规则

必须展示：

- 当前等级
- 升级后等级
- 当前战力
- 升级后战力
- 需要 FGEMS
- 当前 FGEMS 余额
- 是否余额足够
- 升级按钮

禁用条件：

- item.status !== `available`
- item.isUpgradeable === false
- 已达到 max level
- 没有升级规则
- FGEMS 不足
- mutation pending

成功后刷新：

- `queryKeys.inventory.root`
- `queryKeys.me.assetsRoot`
- 当前 inventory detail query

---

### 7.3 EvolutionPanel / EvolvePanel 展示规则

必须展示：

- 当前藏品
- 同款 available 数量
- 已选择材料数量：3 / 3
- 主藏品标识
- 失败返还说明
- 目标形态
- 目标图片
- KCOIN 消耗
- 成功率
- 确认合成按钮

禁用条件：

- 同款 available 数量 < 3
- item.status !== `available`
- item.isEvolvable === false
- 没有 evolution_rule
- 已经是最高形态
- KCOIN 不足
- mutation pending

成功或失败后刷新：

- `queryKeys.inventory.root`
- `queryKeys.me.assetsRoot`
- `queryKeys.album.root`，如果已新增

前端可以自动选择 3 个材料，但最终以后端返回为准。

---

### 7.4 DecomposePanel 展示规则

必须展示：

- 当前藏品
- 同款数量
- 可分解数量
- 预计获得 FGEMS
- “分解后不可恢复”提示
- 二次确认按钮

禁用条件：

- 同 template + same form 的 available 数量 < 2
- item.status !== `available`
- item.isDecomposable === false
- 没有 decompose_rule
- mutation pending

成功后刷新：

- `queryKeys.inventory.root`
- `queryKeys.me.assetsRoot`

不要刷新成“图鉴未点亮”。图鉴不应因分解减少。

---

### 7.5 Album 页面规则

当前目录已经存在，但文件是空占位。开发图鉴时应优先补实现或先按用户选择统一命名，不要重复创建同义文件：

```txt
apps/web/src/features/album/
├── pages/AlbumPage.tsx
├── components/
│   ├── AlbumProgress.tsx 或 AlbumProgressPanel.tsx
│   ├── AlbumSeriesTabs.tsx 或 AlbumBookTabs.tsx
│   ├── AlbumGrid.tsx 或 AlbumItemGrid.tsx
│   ├── AlbumItemCard.tsx
│   ├── MilestoneRewardRow.tsx 或 AlbumMilestoneReward.tsx
│   ├── LeaderboardPanel.tsx
│   ├── LeaderboardRow.tsx
│   ├── WalletSyncPanel.tsx
│   └── AlbumEmptyState.tsx（当前尚不存在）
├── hooks/
│   ├── useAlbumProgress.ts
│   ├── useAlbumSeries.ts 或 useAlbumBooks.ts
│   ├── useClaimAlbumReward.ts
│   ├── useLeaderboard.ts 或 useAlbumLeaderboard.ts
│   └── useWalletNftSync.ts
├── album.api.ts
└── album.types.ts
```

如果选择改名，必须先给用户选择并清理旧占位；不要让 `AlbumGrid` 和 `AlbumItemGrid`、`AlbumProgress` 和 `AlbumProgressPanel` 等同义文件并存。

图鉴页面必须显示：

- 总收集数量
- 总数量
- 完成百分比
- 系列图鉴进度
- 稀有度图鉴进度
- 图鉴物品网格
- 图鉴里程碑奖励
- 排行榜面板

图鉴物品展示规则：

- `is_collected = true`：显示彩色卡片
- `is_collected = false`：显示锁定或灰色卡片
- 是否显示未收集藏品名称，由后端字段或产品决策控制，不要前端擅自猜

---

### 7.6 前端 API normalizer 规则

所有前端 API 文件必须做输入容错，但不能吞掉业务错误。

允许：

- snake_case 转 camelCase
- 缺失可选字段时给 null
- 数字字符串转 number
- 空数组兜底

禁止：

- API 返回失败时伪造成功数据
- 后端未返回 can_upgrade 时前端自己判断为 true
- 后端未返回 reward 时前端自己编奖励
- 后端未返回 leaderboard 时前端填充假榜单

---

## 8. 缓存刷新规则

当前 `queryKeys` 尚未包含 `album`，也尚未包含 `inventory.detail` / `inventory.activity`。实现第三阶段 hook 前必须先补 query key，再写 invalidate。

升级成功：

- invalidate `inventory.root`
- invalidate 当前 `inventory.detail`
- invalidate `me.assetsRoot`

合成成功：

- invalidate `inventory.root`
- invalidate `me.assetsRoot`
- invalidate `album.root`
- invalidate `album.leaderboard`

合成失败：

- invalidate `inventory.root`
- invalidate `me.assetsRoot`

分解成功：

- invalidate `inventory.root`
- invalidate `me.assetsRoot`

图鉴奖励领取成功：

- invalidate `album.root`
- invalidate `me.assetsRoot`

排行榜刷新成功：

- invalidate `album.leaderboard`

不要只改本地 React state 当作真实结果。可以做临时 loading，但成功状态必须以后端返回和 query refresh 为准。

---

## 9. 幂等规则

所有用户写操作必须有幂等键：

- 升级
- 合成
- 分解
- 图鉴奖励领取

幂等键来源：

1. 优先请求头 `x-idempotency-key`
2. 兼容请求头 `idempotency-key`
3. 兼容 body 中 `idempotency_key`
4. 如果都没有，API 应返回错误，而不是自动执行危险写操作

不要用 `Date.now()` 作为服务端幂等键。前端可以生成 UUID 或稳定请求键，但真实去重必须由数据库或 RPC 保证。

当前远程 RPC 状态：

- `inventory_upgrade_item`、`inventory_evolve_item`、`inventory_decompose_item` 已有 `p_idempotency_key` 参数。
- `album_claim_milestone` 当前没有 `p_idempotency_key` 参数，只依赖 `album.milestone_claims` 的唯一领取记录避免重复发奖。

因此图鉴奖励领取在补 SQL 前不能标记为“完全满足显式幂等键规则”。

---

## 10. 数据规则 seed 建议

第三阶段必须先补规则数据，再做 UI 联调。

远程 Supabase 当前这些规则/配置表仍为空：`inventory.upgrade_rules`、`inventory.evolution_rules`、`inventory.decompose_rules`、`album.books`、`album.book_items`、`album.milestones`、`album.score_rules`、`album.weekly_leaderboards`、`album.leaderboard_entries`。

SQL 只能先写本地 migration / seed 文件；不要直接推送应用至远程 Supabase，必须先让用户审核。

最低可用规则：

### 升级

为所有 active rarity + form_index 配置 Lv.1 → Lv.2，最好支持到 Lv.10。

字段：

- `rarity_code`
- `form_index`
- `from_level`
- `to_level`
- `cost_fgems`
- `power_gain`
- `active = true`

### 合成

从 `catalog.collectible_forms.next_form_id` 生成：

- `from_template_id`
- `from_form_id`
- `to_template_id`
- `to_form_id`
- `required_count = 3`
- `cost_kcoin`
- `success_rate_bps`
- `active = true`

### 分解

为所有 rarity + form_index 配置：

- `rarity_code`
- `form_index`
- `min_level = 1`
- `reward_fgems`
- `active = true`

### 图鉴

创建：

- 总图鉴：`book_type = all`
- 系列图鉴：`book_type = series`
- 稀有度图鉴：`book_type = rarity`

为每个 book 插入 `album.book_items`。

### 图鉴奖励

为每个 book 创建合理 milestone，确保：

- `required_count <= book_items count`
- `reward` 非空
- 同一 book 下 `required_count` 不重复

### 排行榜

创建：

- `album.score_rules`
- 当前周 `album.weekly_leaderboards`

不要用前端硬编码这些规则。

---

## 11. 测试规则

第三阶段交付前必须通过：

```txt
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
```

如果项目当前测试环境不足，至少必须完成手动验收，并补充 TODO 测试项。

当前仓库存在第三阶段空占位文件。只要这些文件仍为空、路由/API/queryKeys/RPC 查询能力未补齐，就不能标记第三阶段完成。

---

### 11.1 数据库测试必须覆盖

升级：

- available item + 足够 FGEMS → 成功
- FGEMS 不足 → 失败
- listed item → 失败
- locked item → 失败
- max level → 失败
- 重复幂等键 → 不重复扣费

合成：

- 3 个相同 available item → 可以合成
- 少于 3 个 → 失败
- 重复 id → 失败
- 不同 template → 失败
- 不同 form → 失败
- listed item → 失败
- KCOIN 不足 → 失败
- 成功创建新 item
- 失败返还主藏品

分解：

- 重复 available item → 成功
- 只有一件 → 失败
- listed item → 失败
- locked item → 失败
- 不可分解 template → 失败

图鉴：

- 获得藏品后 user_discoveries 增加
- 出售后图鉴不减少
- 分解后图鉴不减少
- milestone 未达成不能领取
- milestone 达成后可领取
- 重复领取不重复发奖

排行榜：

- 刷新后 entries 生成
- rank 不重复
- score 高的 rank 更靠前
- 同一用户同一榜单只有一条 entry

---

## 12. AI 修改代码时的最小变更原则

优先小步提交：

1. 只补 endpoint 常量，不顺手改 UI。
2. 只补 API 文件，不顺手改数据库规则。
3. 只补一个 Panel，不顺手重构整个 Collection。
4. 只补 `/album` 路由，不顺手改其他路由。
5. 只改相关 tests，不重写测试框架。
6. 如果目标文件已经是 0 行占位文件，优先补实现；如果要改名或删除占位，先给用户选择。
7. 如果涉及 SQL，只提交本地 migration / seed，等用户审核后再决定是否推远程。

每次修改后运行对应最小检查：

- 改 TypeScript 类型：运行 typecheck
- 改 API：运行相关 API/unit test
- 改 SQL migration：运行 db reset 或 db test
- 改 UI：运行 web build 或 component test

---

## 13. 文件命名和职责约定

### API

```txt
api/inventory/detail.ts       # 单个藏品详情 + 成长预览
api/inventory/upgrade.ts      # 升级写操作
api/inventory/evolve.ts       # 合成写操作
api/inventory/decompose.ts    # 分解写操作
api/inventory/activity.ts     # 库存事件记录

api/album/progress.ts         # 图鉴进度
api/album/series.ts           # 图鉴册列表
api/album/items.ts 或 api/album/discoveries.ts # 图鉴物品 / 发现记录；实现前必须统一命名
api/album/claim-reward.ts     # 领取里程碑
api/album/leaderboard.ts      # 查询排行榜

api/cron/refresh-leaderboard.ts # 刷新排行榜，必须受 cron secret 保护
```

### 前端 collection

```txt
CharacterDetailSheet.tsx      # 完整藏品信息和操作入口
GrowthActionBar.tsx           # 升级、合成、分解、出售入口
UpgradePanel.tsx              # 升级确认和结果
EvolutionPanel.tsx 或 EvolvePanel.tsx # 3 材料选择、成功率、目标形态
DecomposePanel.tsx            # 分解确认和奖励
GrowthResultModal.tsx         # 成长结果展示
ItemStatusBadge.tsx           # available/listed/locked/minting 状态
```

### 前端 album

```txt
AlbumPage.tsx
AlbumProgressPanel.tsx 或 AlbumProgress.tsx
AlbumBookTabs.tsx 或 AlbumSeriesTabs.tsx
AlbumItemGrid.tsx 或 AlbumGrid.tsx
AlbumItemCard.tsx
AlbumMilestoneList.tsx
AlbumMilestoneReward.tsx 或 MilestoneRewardRow.tsx
LeaderboardPanel.tsx
AlbumEmptyState.tsx
```

---

## 14. 最终验收定义

第三阶段完成必须能跑通：

1. 用户进入藏品页。
2. 选择藏品。
3. 查看详情。
4. 消耗 FGEMS 升级成功。
5. 消耗 3 个重复藏品 + KCOIN 合成。
6. 合成成功时获得新形态。
7. 合成失败时返还主藏品。
8. 分解重复藏品获得 FGEMS。
9. 进入图鉴页。
10. 查看总收集进度。
11. 查看系列 / 稀有度图鉴。
12. 达成里程碑后领取奖励。
13. 领取后资产刷新。
14. 查看每周图鉴排行榜。
15. 出售或分解藏品后，图鉴点亮状态不丢失。
16. 所有资产变化都有 ledger。
17. 所有库存变化都有 item_instance_events。
18. 所有写操作都能防重复提交。

未满足以上任一项，不要标记第三阶段完成。

额外完成条件：

- `api/inventory/*`、`api/album/*`、`api/cron/refresh-leaderboard.ts` 不能再是空占位文件。
- `/album` 必须真实接入 router、routes 常量和底部导航。
- `API_ENDPOINTS`、`queryKeys`、hooks、normalizer 必须和真实 API/RPC 返回结构一致。
- 远程 Supabase 规则数据和 RPC 必须经过用户审核后应用，并用真实查询验证。
- 图鉴奖励领取的幂等策略必须和最终 RPC 签名一致。
