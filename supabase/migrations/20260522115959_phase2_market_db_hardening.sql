-- Phase 2 marketplace database hardening.
-- Remote migration version: 20260522115959.
-- Scope: duplicate-listing guards, high-traffic market indexes, RLS/write grants,
-- and fee-rule lookup alignment for marketplace RPCs.

-- Stage 3 query-path indexes. Some broader indexes already exist from 0019;
-- these cover the remaining leftmost/FK paths called out by the marketplace
-- hardening guide.
create index if not exists listings_template_form_status_created_idx
  on market.listings (template_id, form_id, status, created_at desc);

create index if not exists listing_items_item_instance_idx
  on market.listing_items (item_instance_id);

create index if not exists order_items_item_instance_idx
  on market.order_items (item_instance_id);

create index if not exists listing_events_listing_created_idx
  on market.listing_events (listing_id, created_at desc);

create index if not exists inventory_locks_item_status_idx
  on inventory.inventory_locks (item_instance_id, status);

create index if not exists currency_ledger_user_currency_created_idx
  on economy.currency_ledger (user_id, currency_code, created_at desc);

create index if not exists fee_rules_market_sell_active_idx
  on economy.fee_rules (fee_type, currency_code, active, created_at desc);

comment on index market.listings_template_form_status_created_idx
  is 'Phase 2 market browse/filter path by collectible form, status and recency.';
comment on index market.listing_items_item_instance_idx
  is 'Phase 2 item-instance FK lookup path for listing item ownership and duplicate-listing checks.';
comment on index market.order_items_item_instance_idx
  is 'Phase 2 order lookup path by concrete traded item instance.';
comment on index market.listing_events_listing_created_idx
  is 'Phase 2 listing audit/event lookup path by listing and event recency.';
comment on index inventory.inventory_locks_item_status_idx
  is 'Phase 2 lock lookup path for active/resolved locks on a concrete item instance.';
comment on index economy.currency_ledger_user_currency_created_idx
  is 'Phase 2 ledger lookup path by user, currency and recency.';
comment on index economy.fee_rules_market_sell_active_idx
  is 'Phase 2 marketplace fee-rule lookup path by fee type, currency and active status.';

-- Keep direct Supabase roles read-only for market and related inventory/economy
-- tables. Marketplace mutations must go through Vercel API + service_role RPC.
revoke insert, update, delete, truncate
  on all tables in schema market
  from anon, authenticated;

revoke insert, update, delete, truncate
  on table inventory.item_instances,
           inventory.inventory_locks,
           economy.user_balances,
           economy.currency_ledger,
           economy.fee_rules
  from anon, authenticated;

-- Explicitly guard active inventory locks before creating the listing. The
-- unique partial index remains the final database backstop, but this turns
-- stale/inconsistent locked inventory into a stable RPC error instead of a raw
-- unique-index violation.
create or replace function api.market_create_listing(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_count integer;
  v_template_id uuid;
  v_form_id uuid;
  v_rarity_code text;
  v_distinct_templates integer;
  v_distinct_forms integer;
  v_bad_count integer;
  v_active_lock_count integer;
  v_fee_bps integer;
  v_fee_amount numeric(38,0);
  v_expected_net numeric(38,0);
  v_listing_id uuid := gen_random_uuid();
  v_existing market.listings%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_item_instance_ids is null or cardinality(p_item_instance_ids) = 0 then
    raise exception 'item_instance_ids are required';
  end if;
  if p_unit_price_kcoin is null or p_unit_price_kcoin <= 0 then
    raise exception 'unit price must be positive';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  select l.* into v_existing
  from market.listings l
  join market.listing_events e on e.listing_id = l.id
  where e.metadata ->> 'idempotency_key' = p_idempotency_key
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object('listing_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  if (select count(*) from (select distinct unnest(p_item_instance_ids) as id) x) <> cardinality(p_item_instance_ids) then
    raise exception 'duplicate item ids are not allowed';
  end if;

  perform 1
  from inventory.item_instances
  where id = any(p_item_instance_ids)
  for update;

  select
    count(*)::integer,
    (array_agg(distinct ii.template_id))[1],
    (array_agg(distinct ii.form_id))[1],
    (array_agg(distinct t.rarity_code))[1],
    count(distinct ii.template_id)::integer,
    count(distinct coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
    count(*) filter (
      where ii.owner_user_id is distinct from p_user_id
         or ii.status <> 'available'
         or t.tradeable is distinct from true
    )::integer
  into v_item_count, v_template_id, v_form_id, v_rarity_code, v_distinct_templates, v_distinct_forms, v_bad_count
  from inventory.item_instances ii
  join catalog.collectible_templates t on t.id = ii.template_id
  where ii.id = any(p_item_instance_ids);

  if v_item_count <> cardinality(p_item_instance_ids) then
    raise exception 'some items do not exist';
  end if;
  if v_bad_count > 0 then
    raise exception 'some items are not sellable';
  end if;

  select count(*)::integer
  into v_active_lock_count
  from inventory.inventory_locks il
  where il.item_instance_id = any(p_item_instance_ids)
    and il.status = 'active';

  if coalesce(v_active_lock_count, 0) > 0 then
    raise exception 'some items are already locked';
  end if;

  if v_distinct_templates <> 1 or v_distinct_forms <> 1 then
    raise exception 'one listing must contain the same collectible and form';
  end if;

  select fee_bps into v_fee_bps
  from economy.fee_rules
  where fee_type = 'market_sell'
    and currency_code = 'KCOIN'
    and active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  v_fee_bps := coalesce(v_fee_bps, 500);
  v_fee_amount := floor((p_unit_price_kcoin * v_item_count) * v_fee_bps / 10000);
  v_expected_net := (p_unit_price_kcoin * v_item_count) - v_fee_amount;

  insert into market.listings (
    id, seller_user_id, template_id, form_id, rarity_code, status,
    item_count, remaining_count, unit_price_kcoin, fee_bps, expected_net_amount,
    price_health, last_price_changed_at
  ) values (
    v_listing_id, p_user_id, v_template_id, v_form_id, v_rarity_code, 'active',
    v_item_count, v_item_count, p_unit_price_kcoin, v_fee_bps, v_expected_net,
    'unknown', now()
  );

  insert into market.listing_items (listing_id, item_instance_id, status)
  select v_listing_id, x.id, 'reserved'
  from unnest(p_item_instance_ids) as x(id);

  insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, source_id)
  select x.id, p_user_id, 'market_listing', 'market_listing', v_listing_id
  from unnest(p_item_instance_ids) as x(id);

  update inventory.item_instances
  set status = 'listed', updated_at = now(), lock_version = lock_version + 1
  where id = any(p_item_instance_ids);

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, p_user_id, 'listed', 'market_listing', v_listing_id,
         jsonb_build_object('listing_id', v_listing_id, 'unit_price_kcoin', p_unit_price_kcoin)
  from unnest(p_item_instance_ids) as x(id);

  insert into market.listing_events (listing_id, user_id, event_type, after_state, metadata)
  values (
    v_listing_id, p_user_id, 'created',
    jsonb_build_object('unit_price_kcoin', p_unit_price_kcoin, 'item_count', v_item_count),
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );

  return jsonb_build_object(
    'listing_id', v_listing_id,
    'status', 'active',
    'item_count', v_item_count,
    'remaining_count', v_item_count,
    'unit_price_kcoin', p_unit_price_kcoin,
    'fee_bps', v_fee_bps,
    'expected_net_amount', v_expected_net,
    'idempotent', false
  );
end;
$$;

grant execute on function api.market_create_listing(uuid, uuid[], numeric, text) to service_role;
revoke execute on function api.market_create_listing(uuid, uuid[], numeric, text) from public, anon, authenticated;
