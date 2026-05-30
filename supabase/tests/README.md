# Supabase pgTAP tests for tmaGame

这些文件应放在：

```txt
supabase/tests/
```

当前 pgTAP 测试入口文件按文件名排序如下：

```txt
advisor_performance.test.sql
album_backfill.test.sql
album_reward.test.sql
auth.test.sql
gacha_order.test.sql
gacha_payment_idempotency.test.sql
gacha_pity.test.sql
inventory.test.sql
inventory_evolve.test.sql
inventory_growth_rpc_queries.test.sql
inventory_lock.test.sql
ledger_integrity.test.sql
market_buy.test.sql
market_buy_listing.test.sql
market_cancel.test.sql
market_create_listing.test.sql
market_db_hardening.test.sql
market_rpc_stage5.test.sql
market_update_price.test.sql
mint_queue.test.sql
phase4_rls_verification.test.sql
phase4_rpc_only_operations.test.sql
phase4_rpc_permissions.test.sql
phase4_sensitive_response_fields.test.sql
phase4_table_access.test.sql
phase4_task_center_referral_rpcs.test.sql
phase4_task_fields.test.sql
phase4_task_progress_sources_existing.test.sql
phase5_payment_wallet_onchain_schema.test.sql
phase5_secrets_feature_flags.test.sql
phase6_admin_user_role_rpcs.test.sql
referral.test.sql
stage3_database_acceptance.test.sql
stage3_e2e_album_reward.test.sql
stage3_e2e_decompose.test.sql
stage3_e2e_evolve_failure.test.sql
stage3_e2e_evolve_success.test.sql
stage3_e2e_upgrade.test.sql
stage4_signin_seed.test.sql
stage4_task_reward_constraints.test.sql
task_claim.test.sql
tasks_claim.test.sql
tasks_commission.test.sql
tasks_ledger.test.sql
tasks_referral.test.sql
tasks_rls.test.sql
tasks_signin.test.sql
tasks_signin_streak.test.sql
tasks_signin_transaction.test.sql
```

运行前请先执行：

```bash
supabase db reset
```

或确保以下内容已经应用到测试库：

1. `supabase/migrations/20260521065609_0001_create_users.sql` 至 `20260521071217_0019_create_constraints.sql`
2. `supabase/rpc/*.sql`
3. `supabase/rls/*.sql`

只运行 pgTAP：

```bash
pnpm test:db:pgtap
```

完整数据库 gate 会先运行全部 pgTAP，再运行签到并发脚本：

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
