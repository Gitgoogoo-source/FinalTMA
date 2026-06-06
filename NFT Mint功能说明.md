# NFT Mint 功能说明

这份说明只根据当前项目代码整理。没有在代码里确认到的内容，我会明确写成“当前不能确认”。

## 一、这个功能是做什么的

NFT Mint 的作用是：用户把自己在游戏里拥有的藏品，提交给后端，由后端排队处理，最后把这个藏品铸造成 TON 链上的 NFT。

这里要注意一点：前端不是直接上链。前端只负责让用户点按钮、确认操作、查看队列状态。真正能不能 Mint、要 Mint 到哪个钱包、用哪个 Collection、NFT 的 metadata 和图片是什么，都由后端和数据库决定。

## 二、用户能看到的功能

当前代码里，用户能看到这些 Mint 相关入口：

- 顶部资产栏有钱包入口。
- 钱包入口可以打开钱包状态面板。
- 钱包面板里可以连接 TON 钱包、验证钱包、同步 NFT、查看 Mint 队列。
- 藏品详情页有 Mint NFT 按钮。
- 点 Mint 后，会先打开确认面板。
- 提交成功后，会提示“Mint 已入队”，并打开 Mint 队列。
- Mint 队列里会展示进行中、成功、需要处理、已同步 NFT 等信息。
- 队列里还有已同步的钱包 NFT 列表。

如果钱包功能前端开关关闭，顶部钱包入口会显示暂未开放。

## 三、什么情况下可以 Mint

代码里前端和后端都会检查 Mint 条件。前端先做体验层面的拦截，后端再做最终判断。

可以 Mint 的大前提是：

- 用户已经登录。
- 用户已经连接 TON 钱包。
- 钱包 proof 已经通过后端验证。
- 藏品属于当前用户。
- 藏品当前是可用状态。
- 藏品没有挂售。
- 藏品没有被升级、进化、分解、交易、Mint 或其他操作锁定。
- 藏品模板是启用状态。
- 这个藏品模板允许 Mint。
- 藏品还没有 Mint 成功。
- 藏品没有正在处理中的 Mint 请求。
- 后端已经配置可用的 NFT Collection。
- NFT Collection 和用户钱包在同一个 TON 网络。
- NFT Collection 处于可 Mint 状态。
- 后端能拿到这个藏品对应的 metadata 和图片。

如果藏品之前 Mint 失败，前端按钮会显示重试 Mint。是否真的能重新入队，还是以后端再次检查为准。

## 四、用户操作流程

用户正常操作大概是这样：

1. 用户打开应用并登录。
2. 用户点击顶部钱包入口。
3. 用户通过 TON Connect 连接钱包。
4. 前端向后端申请 proof 验证用的内容。
5. 钱包返回签名证明。
6. 后端验证 proof。
7. 验证通过后，钱包状态变成已验证。
8. 用户进入藏品页，选择一个可 Mint 的藏品。
9. 用户点击 Mint NFT。
10. 前端重新读取藏品详情和钱包状态，防止页面旧数据误判。
11. 如果没有拦截原因，前端打开 Mint 确认面板。
12. 用户确认后，前端提交 Mint 请求。
13. 后端检查通过后，把藏品加入 Mint 队列。
14. 藏品被锁定，状态变成 Mint 中。
15. 前端打开 Mint 队列，用户可以看处理进度。
16. 后台任务处理队列，把请求交给 TON NFT 服务。
17. 链上交易确认后，后端把藏品标记为已 Mint。
18. 用户刷新队列或钱包 NFT 同步后，可以看到结果。

## 五、前端怎么拦截不能 Mint 的情况

藏品详情页会根据当前状态决定按钮能不能点。

前端会拦截这些情况：

- 没有连接钱包。
- 钱包连接了但还没验证。
- 钱包 proof 失败。
- 钱包 proof 过期。
- 藏品不可 Mint。
- 藏品正在挂售。
- 藏品被其他操作锁定。
- 藏品不是可用状态。
- 藏品已经 Mint 成功。
- 藏品已经在 Mint 队列里。
- 藏品正在链上提交或等待确认。
- 藏品处于人工处理状态。

这些拦截只是前端提示。真正能不能 Mint，还是以后端检查结果为准。

## 六、后端提交 Mint 时做了什么

后端收到 Mint 请求后，不会直接信任前端。

后端会做这些事：

- 确认用户登录状态。
- 确认 Mint 功能开关是开启的。
- 做风险检查。
- 做重复提交保护，避免同一次操作重复入队。
- 查找当前用户已验证的钱包。
- 检查钱包网络和本次 Mint 网络是否一致。
- 查找可用的 NFT Collection。
- 检查 Collection 是否启用。
- 检查 Collection 是否配置了 metadata 地址。
- 查找用户要 Mint 的藏品。
- 检查藏品是否属于当前用户。
- 检查藏品是否可用。
- 检查藏品是否已经 Mint 或已经在队列里。
- 检查藏品是否有正在生效的锁。
- 检查藏品模板是否启用，是否允许 Mint。
- 从数据库里的藏品、形态、媒体信息生成后端自己的 metadata 快照。
- 把 Mint 请求写入队列。
- 锁定这个藏品。
- 把藏品状态改成 Mint 中。
- 写入藏品事件记录。

这里的重点是：NFT 的 Collection、metadata、图片、队列顺序不是前端给的。后端会拒绝前端试图自己指定这些内容。

## 七、Mint 队列会怎么变化

队列状态可以理解成下面这些阶段：

- 未 Mint：藏品还没有开始 Mint。
- 排队中：后端已经接收请求，等待后台任务处理。
- 处理中：后台任务已经领取这个队列任务。
- 已提交链上：后台已经把 Mint 请求交给链上服务。
- 等待链上确认：链上交易还没最终确认。
- 正在重试：处理失败但还允许再试。
- Mint 成功：链上结果已确认，藏品已经绑定 NFT 记录。
- Mint 失败：处理失败，后端可以把藏品释放回可用状态。
- 需要人工处理：自动重试处理不了，需要运营排查。
- 已取消：这个队列已经取消。

前端会自动刷新 Mint 队列。只要队列里还有排队中、处理中、已提交链上、等待确认或正在重试的记录，就会继续刷新。

## 八、后台任务怎么处理队列

后台 Mint 任务会扫描到期的队列记录。它只处理排队中和正在重试的记录。

后台任务做的事情是：

- 找到可以处理的队列记录。
- 把这条记录标记为处理中，避免被另一个任务重复处理。
- 读取对应的 Collection、钱包和 metadata 快照。
- 调用 TON NFT 服务提交 Mint。
- 保存链上交易记录。
- 如果服务直接返回已 Mint，就标记成功。
- 如果交易已经提交但还没确认，就把队列改成已提交链上或等待链上确认。
- 如果失败但可以重试，就安排下一次重试。
- 如果不能继续重试，或者结果不安全，就转到人工处理。

如果提交过程中超时，代码不会盲目重复提交。它会记录一个可恢复状态，后续先查询这次可能已经提交的交易，再决定下一步。

## 九、链上确认怎么同步

项目里有链上交易同步任务。

它会查找等待确认的 Mint 交易，然后向 TON NFT 服务查询交易结果：

- 如果还是等待中，就保持等待确认。
- 如果确认成功，就写入 NFT 记录，并把藏品改成已 Mint。
- 如果失败或过期，就按重试策略处理，不能自动处理时转人工处理。

Mint 成功时，数据库会做这些变化：

- 写入或更新链上 NFT 记录。
- 把 Mint 队列标记为成功。
- 保存链上交易哈希。
- 把游戏藏品改成已 Mint。
- 释放并消耗这个藏品的 Mint 锁。
- 写入藏品事件记录。

Mint 失败时，数据库可以做这些变化：

- 把队列标记为失败。
- 记录失败原因。
- 按需要写入失败交易记录。
- 可以把藏品释放回可用状态。
- 把藏品的 Mint 状态标记为失败。
- 写入藏品事件记录。

## 十、钱包 NFT 同步

钱包 NFT 同步和 Mint 是相关功能，但不是同一件事。

同步功能会做这些事：

- 用户必须先完成钱包验证。
- 后端向 TON NFT 服务查询这个钱包持有的 NFT。
- 后端只保留当前游戏已配置 Collection 下的 NFT。
- 同步结果会保存成钱包 NFT 快照。
- 如果链上 NFT 地址能对应到系统已知 NFT 记录，会进行关联。
- 如果发现链上 owner 和系统记录不一致，会写风险事件，方便后续排查。
- 钱包状态里会记录上次同步时间。

前端钱包面板里展示的是服务端保存的同步结果，不是前端自己判断链上归属。

## 十一、功能开关和安全边界

代码里有多层开关：

- 前端钱包入口开关。
- 钱包同步开关。
- 用户 Mint 请求开关。
- 后台 Mint 任务开关。
- 服务端 Mint 总开关。

这些开关没有全部打开时，用户可能看不到入口，或者提交 Mint 时被后端拒绝。

安全边界也很明确：

- 前端只能看到公开配置。
- 前端不能保存 TON 私钥。
- 前端不能保存服务端密钥。
- 前端不能决定 NFT Collection。
- 前端不能决定 NFT metadata。
- 前端不能决定链上交易结果。
- 前端不能自己把藏品改成已 Mint。
- 钱包 proof 必须由后端验证。
- 链上状态必须由后端查询和落库。
- Mint 相关密钥只能在服务端环境里。

## 十二、当前代码里已经能确认的支撑能力

当前代码里能确认有这些支撑能力：

- TON Connect 前端接入。
- 钱包连接状态保存。
- 钱包 proof 验证。
- 钱包断开。
- 钱包 NFT 同步。
- Mint 提交入口。
- Mint 入队。
- 藏品锁定。
- metadata 快照生成。
- Mint 队列查询。
- Mint 队列自动刷新。
- 后台 Mint 队列处理。
- 链上交易记录。
- 链上交易确认同步。
- Mint 成功落库。
- Mint 失败处理。
- 自动重试。
- 人工处理状态。
- 风险事件记录。
- 监控里有 Mint 卡住数量和 Mint 队列成功率相关逻辑。

## 十三、当前限制和不能确认的部分

当前代码里也有几个限制需要明确：

- `contracts/src` 下的 Tact 合约源码文件当前是空文件，所以不能说仓库里已经实现了 TON NFT Collection 合约。
- `contracts/README.md` 明确写着真实 Collection 地址还没有在仓库里配置。
- 代码支持通过外部 TON NFT 服务提交 Mint 和查询交易，但当前仓库不能确认生产环境服务已经配置完成。
- `.env.example` 里 Mint 相关开关默认不是全部开启，所以不能默认认为本地环境可以直接 Mint 成功。
- 当前文档只根据代码静态整理，没有实际跑通一次链上 Mint。

## 十四、主要代码依据

这份说明主要看了这些文件：

- `apps/web/src/features/collection/pages/CollectionPage.tsx`
- `apps/web/src/features/collection/components/CharacterDetailPanel.tsx`
- `apps/web/src/features/collection/components/MintConfirmPanel.tsx`
- `apps/web/src/features/wallet/wallet.api.ts`
- `apps/web/src/features/wallet/components/MintQueueSheet.tsx`
- `apps/web/src/features/assets/components/WalletEntryButton.tsx`
- `api/wallet/mint.ts`
- `api/wallet/mint-status.ts`
- `api/wallet/sync-nfts.ts`
- `api/wallet/nfts.ts`
- `api/wallet/proof.ts`
- `api/cron/retry-mint-queue.ts`
- `api/cron/sync-onchain-transactions.ts`
- `packages/server/src/ton/mintGuards.ts`
- `packages/server/src/ton/walletSyncGuards.ts`
- `packages/server/src/ton/mintQueue.ts`
- `packages/server/src/ton/nft.ts`
- `supabase/rpc/27_wallet_enqueue_mint.sql`
- `supabase/rpc/28_onchain_mark_mint_success.sql`
- `supabase/rpc/29_onchain_mark_mint_failed.sql`
- `supabase/migrations/20260521070128_0010_create_onchain_nft.sql`
- `supabase/migrations/20260530080146_phase5_wallet_onchain_rpc_facade.sql`
- `contracts/README.md`
