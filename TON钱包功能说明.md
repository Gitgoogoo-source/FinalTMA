# TON 钱包功能说明

## 1. 这份文档说明什么

这份文档只根据当前项目代码整理 TON 钱包相关功能。

它主要说明几件事：

- 用户在页面上能做什么。
- 前端会展示哪些钱包状态。
- 后端会怎样确认钱包确实属于当前用户。
- NFT 同步和 Mint 队列是怎么工作的。
- 当前代码里已经实现了什么，哪些地方还不能说已经完成。

本文不写接口参数，不写请求内容，不写没有在代码里确认到的结论。

## 2. 功能总览

当前项目里的 TON 钱包功能，主要包括下面这些部分：

- 顶部钱包入口。
- TON Connect 钱包连接。
- 钱包归属验证。
- 钱包状态展示。
- 复制钱包地址。
- 断开钱包。
- 同步钱包里的 NFT。
- 查看 Mint 队列。
- 从藏品详情里提交 Mint。
- 后台处理 Mint 队列。
- 后台同步链上交易结果。
- 钱包和链上数据的权限保护。

这些功能不是单独存在的，它们和登录用户、藏品库存、链上 NFT、后台定时任务一起工作。

## 3. 用户在页面上能看到什么

用户登录后，页面顶部有钱包入口。

如果 TON Connect 功能没有打开，钱包按钮会显示暂未开放，用户不能连接钱包。

如果功能已经打开，用户可以点击钱包按钮连接 TON 钱包。连接后，页面会根据钱包状态显示不同内容。

页面里能看到的钱包状态包括：

- 还没有连接钱包。
- 正在连接钱包。
- 钱包已经连接，但还没有通过验证。
- 钱包已经验证。
- 钱包验证失败。
- 钱包验证已经过期。
- 钱包已经断开。

钱包验证通过后，用户可以在钱包状态弹窗里看到：

- 钱包地址。
- 钱包网络。
- 钱包应用名称。
- 验证时间。
- 最近一次同步时间。
- NFT 同步结果。
- Mint 队列入口。

钱包地址可以复制。

## 4. 钱包连接是怎么走的

用户点击连接钱包后，前端会先向后端要一个验证用的内容。

然后前端打开 TON Connect 钱包弹窗，让用户在自己的钱包应用里确认连接。

用户确认后，前端拿到钱包公开信息，并把这些信息交给后端保存。

如果钱包同时返回了验证签名，前端会把验证结果交给后端校验。

后端校验通过后，这个钱包才会变成已验证状态。

这里有一个重点：前端只负责发起连接和展示状态，最终是否算验证通过，由后端决定。

## 5. 钱包验证做了什么

钱包验证的目标是确认一件事：这个 TON 地址确实是当前用户正在控制的钱包地址。

后端会生成一次性的验证内容，并记录下来。

用户在钱包里确认后，后端会检查：

- 这次验证内容是不是后端生成的。
- 这次验证有没有过期。
- 这次验证有没有被重复使用。
- 钱包签名是不是正确。
- 钱包地址和签名里的地址是不是一致。
- 钱包网络是不是项目服务端要求的网络。
- 钱包域名是不是符合项目配置。

校验通过后，后端会把这个钱包保存为当前用户已验证的钱包。

如果校验失败，钱包不会变成已验证状态。代码里也有记录风险事件的逻辑，用来处理重复验证、伪造验证这类情况。

## 6. 钱包状态管理

后端会保存用户的钱包记录。

钱包记录里保存的是公开钱包信息，例如地址、网络、钱包应用信息、连接状态、验证时间、最近同步时间。

代码注释明确说明，钱包记录不会保存私钥。

前端每次打开钱包状态弹窗时，会读取后端的钱包状态，然后展示给用户。

如果钱包已经验证，用户可以继续同步 NFT 或查看 Mint 队列。

如果钱包没有验证，页面会提示用户先验证钱包。

如果钱包验证失败或过期，用户可以重新验证。

用户也可以主动断开钱包。断开后，后端会把钱包状态改成断开，并清掉当前主要钱包标记。

## 7. NFT 同步功能

钱包验证通过后，用户可以同步钱包里的 NFT。

同步时，后端会向 TON 链上服务查询这个钱包里持有的 NFT。

同步结果会分几类：

- 已同步的 NFT。
- 和游戏藏品匹配上的 NFT。
- 被忽略的 NFT。

代码里只会处理当前项目配置里的有效 NFT 集合。不是项目集合里的 NFT，不会当成游戏藏品来处理。

如果链上的 NFT 和项目数据库里的藏品能匹配上，后端会更新链上 NFT 记录和最后看到的时间。

如果发现链上 owner 和项目期望不一致，后端会记录风险事件。

前端会展示同步状态，比如等待同步、同步中、同步成功、同步失败。

如果同步失败，用户可以重试。

## 8. Mint 功能入口

Mint 入口在藏品详情里。

用户不能随便 Mint，页面和后端都会检查当前藏品是否符合条件。

从代码看，Mint 前会检查这些情况：

- 用户的钱包必须已经验证。
- 这个藏品必须属于当前用户。
- 这个藏品必须允许 Mint。
- 这个藏品不能正在上架。
- 这个藏品不能被其他业务锁定。
- 这个藏品当前状态必须允许 Mint。
- 这个藏品不能已经 Mint 成功。
- 这个藏品不能已经在 Mint 队列里处理中。
- 这个藏品不能处于人工处理中。

如果不符合条件，页面会给出不能 Mint 的提示。

如果符合条件，用户会看到 Mint 确认弹窗。

用户确认后，前端会请求后端把这个藏品加入 Mint 队列。

## 9. Mint 队列做了什么

Mint 不是前端直接完成的。

用户确认 Mint 后，后端会创建一条 Mint 队列记录。

创建队列时，后端会再次检查：

- 钱包是否属于当前用户。
- 钱包是否已经验证。
- 钱包网络是否匹配项目集合网络。
- 藏品是否属于当前用户。
- 藏品是否可用。
- 藏品是否还没有完成 Mint。
- 藏品是否没有被有效锁定。
- 藏品模板是否启用。
- 藏品模板是否允许 Mint。
- NFT 集合是否启用。

检查通过后，后端会锁定这个藏品，并把它放进 Mint 队列。

这样做的目的，是避免同一个藏品被重复 Mint，也避免前端自己指定不可信的 Mint 内容。

代码里也能看到，前端不能自己决定关键链上内容。这些内容由后端根据项目数据生成。

## 10. Mint 队列状态

Mint 队列里会出现多种状态。

用户在页面上可以看到队列总览，也可以看到单个 Mint 任务的状态。

当前代码里涉及的队列状态包括：

- 排队中。
- 处理中。
- 已提交链上。
- 等待确认。
- 重试中。
- 人工处理中。
- Mint 成功。
- Mint 失败。
- 已取消。

前端会把这些状态展示在 Mint 队列弹窗里。

队列弹窗还会展示统计信息，比如进行中、成功、需要处理、已同步 NFT。

## 11. 后台怎样处理 Mint

项目里有后台任务处理 Mint 队列。

后台任务会找出到期需要处理的 Mint 记录，然后尝试把它提交到链上服务。

提交成功后，后台会记录链上交易信息，并把 Mint 状态改成已经提交或等待确认。

如果链上服务返回的结果已经确认成功，后台会把 Mint 标记为成功。

如果提交失败，后台不会简单丢掉任务。代码里有重试和人工处理状态。

如果错误还能重试，队列会进入重试中。

如果错误不适合自动重试，队列会进入人工处理中。

## 12. 链上交易同步

项目里还有一个后台任务，用来同步链上交易结果。

这个任务会检查还没有最终完成的 Mint 交易。

如果链上确认成功，后端会：

- 更新链上 NFT 记录。
- 把 Mint 队列改成成功。
- 把用户藏品改成已经 Mint。
- 消耗对应的业务锁。
- 写入业务事件记录。

如果链上确认失败，后端会：

- 把 Mint 队列改成失败，或者进入后续处理。
- 根据失败情况决定是否释放藏品。
- 写入业务事件记录。

也就是说，前端看到的 Mint 结果不是前端自己判断的，而是以后端和链上同步结果为准。

## 13. 权限和安全边界

当前代码里有几条明确的安全边界：

- 前端只能读取公开配置。
- 私钥、服务端密钥、机器人密钥、服务角色密钥不能出现在前端。
- 用户钱包只保存公开地址和连接信息，不保存私钥。
- 钱包验证内容只能使用一次。
- 钱包验证内容会过期。
- 后端会校验签名，而不是相信前端说的钱包地址。
- 用户只能读取自己的钱包记录、验证记录、Mint 队列、交易记录和 NFT 同步记录。
- 关键写入动作由后端服务执行，不交给前端直接写数据库。

这部分代码主要是为了防止伪造钱包、重复验证、重复 Mint、越权读取和越权写入。

## 14. 功能开关

TON 钱包相关能力不是永远默认打开。

代码里有功能开关。

如果 TON Connect 没打开，前端钱包入口会显示暂未开放。

如果 Mint 没打开，用户不能提交 Mint。

如果后台 Mint worker 没打开，后台不会处理 Mint 队列。

这意味着部署环境里需要正确打开对应能力，页面和后台任务才会真正工作。

## 15. 当前代码里不能确认已经完成的部分

下面这些点，当前代码里不能说已经完整完成：

- 合约源码文件当前是空文件，不能说明项目里已经完成了 NFT Collection 合约实现。
- 项目里没有确认到可直接说明生产 Collection 地址已经配置完成的证据。
- 钱包交易接口文件是空文件，不能说明已经有独立的钱包交易列表功能。
- 有几个钱包相关的前端组件文件是空文件，实际生效的钱包入口和弹窗来自其他组件。

所以，这份文档只把已经能从代码确认的功能写出来，不把空文件当成已实现功能。

## 16. 主要代码依据

这份文档主要根据下面这些代码整理：

- `apps/web/src/app/providers/TonConnectProvider.tsx`
- `apps/web/src/env.ts`
- `apps/web/src/features/assets/components/WalletEntryButton.tsx`
- `apps/web/src/features/wallet/hooks/useWalletConnect.ts`
- `apps/web/src/features/wallet/components/WalletStatusSheet.tsx`
- `apps/web/src/features/wallet/components/WalletSyncPanel.tsx`
- `apps/web/src/features/wallet/components/MintQueueSheet.tsx`
- `apps/web/src/features/wallet/wallet.api.ts`
- `apps/web/src/features/wallet/wallet.types.ts`
- `apps/web/src/features/collection/components/CharacterDetailPanel.tsx`
- `apps/web/src/features/collection/components/MintConfirmPanel.tsx`
- `apps/web/src/features/collection/pages/CollectionPage.tsx`
- `api/wallet/status.ts`
- `api/wallet/connect.ts`
- `api/wallet/challenge.ts`
- `api/wallet/proof.ts`
- `api/wallet/disconnect.ts`
- `api/wallet/sync-nfts.ts`
- `api/wallet/nfts.ts`
- `api/wallet/mint.ts`
- `api/wallet/mint-status.ts`
- `api/cron/retry-mint-queue.ts`
- `api/cron/sync-onchain-transactions.ts`
- `packages/server/src/ton/tonConnect.ts`
- `packages/server/src/ton/walletPublicKey.ts`
- `packages/server/src/ton/nft.ts`
- `packages/server/src/ton/mintGuards.ts`
- `supabase/migrations/20260521065609_0001_create_users.sql`
- `supabase/migrations/20260521070128_0010_create_onchain_nft.sql`
- `supabase/migrations/20260527154355_20260527151838_phase5_payment_wallet_onchain_schema.sql`
- `supabase/migrations/20260528164441_phase5_wallet_security_idempotency.sql`
- `supabase/migrations/20260528182101_phase5_mint_enqueue_transaction_guards.sql`
- `supabase/migrations/20260530080146_phase5_wallet_onchain_rpc_facade.sql`
- `supabase/rpc/27_wallet_enqueue_mint.sql`
- `supabase/rpc/28_onchain_mark_mint_success.sql`
- `supabase/rpc/29_onchain_mark_mint_failed.sql`
- `supabase/rls/010_core.policies.sql`
- `supabase/rls/100_onchain.policies.sql`
- `docs/ton-wallet-nft.md`
