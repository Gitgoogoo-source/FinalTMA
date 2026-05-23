# Supabase 数据库测试说明

本目录只保留 `*.test.sql` 作为数据库测试入口。

`run_all.sql` 已删除，不再维护手动汇总入口。新增数据库测试时，请统一命名为：

```txt
xxx.test.sql
```

当前 `pnpm test:db` 会执行：

```bash
supabase test db --local supabase/tests/*.test.sql
```

这样可以避免 Supabase CLI 自动执行非测试入口文件，也避免旧的 `run_all.sql` 路径问题。

当前测试文件：

```txt
advisor_performance.test.sql
album_reward.test.sql
auth.test.sql
gacha_order.test.sql
gacha_payment_idempotency.test.sql
gacha_pity.test.sql
inventory.test.sql
inventory_evolve.test.sql
inventory_lock.test.sql
ledger_integrity.test.sql
market_buy.test.sql
market_cancel.test.sql
market_db_hardening.test.sql
market_rpc_stage5.test.sql
mint_queue.test.sql
referral.test.sql
task_claim.test.sql
```

运行前请确保本地 Supabase 已启动，并且本地 migration、RPC、RLS 已应用：

```bash
pnpm db:start
pnpm db:reset
```

运行全部数据库测试：

```bash
pnpm test:db
```

如果需要直接调用 Supabase CLI：

```bash
supabase test db --local supabase/tests/*.test.sql
```

每个测试文件都应使用：

```sql
begin;
...
rollback;
```

这样测试数据不会永久写入数据库。
