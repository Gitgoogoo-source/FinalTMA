-- Phase 2 market sell rules and idempotent create-listing response.
-- Not applied remotely until reviewed.

create or replace function api.market_get_sell_rules(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee_bps integer;
  v_source text := 'active_rule';
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select fee_bps
    into v_fee_bps
  from economy.fee_rules
  where fee_type = 'market_sell'
    and currency_code = 'KCOIN'
    and active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_fee_bps is null then
    v_fee_bps := 500;
    v_source := 'fallback';
  end if;

  return jsonb_build_object(
    'fee_type', 'market_sell',
    'currency_code', 'KCOIN',
    'fee_bps', v_fee_bps,
    'source', v_source
  );
end;
$$;

grant execute on function api.market_get_sell_rules(uuid) to service_role;
revoke execute on function api.market_get_sell_rules(uuid) from public, anon, authenticated;

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
  v_existing_listing_id uuid;
  v_existing_user_id uuid;
  v_existing_status text;
  v_existing_event_type text;
  v_existing_hash text;
  v_existing_item_count integer;
  v_existing_remaining_count integer;
  v_existing_unit_price_kcoin numeric(38,0);
  v_existing_fee_bps integer;
  v_existing_expected_net numeric(38,0);
  v_existing_price_health text;
  v_request_hash text;
  v_price_health text;
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

  perform pg_advisory_xact_lock(hashtext('market_create_listing'), hashtext(p_idempotency_key));

  select md5(string_agg(x.item_id::text, ',' order by x.item_id::text) || ':' || p_unit_price_kcoin::text)
    into v_request_hash
  from unnest(p_item_instance_ids) as x(item_id);

  select
    l.id,
    e.user_id,
    l.status,
    e.event_type,
    e.metadata ->> 'request_hash',
    l.item_count,
    l.remaining_count,
    l.unit_price_kcoin,
    l.fee_bps,
    l.expected_net_amount,
    l.price_health
  into
    v_existing_listing_id,
    v_existing_user_id,
    v_existing_status,
    v_existing_event_type,
    v_existing_hash,
    v_existing_item_count,
    v_existing_remaining_count,
    v_existing_unit_price_kcoin,
    v_existing_fee_bps,
    v_existing_expected_net,
    v_existing_price_health
  from market.listings l
  join market.listing_events e on e.listing_id = l.id
  where e.metadata ->> 'idempotency_key' = p_idempotency_key
  order by e.created_at desc, e.id desc
  limit 1;

  if v_existing_listing_id is not null then
    if v_existing_event_type <> 'created'
       or v_existing_user_id is distinct from p_user_id then
      raise exception 'idempotency conflict';
    end if;

    if v_existing_hash is not null and v_existing_hash <> v_request_hash then
      raise exception 'idempotency conflict';
    end if;

    return jsonb_build_object(
      'listing_id', v_existing_listing_id,
      'status', v_existing_status,
      'item_count', v_existing_item_count,
      'remaining_count', v_existing_remaining_count,
      'unit_price_kcoin', v_existing_unit_price_kcoin,
      'fee_bps', v_existing_fee_bps,
      'expected_net_amount', v_existing_expected_net,
      'price_health', v_existing_price_health,
      'idempotent', true
    );
  end if;

  if (select count(*) from (select distinct unnest(p_item_instance_ids) as id) x) <> cardinality(p_item_instance_ids) then
    raise exception 'duplicate item ids are not allowed';
  end if;

  perform 1
  from inventory.item_instances
  where id = any(p_item_instance_ids)
  for update;

  perform 1
  from inventory.inventory_locks il
  where il.item_instance_id = any(p_item_instance_ids)
    and il.status = 'active'
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
         or ii.nft_mint_status in ('queued', 'minting')
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

  select fee_bps
    into v_fee_bps
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
  v_price_health := api._market_price_health(v_template_id, v_form_id, v_rarity_code, p_unit_price_kcoin);

  insert into market.listings (
    id, seller_user_id, template_id, form_id, rarity_code, status,
    item_count, remaining_count, unit_price_kcoin, fee_bps, expected_net_amount,
    price_health, last_price_changed_at
  ) values (
    v_listing_id, p_user_id, v_template_id, v_form_id, v_rarity_code, 'active',
    v_item_count, v_item_count, p_unit_price_kcoin, v_fee_bps, v_expected_net,
    v_price_health, now()
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
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'request_hash', v_request_hash,
      'item_instance_ids', to_jsonb(p_item_instance_ids),
      'unit_price_kcoin', p_unit_price_kcoin
    )
  );

  return jsonb_build_object(
    'listing_id', v_listing_id,
    'status', 'active',
    'item_count', v_item_count,
    'remaining_count', v_item_count,
    'unit_price_kcoin', p_unit_price_kcoin,
    'fee_bps', v_fee_bps,
    'expected_net_amount', v_expected_net,
    'price_health', v_price_health,
    'idempotent', false
  );
end;
$$;

grant execute on function api.market_create_listing(uuid, uuid[], numeric, text) to service_role;
revoke execute on function api.market_create_listing(uuid, uuid[], numeric, text) from public, anon, authenticated;
