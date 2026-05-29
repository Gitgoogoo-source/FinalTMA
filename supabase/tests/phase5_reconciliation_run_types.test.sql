-- Phase 5 step 16 reconciliation run type checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(5);

select ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'economy'
      and c.relname = 'reconciliation_runs'
      and con.conname = 'reconciliation_runs_run_type_check'
      and pg_get_constraintdef(con.oid) like '%payment_fulfillment%'
      and pg_get_constraintdef(con.oid) like '%mint_queue%'
      and pg_get_constraintdef(con.oid) like '%wallet_sync%'
      and pg_get_constraintdef(con.oid) like '%ledger_balance%'
  ),
  'reconciliation_runs run_type check includes Phase 5 buckets and ledger_balance'
);

insert into economy.reconciliation_runs (run_type, status, result, created_by)
values
  ('payment_fulfillment', 'success', '{"ok":true}'::jsonb, 'phase5-test'),
  ('mint_queue', 'success', '{"ok":true}'::jsonb, 'phase5-test'),
  ('wallet_sync', 'success', '{"ok":true}'::jsonb, 'phase5-test'),
  ('ledger_balance', 'success', '{"ok":true}'::jsonb, 'phase5-test');

select is(
  (
    select count(*)::int
    from economy.reconciliation_runs
    where created_by = 'phase5-test'
      and run_type = 'payment_fulfillment'
  ),
  1,
  'payment_fulfillment reconciliation run type is accepted'
);

select is(
  (
    select count(*)::int
    from economy.reconciliation_runs
    where created_by = 'phase5-test'
      and run_type = 'mint_queue'
  ),
  1,
  'mint_queue reconciliation run type is accepted'
);

select is(
  (
    select count(*)::int
    from economy.reconciliation_runs
    where created_by = 'phase5-test'
      and run_type = 'wallet_sync'
  ),
  1,
  'wallet_sync reconciliation run type is accepted'
);

select is(
  (
    select count(*)::int
    from economy.reconciliation_runs
    where created_by = 'phase5-test'
      and run_type = 'ledger_balance'
  ),
  1,
  'existing ledger_balance reconciliation run type remains accepted'
);

rollback;
