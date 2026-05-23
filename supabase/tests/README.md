# Supabase pgTAP tests for tmaGame

这些文件应放在：

```txt
supabase/tests/
```

建议执行顺序：

```txt
auth.test.sql
advisor_performance.test.sql
market_db_hardening.test.sql
ledger_integrity.test.sql
gacha_order.test.sql
gacha_pity.test.sql
gacha_payment_idempotency.test.sql
inventory.test.sql
inventory_lock.test.sql
inventory_evolve.test.sql
market_create_listing.test.sql
market_buy_listing.test.sql
market_buy.test.sql
market_cancel.test.sql
market_rpc_stage5.test.sql
task_claim.test.sql
referral.test.sql
album_reward.test.sql
mint_queue.test.sql
```

运行前请先执行：

```bash
supabase db reset
```

或确保以下内容已经应用到测试库：

1. `supabase/migrations/0001_create_users.sql` 至 `0019_create_constraints.sql`
2. `supabase/rpc/*.sql`
3. `supabase/rls/*.sql`

推荐运行方式：

```bash
pnpm test:db
```

或者直接调用 Supabase CLI：

```bash
supabase test db --local supabase/tests/*.test.sql
```

如需逐个文件排查，可以单独执行某个 `*.test.sql`：

```bash
supabase test db --local supabase/tests/auth.test.sql
```

每个测试文件都使用：

```sql
begin;
...
rollback;
```

因此测试 fixture 不会永久写入数据库。
