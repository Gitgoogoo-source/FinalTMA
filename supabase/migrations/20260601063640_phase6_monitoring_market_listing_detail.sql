-- Phase 6 step 2.8: bounded market-listing detail facade for monitoring jumps.
--
-- Keep market schema private to PostgREST callers. Admin UI reads a single
-- listing through this api RPC and receives no seller/buyer user ids.

begin;

create or replace function api.admin_get_market_listing_detail(
  p_admin_user_id uuid,
  p_listing_id uuid,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_listing market.listings%rowtype;
  v_template jsonb := null;
  v_form jsonb := null;
  v_items jsonb := '[]'::jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_item_total integer := 0;
  v_order_total integer := 0;
  v_event_total integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:read', 'admin:read']);

  select *
  into v_listing
  from market.listings
  where id = p_listing_id;

  if not found then
    raise exception 'ADMIN_MARKET_LISTING_NOT_FOUND' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'displayName', t.display_name,
    'rarityCode', t.rarity_code,
    'typeCode', t.type_code,
    'releaseStatus', t.release_status,
    'tradeable', t.tradeable
  )
  into v_template
  from catalog.collectible_templates t
  where t.id = v_listing.template_id;

  if v_listing.form_id is not null then
    select jsonb_build_object(
      'id', f.id,
      'formIndex', f.form_index,
      'formSlug', f.form_slug,
      'displayName', f.display_name,
      'imageUrl', f.image_url,
      'thumbnailUrl', f.thumbnail_url
    )
    into v_form
    from catalog.collectible_forms f
    where f.id = v_listing.form_id;
  end if;

  select count(*)::integer
  into v_item_total
  from market.listing_items li
  where li.listing_id = p_listing_id;

  with item_rows as (
    select
      li.id,
      li.item_instance_id,
      li.status,
      li.sold_order_id,
      li.sold_at,
      li.created_at,
      ii.status as item_status,
      ii.level,
      ii.power,
      ii.nft_mint_status
    from market.listing_items li
    left join inventory.item_instances ii on ii.id = li.item_instance_id
    where li.listing_id = p_listing_id
    order by li.created_at desc
    limit 25
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'itemInstanceId', item_instance_id,
        'status', status,
        'soldOrderId', sold_order_id,
        'soldAt', sold_at,
        'createdAt', created_at,
        'itemStatus', item_status,
        'level', level,
        'power', power,
        'nftMintStatus', nft_mint_status
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into v_items
  from item_rows;

  select count(*)::integer
  into v_order_total
  from market.orders o
  where o.listing_id = p_listing_id;

  with order_rows as (
    select
      o.id,
      o.status,
      o.item_count,
      o.unit_price_kcoin,
      o.total_price_kcoin,
      o.fee_bps,
      o.fee_amount_kcoin,
      o.seller_net_amount_kcoin,
      o.completed_at,
      o.created_at,
      o.updated_at
    from market.orders o
    where o.listing_id = p_listing_id
    order by o.created_at desc
    limit 10
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'status', status,
        'itemCount', item_count,
        'unitPriceKcoin', unit_price_kcoin,
        'totalPriceKcoin', total_price_kcoin,
        'feeBps', fee_bps,
        'feeAmountKcoin', fee_amount_kcoin,
        'sellerNetAmountKcoin', seller_net_amount_kcoin,
        'completedAt', completed_at,
        'createdAt', created_at,
        'updatedAt', updated_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into v_orders
  from order_rows;

  select count(*)::integer
  into v_event_total
  from market.listing_events e
  where e.listing_id = p_listing_id;

  with event_rows as (
    select
      e.id,
      e.event_type,
      e.created_at
    from market.listing_events e
    where e.listing_id = p_listing_id
    order by e.created_at desc
    limit 12
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'eventType', event_type,
        'createdAt', created_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into v_events
  from event_rows;

  return jsonb_build_object(
    'id', v_listing.id,
    'status', v_listing.status,
    'templateId', v_listing.template_id,
    'formId', v_listing.form_id,
    'rarityCode', v_listing.rarity_code,
    'itemCount', v_listing.item_count,
    'remainingCount', v_listing.remaining_count,
    'unitPriceKcoin', v_listing.unit_price_kcoin,
    'feeBps', v_listing.fee_bps,
    'expectedNetAmount', v_listing.expected_net_amount,
    'priceHealth', v_listing.price_health,
    'expiresAt', v_listing.expires_at,
    'lastPriceChangedAt', v_listing.last_price_changed_at,
    'createdAt', v_listing.created_at,
    'updatedAt', v_listing.updated_at,
    'template', v_template,
    'form', v_form,
    'items', v_items,
    'orders', v_orders,
    'events', v_events,
    'sources', jsonb_build_object(
      'marketListings', jsonb_build_object(
        'schema', 'market',
        'table', 'listings',
        'id', p_listing_id,
        'limit', 1
      ),
      'listingItems', jsonb_build_object(
        'schema', 'market',
        'table', 'listing_items',
        'totalRows', v_item_total,
        'limit', 25,
        'truncated', v_item_total > 25
      ),
      'orders', jsonb_build_object(
        'schema', 'market',
        'table', 'orders',
        'totalRows', v_order_total,
        'limit', 10,
        'truncated', v_order_total > 10
      ),
      'events', jsonb_build_object(
        'schema', 'market',
        'table', 'listing_events',
        'totalRows', v_event_total,
        'limit', 12,
        'truncated', v_event_total > 12
      )
    ),
    'serverTime', now()
  );
end;
$$;

revoke all on function api.admin_get_market_listing_detail(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function api.admin_get_market_listing_detail(uuid, uuid, jsonb) to service_role;

comment on function api.admin_get_market_listing_detail(uuid, uuid, jsonb) is
  'Bounded phase 6 monitoring jump target for an admin market listing detail page.';

commit;
