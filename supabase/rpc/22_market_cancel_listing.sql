-- market_cancel_listing.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.market_cancel_listing

create or replace function api.market_cancel_listing(
  p_user_id uuid,
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing market.listings%rowtype;
  v_item_ids uuid[];
begin
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
    raise exception 'listing cannot be cancelled';
  end if;

  select array_agg(item_instance_id)
  into v_item_ids
  from (
    select item_instance_id
    from market.listing_items
    where listing_id = p_listing_id and status = 'reserved'
    for update
  ) s;

  update market.listings
  set status = 'cancelled', remaining_count = 0, updated_at = now()
  where id = p_listing_id;

  update market.listing_items
  set status = 'cancelled'
  where listing_id = p_listing_id and status = 'reserved';

  if v_item_ids is not null then
    update inventory.item_instances
    set status = 'available', updated_at = now(), lock_version = lock_version + 1
    where id = any(v_item_ids);

    update inventory.inventory_locks
    set status = 'released', released_at = now(), updated_at = now()
    where item_instance_id = any(v_item_ids)
      and source_type = 'market_listing'
      and source_id = p_listing_id
      and status = 'active';

    insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
    select x.id, p_user_id, 'delisted', 'market_listing', p_listing_id,
           jsonb_build_object('listing_id', p_listing_id)
    from unnest(v_item_ids) as x(id);
  end if;

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state)
  values (
    p_listing_id, p_user_id, 'cancelled',
    jsonb_build_object('status', v_listing.status, 'remaining_count', v_listing.remaining_count),
    jsonb_build_object('status', 'cancelled', 'remaining_count', 0)
  );

  return jsonb_build_object('listing_id', p_listing_id, 'status', 'cancelled', 'released_item_ids', coalesce(to_jsonb(v_item_ids), '[]'::jsonb));
end;
$$;


-- ============================================================
