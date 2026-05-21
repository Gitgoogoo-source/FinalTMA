已继续生成 `supabase/tests` 目录下完整 pgTAP SQL 测试文件，并打包为 zip。

下载： [tmaGame_supabase_tests.zip](sandbox:/mnt/data/tmaGame_supabase_tests.zip)

压缩包内包含：

```txt
tmaGame/
└── supabase/
    └── tests/
        ├── README.md
        ├── run_all.sql
        ├── auth.test.sql
        ├── ledger_integrity.test.sql
        ├── gacha_order.test.sql
        ├── gacha_pity.test.sql
        ├── gacha_payment_idempotency.test.sql
        ├── inventory_lock.test.sql
        ├── inventory_evolve.test.sql
        ├── market_buy.test.sql
        ├── market_cancel.test.sql
        ├── task_claim.test.sql
        ├── referral.test.sql
        ├── album_reward.test.sql
        └── mint_queue.test.sql
```

这些测试覆盖：

```txt
1. auth.test.sql
   - Telegram 用户创建 / 更新
   - 用户 profile 创建
   - KCOIN / FGEMS 初始余额行
   - 邀请关系写入
   - App session 创建
   - user_devices 写入
   - get_user_bootstrap 返回资产、功能开关、用户资料

2. ledger_integrity.test.sql
   - economy_credit
   - economy_debit
   - 幂等 credit
   - 余额不足扣款失败
   - balance lock
   - balance unlock
   - currency_ledger 禁止 update / delete

3. gacha_order.test.sql
   - 创建单抽订单
   - 创建 Stars order
   - draw_order 与 star_order 绑定
   - 开盒订单幂等
   - 10 连抽 9 折
   - 非法抽数拒绝
   - 暂停盲盒拒绝开盒

4. gacha_pity.test.sql
   - 保底规则 threshold=1
   - 支付成功后必出 EPIC
   - draw_results 写入
   - inventory.item_instances 写入
   - album.user_discoveries 写入
   - 返还 100 K-coin
   - 盲盒库存扣减
   - pity counter 重置

5. gacha_payment_idempotency.test.sql
   - successful_payment 重复回调幂等
   - 不重复生成 draw_results
   - 不重复生成 inventory item
   - 不重复返还 K-coin
   - gacha_get_draw_result 支持按 order id 和 invoice payload 查询

6. inventory_lock.test.sql
   - 挂售后 item 状态变为 listed
   - 创建 active inventory lock
   - 挂售藏品不能升级
   - 挂售藏品不能分解
   - 同一藏品不能重复挂售

7. inventory_evolve.test.sql
   - 3 份相同藏品合成成功
   - 成功后消耗 3 个原藏品
   - 成功后生成二阶形态
   - 扣除 K-coin
   - 合成失败时只返还等级最高主藏品
   - 失败时消耗其余材料
   - 失败仍扣除 K-coin
   - evolution_attempts 写入

8. market_buy.test.sql
   - 创建市场挂单
   - 买家购买
   - K-coin 扣款
   - 卖家到账
   - 5% 平台手续费
   - fee_settlements 写入
   - 藏品所有权转移
   - listing sold
   - 重复购买请求幂等

9. market_cancel.test.sql
   - 非卖家不能下架
   - 卖家下架成功
   - listing cancelled
   - listing_items cancelled
   - item 回到 available
   - inventory lock released
   - 重复下架失败

10. task_claim.test.sql
    - 任务完成后领取奖励
    - user_task_progress 变为 claimed
    - K-coin 奖励发放
    - 重复领取幂等
    - 未完成任务不能领取
    - 7 日签到 day 1 奖励
    - 当日重复签到不重复发奖

11. referral.test.sql
    - invite_code 创建邀请关系
    - 首次开盒奖励双方各 500 K-coin
    - referral_rewards 写入
    - 邀请人获得 10% 分红
    - 分红幂等
    - 无有效邀请关系不发分红

12. album_reward.test.sql
    - item_instance 插入后触发图鉴发现
    - 图鉴里程碑领取
    - FGEMS 奖励发放
    - 重复领取幂等
    - 未达到里程碑不能领取

13. mint_queue.test.sql
    - 保存 TON 钱包地址
    - 创建 Mint 队列
    - item 状态变为 minting
    - 创建 mint lock
    - 同一 item 不能重复进入 Mint 队列
    - Mint 成功后生成 nft_items
    - item 状态变为 minted
    - mint lock consumed
    - Mint 失败后 item 回到 available
    - mint lock released
    - 失败链上交易写入 onchain.transactions
```

建议运行：

```bash
supabase test db
```

或者逐个执行：

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/auth.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/ledger_integrity.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/gacha_order.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/gacha_pity.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/gacha_payment_idempotency.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/inventory_lock.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/inventory_evolve.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/market_buy.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/market_cancel.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/task_claim.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/referral.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/album_reward.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/mint_queue.test.sql
```

每个测试文件都使用：

```sql
begin;
...
rollback;
```

所以测试数据不会永久写入数据库。我没有连接你的 Supabase 实例执行测试，建议先在本地测试库运行。
