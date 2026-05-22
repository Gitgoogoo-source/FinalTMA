-- Verifies Phase 2 marketplace database hardening from the stage-3 guide.
-- Run after migrations and RLS files have been applied.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.has_leftmost_index(
  p_schema text,
  p_table text,
  p_columns text[]
)
returns boolean
language sql
stable
as $$
  with target_table as (
    select c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_schema
      and c.relname = p_table
      and c.relkind in ('r', 'p')
  ),
  wanted_columns as (
    select cols.ordinality, a.attnum::int
    from unnest(p_columns) with ordinality as cols(attname, ordinality)
    join target_table t on true
    join pg_attribute a on a.attrelid = t.oid
      and a.attname = cols.attname
      and a.attnum > 0
      and not a.attisdropped
  ),
  wanted as (
    select array_agg(attnum order by ordinality) as attnums,
           count(*)::int as column_count
    from wanted_columns
  )
  select coalesce(exists (
    select 1
    from target_table t
    join pg_index ix on ix.indrelid = t.oid
    cross join wanted w
    where ix.indisvalid
      and ix.indisready
      and w.column_count = cardinality(p_columns)
      and (
        select array_agg(key_attnum::int order by key_ordinality)
        from unnest(ix.indkey) with ordinality as keys(key_attnum, key_ordinality)
        where key_ordinality <= w.column_count
      ) = w.attnums
  ), false);
$$;

select plan(23);

select ok(testutil.has_leftmost_index('market', 'listings', array['status', 'created_at']), 'market.listings covers status + created_at');
select ok(testutil.has_leftmost_index('market', 'listings', array['seller_user_id', 'status']), 'market.listings covers seller_user_id + status');
select ok(testutil.has_leftmost_index('market', 'listings', array['template_id', 'form_id', 'status']), 'market.listings covers template_id + form_id + status');
select ok(testutil.has_leftmost_index('market', 'listing_items', array['listing_id', 'status']), 'market.listing_items covers listing_id + status');
select ok(testutil.has_leftmost_index('market', 'listing_items', array['item_instance_id']), 'market.listing_items covers item_instance_id');
select ok(testutil.has_leftmost_index('market', 'orders', array['buyer_user_id', 'created_at']), 'market.orders covers buyer_user_id + created_at');
select ok(testutil.has_leftmost_index('market', 'orders', array['seller_user_id', 'created_at']), 'market.orders covers seller_user_id + created_at');
select ok(testutil.has_leftmost_index('market', 'order_items', array['item_instance_id']), 'market.order_items covers item_instance_id');
select ok(testutil.has_leftmost_index('market', 'listing_events', array['listing_id', 'created_at']), 'market.listing_events covers listing_id + created_at');
select ok(testutil.has_leftmost_index('market', 'price_snapshots', array['template_id', 'form_id', 'snapshot_at']), 'market.price_snapshots covers template_id + form_id + snapshot_at');
select ok(testutil.has_leftmost_index('market', 'depth_snapshots', array['template_id', 'form_id', 'snapshot_at']), 'market.depth_snapshots covers template_id + form_id + snapshot_at');
select ok(testutil.has_leftmost_index('inventory', 'item_instances', array['owner_user_id', 'status']), 'inventory.item_instances covers owner_user_id + status');
select ok(testutil.has_leftmost_index('inventory', 'inventory_locks', array['item_instance_id', 'status']), 'inventory.inventory_locks covers item_instance_id + status');
select ok(testutil.has_leftmost_index('economy', 'currency_ledger', array['user_id', 'currency_code', 'created_at']), 'economy.currency_ledger covers user_id + currency_code + created_at');

select ok(
  exists (
    select 1
    from pg_index ix
    join pg_class c on c.oid = ix.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'inventory'
      and c.relname = 'inventory_one_active_lock_per_item'
      and ix.indisunique
      and lower(pg_get_expr(ix.indpred, ix.indrelid)) like '%status%'
      and lower(pg_get_expr(ix.indpred, ix.indrelid)) like '%active%'
  ),
  'inventory has one-active-lock-per-item unique partial index'
);

select ok(
  exists (
    select 1
    from pg_index ix
    join pg_class c on c.oid = ix.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'market'
      and c.relname = 'market_one_reserved_listing_item_per_instance'
      and ix.indisunique
      and lower(pg_get_expr(ix.indpred, ix.indrelid)) like '%status%'
      and lower(pg_get_expr(ix.indpred, ix.indrelid)) like '%reserved%'
  ),
  'market has one-reserved-listing-item-per-instance unique partial index'
);

select is(
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'market'
      and c.relname in (
        'listings',
        'listing_items',
        'orders',
        'order_items',
        'listing_events',
        'price_snapshots',
        'depth_snapshots',
        'price_health_rules',
        'fee_settlements'
      )
      and c.relrowsecurity
  ),
  9,
  'all market tables have RLS enabled'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'market'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ),
  0,
  'anon/authenticated have no direct write grants on market tables'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'market'
      and roles && array['anon'::name, 'authenticated'::name]
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  0,
  'market RLS exposes no anon/authenticated write policies'
);

with write_functions(function_signature) as (
  values
    ('api.market_create_listing(uuid, uuid[], numeric, text)'::regprocedure),
    ('api.market_buy_listing(uuid, uuid, integer, text)'::regprocedure),
    ('api.market_update_listing_price(uuid, uuid, numeric)'::regprocedure),
    ('api.market_cancel_listing(uuid, uuid)'::regprocedure)
)
select is(
  (
    select count(*)::integer
    from write_functions
    where has_function_privilege('anon', function_signature, 'EXECUTE')
       or has_function_privilege('authenticated', function_signature, 'EXECUTE')
  ),
  0,
  'anon/authenticated cannot execute market write RPCs directly'
);

with write_functions(function_signature) as (
  values
    ('api.market_create_listing(uuid, uuid[], numeric, text)'::regprocedure),
    ('api.market_buy_listing(uuid, uuid, integer, text)'::regprocedure),
    ('api.market_update_listing_price(uuid, uuid, numeric)'::regprocedure),
    ('api.market_cancel_listing(uuid, uuid)'::regprocedure)
)
select is(
  (
    select count(*)::integer
    from write_functions
    where has_function_privilege('service_role', function_signature, 'EXECUTE')
  ),
  4,
  'service_role can execute all market write RPCs'
);

select ok(
  exists (
    select 1
    from economy.fee_rules
    where fee_type = 'market_sell'
      and currency_code = 'KCOIN'
      and fee_bps = 500
      and active = true
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
  ),
  'active KCOIN market_sell fee rule exists at 500 bps'
);

select ok(
  testutil.has_leftmost_index('economy', 'fee_rules', array['fee_type', 'currency_code', 'active']),
  'economy.fee_rules covers marketplace fee-rule lookup'
);

select * from finish();

rollback;
