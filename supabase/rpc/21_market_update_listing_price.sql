-- market_update_listing_price.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.market_update_listing_price

create or replace function api.market_update_listing_price(
  p_user_id uuid,
  p_listing_id uuid,
  p_new_unit_price_kcoin numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing market.listings%rowtype;
  v_fee numeric(38,0);
  v_net numeric(38,0);
begin
  if p_new_unit_price_kcoin is null or p_new_unit_price_kcoin <= 0 then
    raise exception 'new price must be positive';
  end if;

  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.seller_user_id <> p_user_id then
    raise exception 'not listing owner';
  end if;
  if v_listing.status not in ('active', 'partially_sold') then
    raise exception 'listing is not editable';
  end if;

  v_fee := floor((p_new_unit_price_kcoin * v_listing.remaining_count) * v_listing.fee_bps / 10000);
  v_net := (p_new_unit_price_kcoin * v_listing.remaining_count) - v_fee;

  update market.listings
  set unit_price_kcoin = p_new_unit_price_kcoin,
      expected_net_amount = v_net,
      last_price_changed_at = now(),
      updated_at = now()
  where id = p_listing_id;

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state)
  values (
    p_listing_id, p_user_id, 'price_changed',
    jsonb_build_object('unit_price_kcoin', v_listing.unit_price_kcoin),
    jsonb_build_object('unit_price_kcoin', p_new_unit_price_kcoin)
  );

  return jsonb_build_object('listing_id', p_listing_id, 'unit_price_kcoin', p_new_unit_price_kcoin, 'expected_net_amount', v_net);
end;
$$;


-- ============================================================
