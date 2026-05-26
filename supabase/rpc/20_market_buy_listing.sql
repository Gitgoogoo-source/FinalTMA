-- market_buy_listing.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.market_buy_listing

create or replace function api.market_buy_listing(
  p_user_id uuid,
  p_listing_id uuid,
  p_quantity integer,
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
  v_total numeric(38,0);
  v_fee numeric(38,0);
  v_net numeric(38,0);
  v_debit jsonb;
  v_credit jsonb;
begin
  if p_user_id is null or p_listing_id is null then
    raise exception 'user_id and listing_id are required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  select * into v_existing_order
  from market.orders
  where idempotency_key = p_idempotency_key;

  if v_existing_order.id is not null then
    return jsonb_build_object('order_id', v_existing_order.id, 'status', v_existing_order.status, 'idempotent', true);
  end if;

  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.status not in ('active', 'partially_sold') or v_listing.remaining_count < p_quantity then
    raise exception 'listing is not available';
  end if;
  if v_listing.seller_user_id = p_user_id then
    raise exception 'buyer cannot buy own listing';
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
    raise exception 'not enough reserved items in listing';
  end if;

  v_total := v_listing.unit_price_kcoin * p_quantity;
  v_fee := floor(v_total * v_listing.fee_bps / 10000);
  v_net := v_total - v_fee;

  v_debit := api._debit_balance(
    p_user_id, 'KCOIN', v_total, 'market_buy', v_order_id, null,
    'market_buy:buyer:' || v_order_id::text, 'Buy market listing',
    jsonb_build_object('listing_id', p_listing_id, 'quantity', p_quantity)
  );

  insert into market.orders (
    id, buyer_user_id, seller_user_id, listing_id, status,
    item_count, unit_price_kcoin, total_price_kcoin, fee_bps,
    fee_amount_kcoin, seller_net_amount_kcoin, buyer_ledger_id,
    idempotency_key, completed_at
  ) values (
    v_order_id, p_user_id, v_listing.seller_user_id, p_listing_id, 'completed',
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
  set status = 'sold', buyer_user_id = p_user_id, sold_order_id = v_order_id, sold_at = now()
  where id = any(v_listing_item_ids);

  update inventory.item_instances
  set owner_user_id = p_user_id,
      status = 'available',
      updated_at = now(),
      lock_version = lock_version + 1
  where id = any(v_item_ids);

  update inventory.inventory_locks
  set status = 'consumed', released_at = now(), updated_at = now()
  where item_instance_id = any(v_item_ids)
    and source_type = 'market_listing'
    and source_id = p_listing_id
    and status = 'active';

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, p_user_id, 'bought', 'market_order', v_order_id,
         jsonb_build_object('order_id', v_order_id, 'listing_id', p_listing_id)
  from unnest(v_item_ids) as x(id);

  update market.listings
  set remaining_count = remaining_count - p_quantity,
      status = case when remaining_count - p_quantity <= 0 then 'sold' else 'partially_sold' end,
      updated_at = now()
  where id = p_listing_id;

  insert into market.fee_settlements (market_order_id, currency_code, fee_amount, fee_bps, status, settled_at)
  values (v_order_id, 'KCOIN', v_fee, v_listing.fee_bps, 'settled', now());

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state)
  values (
    p_listing_id, p_user_id,
    case when v_listing.remaining_count - p_quantity <= 0 then 'sold' else 'partially_sold' end,
    jsonb_build_object('remaining_count', v_listing.remaining_count),
    jsonb_build_object('remaining_count', v_listing.remaining_count - p_quantity, 'order_id', v_order_id)
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'listing_id', p_listing_id,
    'item_instance_ids', to_jsonb(v_item_ids),
    'total_price_kcoin', v_total,
    'fee_amount_kcoin', v_fee,
    'seller_net_amount_kcoin', v_net,
    'idempotent', false
  );
end;
$$;


-- ============================================================
