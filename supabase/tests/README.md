# Supabase pgTAP tests for tmaGame

这些文件应放在：

```txt
supabase/tests/
```

建议执行顺序：

```txt
auth.test.sql
advisor_performance.test.sql
ledger_integrity.test.sql
gacha_order.test.sql
gacha_pity.test.sql
gacha_payment_idempotency.test.sql
inventory_lock.test.sql
inventory_evolve.test.sql
market_buy.test.sql
market_cancel.test.sql
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
supabase test db
```

或者逐个文件运行：

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/auth.test.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/advisor_performance.test.sql
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

因此测试 fixture 不会永久写入数据库。
