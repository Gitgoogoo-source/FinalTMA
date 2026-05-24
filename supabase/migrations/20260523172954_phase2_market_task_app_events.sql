-- Phase 2 stage 14: reserve trade task progress events.
-- This migration only writes ops.app_events from successful market RPC paths.
-- It does not update tasks.user_task_progress; the later task system can replay
-- or aggregate these events.

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

  insert into ops.app_events (user_id, event_name, event_source, payload)
  values (
    p_user_id,
    'market_listing_created',
    'market_rpc',
    jsonb_build_object(
      'task_action_type', 'sell_market',
      'listing_id', v_listing_id,
      'item_instance_ids', to_jsonb(p_item_instance_ids),
      'item_count', v_item_count,
      'remaining_count', v_item_count,
      'unit_price_kcoin', p_unit_price_kcoin,
      'fee_bps', v_fee_bps,
      'expected_net_amount', v_expected_net,
      'price_health', v_price_health,
      'template_id', v_template_id,
      'form_id', v_form_id,
      'rarity_code', v_rarity_code,
      'idempotency_key', p_idempotency_key
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

create or replace function api.market_buy_listing(
  p_buyer_user_id uuid,
  p_listing_id uuid,
  p_quantity integer,
  p_expected_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order market.orders%rowtype;
  v_listing market.listings%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_listing_item_ids uuid[];
  v_item_ids uuid[];
  v_purchased_items jsonb;
  v_total numeric(38,0);
  v_fee numeric(38,0);
  v_net numeric(38,0);
  v_debit jsonb;
  v_credit jsonb;
  v_remaining_after integer;
  v_status_after text;
  v_expected_net_after numeric(38,0);
  v_locked_item_count integer;
  v_valid_item_count integer;
  v_active_lock_count integer;
  v_updated_count integer;
begin
  if p_buyer_user_id is null or p_listing_id is null then
    raise exception 'user_id and listing_id are required';
  end if;
  if p_quantity is distinct from 1 then
    raise exception 'quantity must be 1';
  end if;
  if p_expected_unit_price_kcoin is null or p_expected_unit_price_kcoin <= 0 then
    raise exception 'expected_unit_price_kcoin is required';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('market_buy_listing'), hashtext(p_idempotency_key));

  select * into v_existing_order
  from market.orders
  where idempotency_key = p_idempotency_key;

  if v_existing_order.id is not null then
    if v_existing_order.buyer_user_id is distinct from p_buyer_user_id
       or v_existing_order.listing_id is distinct from p_listing_id
       or v_existing_order.item_count is distinct from p_quantity
       or v_existing_order.unit_price_kcoin is distinct from p_expected_unit_price_kcoin then
      raise exception 'idempotency conflict';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_instance_id', oi.item_instance_id,
          'template_id', ii.template_id,
          'form_id', ii.form_id
        )
        order by oi.created_at asc
      ),
      '[]'::jsonb
    )
      into v_purchased_items
    from market.order_items oi
    join inventory.item_instances ii on ii.id = oi.item_instance_id
    where oi.order_id = v_existing_order.id;

    return jsonb_build_object(
      'order_id', v_existing_order.id,
      'listing_id', v_existing_order.listing_id,
      'purchased_items', v_purchased_items,
      'total_price_kcoin', v_existing_order.total_price_kcoin,
      'fee_amount_kcoin', v_existing_order.fee_amount_kcoin,
      'seller_net_amount_kcoin', v_existing_order.seller_net_amount_kcoin,
      'buyer_balance_after', coalesce((
        select available_amount
        from economy.user_balances
        where user_id = p_buyer_user_id and currency_code = 'KCOIN'
      ), 0),
      'status', v_existing_order.status,
      'idempotent', true
    );
  end if;

  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.status not in ('active', 'partially_sold') then
    raise exception 'listing is not buyable';
  end if;
  if v_listing.remaining_count < p_quantity then
    raise exception 'listing sold out';
  end if;
  if v_listing.seller_user_id = p_buyer_user_id then
    raise exception 'buyer cannot buy own listing';
  end if;
  if v_listing.unit_price_kcoin <> p_expected_unit_price_kcoin then
    raise exception 'listing price changed';
  end if;

  select array_agg(id), array_agg(item_instance_id)
    into v_listing_item_ids, v_item_ids
  from (
    select id, item_instance_id
    from market.listing_items
    where listing_id = p_listing_id and status = 'reserved'
    order by created_at asc
    limit p_quantity
    for update
  ) s;

  if v_item_ids is null or cardinality(v_item_ids) <> p_quantity then
    raise exception 'listing sold out';
  end if;

  with locked_items as (
    select ii.id, ii.owner_user_id, ii.status
    from inventory.item_instances ii
    where ii.id = any(v_item_ids)
    for update
  )
  select
    count(*)::integer,
    count(*) filter (
      where owner_user_id = v_listing.seller_user_id
        and status = 'listed'
    )::integer
    into v_locked_item_count, v_valid_item_count
  from locked_items;

  if v_locked_item_count <> p_quantity or v_valid_item_count <> p_quantity then
    raise exception 'listing item integrity violation';
  end if;

  with locked_locks as (
    select il.id
    from inventory.inventory_locks il
    where il.item_instance_id = any(v_item_ids)
      and il.user_id = v_listing.seller_user_id
      and il.lock_type = 'market_listing'
      and il.source_type = 'market_listing'
      and il.source_id = p_listing_id
      and il.status = 'active'
    for update
  )
  select count(*)::integer
    into v_active_lock_count
  from locked_locks;

  if v_active_lock_count <> p_quantity then
    raise exception 'listing lock integrity violation';
  end if;

  v_total := v_listing.unit_price_kcoin * p_quantity;
  v_fee := floor(v_total * v_listing.fee_bps / 10000);
  v_net := v_total - v_fee;

  v_debit := api._debit_balance(
    p_buyer_user_id, 'KCOIN', v_total, 'market_buy', v_order_id, null,
    'market_buy:buyer:' || v_order_id::text, 'Buy market listing',
    jsonb_build_object('listing_id', p_listing_id, 'quantity', p_quantity)
  );

  insert into market.orders (
    id, buyer_user_id, seller_user_id, listing_id, status,
    item_count, unit_price_kcoin, total_price_kcoin, fee_bps,
    fee_amount_kcoin, seller_net_amount_kcoin, buyer_ledger_id,
    idempotency_key, completed_at
  ) values (
    v_order_id, p_buyer_user_id, v_listing.seller_user_id, p_listing_id, 'completed',
    p_quantity, v_listing.unit_price_kcoin, v_total, v_listing.fee_bps,
    v_fee, v_net, (v_debit ->> 'ledger_id')::uuid,
    p_idempotency_key, now()
  );

  v_credit := api._credit_balance(
    v_listing.seller_user_id, 'KCOIN', v_net, 'market_sell', v_order_id, null,
    'market_sell:seller:' || v_order_id::text, 'Marketplace sale proceeds',
    jsonb_build_object('listing_id', p_listing_id, 'quantity', p_quantity, 'fee_amount_kcoin', v_fee)
  );

  update market.orders
  set seller_ledger_id = (v_credit ->> 'ledger_id')::uuid,
      updated_at = now()
  where id = v_order_id;

  insert into market.order_items (order_id, listing_item_id, item_instance_id)
  select v_order_id, li.id, li.item_instance_id
  from market.listing_items li
  where li.id = any(v_listing_item_ids);

  update market.listing_items
  set status = 'sold', buyer_user_id = p_buyer_user_id, sold_order_id = v_order_id, sold_at = now()
  where id = any(v_listing_item_ids)
    and status = 'reserved';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> p_quantity then
    raise exception 'listing item integrity violation';
  end if;

  update inventory.item_instances
  set owner_user_id = p_buyer_user_id,
      status = 'available',
      source_type = 'market',
      source_id = v_order_id,
      updated_at = now(),
      lock_version = lock_version + 1
  where id = any(v_item_ids)
    and owner_user_id = v_listing.seller_user_id
    and status = 'listed';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> p_quantity then
    raise exception 'listing item integrity violation';
  end if;

  update inventory.inventory_locks
  set status = 'consumed', released_at = now(), updated_at = now()
  where item_instance_id = any(v_item_ids)
    and user_id = v_listing.seller_user_id
    and lock_type = 'market_listing'
    and source_type = 'market_listing'
    and source_id = p_listing_id
    and status = 'active';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> p_quantity then
    raise exception 'listing lock integrity violation';
  end if;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, v_listing.seller_user_id, 'sold', 'market_order', v_order_id,
         jsonb_build_object('order_id', v_order_id, 'listing_id', p_listing_id, 'buyer_user_id', p_buyer_user_id)
  from unnest(v_item_ids) as x(id);

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, p_buyer_user_id, 'bought', 'market_order', v_order_id,
         jsonb_build_object('order_id', v_order_id, 'listing_id', p_listing_id, 'seller_user_id', v_listing.seller_user_id)
  from unnest(v_item_ids) as x(id);

  v_remaining_after := v_listing.remaining_count - p_quantity;
  v_status_after := case when v_remaining_after <= 0 then 'sold' else 'partially_sold' end;
  v_expected_net_after := (v_listing.unit_price_kcoin * v_remaining_after) - floor((v_listing.unit_price_kcoin * v_remaining_after) * v_listing.fee_bps / 10000);

  update market.listings
  set remaining_count = v_remaining_after,
      status = v_status_after,
      expected_net_amount = v_expected_net_after,
      updated_at = now()
  where id = p_listing_id;

  insert into market.fee_settlements (market_order_id, currency_code, fee_amount, fee_bps, status, settled_at)
  values (v_order_id, 'KCOIN', v_fee, v_listing.fee_bps, 'settled', now());

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state, metadata)
  values (
    p_listing_id, p_buyer_user_id, v_status_after,
    jsonb_build_object('remaining_count', v_listing.remaining_count, 'status', v_listing.status),
    jsonb_build_object('remaining_count', v_remaining_after, 'status', v_status_after, 'order_id', v_order_id),
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );

  insert into ops.app_events (user_id, event_name, event_source, payload)
  values (
    p_buyer_user_id,
    'market_order_completed',
    'market_rpc',
    jsonb_build_object(
      'task_action_type', 'buy_market',
      'order_id', v_order_id,
      'listing_id', p_listing_id,
      'buyer_user_id', p_buyer_user_id,
      'seller_user_id', v_listing.seller_user_id,
      'item_instance_ids', to_jsonb(v_item_ids),
      'quantity', p_quantity,
      'unit_price_kcoin', v_listing.unit_price_kcoin,
      'total_price_kcoin', v_total,
      'fee_amount_kcoin', v_fee,
      'seller_net_amount_kcoin', v_net,
      'listing_status_after', v_status_after,
      'template_id', v_listing.template_id,
      'form_id', v_listing.form_id,
      'rarity_code', v_listing.rarity_code,
      'idempotency_key', p_idempotency_key
    )
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_instance_id', ii.id,
        'template_id', ii.template_id,
        'form_id', ii.form_id
      )
      order by ii.id
    ),
    '[]'::jsonb
  )
    into v_purchased_items
  from inventory.item_instances ii
  where ii.id = any(v_item_ids);

  return jsonb_build_object(
    'order_id', v_order_id,
    'listing_id', p_listing_id,
    'purchased_items', v_purchased_items,
    'total_price_kcoin', v_total,
    'fee_amount_kcoin', v_fee,
    'seller_net_amount_kcoin', v_net,
    'buyer_balance_after', (v_debit ->> 'available')::numeric,
    'idempotent', false
  );
end;
$$;

grant execute on function api.market_create_listing(uuid, uuid[], numeric, text) to service_role;
grant execute on function api.market_buy_listing(uuid, uuid, integer, numeric, text) to service_role;

revoke execute on function api.market_create_listing(uuid, uuid[], numeric, text) from public, anon, authenticated;
revoke execute on function api.market_buy_listing(uuid, uuid, integer, numeric, text) from public, anon, authenticated;
