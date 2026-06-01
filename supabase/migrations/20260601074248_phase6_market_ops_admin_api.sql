-- Phase 6 step 2.9 market operations admin API RPCs.
--
-- The admin API talks to private market/catalog/economy schemas through
-- service_role-only facades. Writes are idempotent and always emit both an
-- admin audit log and a risk event.

begin;

create or replace function api.admin_get_market_ops_stats(
  p_admin_user_id uuid,
  p_window_hours integer default 24,
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
  v_window_hours integer := coalesce(p_window_hours, 24);
  v_now timestamptz := now();
  v_started_at timestamptz;
  v_active_listing_count integer := 0;
  v_active_item_count integer := 0;
  v_total_listing_value numeric := 0;
  v_volume numeric := 0;
  v_fee_revenue numeric := 0;
  v_order_fee_revenue numeric := 0;
  v_completed_order_count integer := 0;
  v_active_avg_unit_price numeric := 0;
  v_active_weighted_avg_unit_price numeric := 0;
  v_order_avg_unit_price numeric := 0;
  v_order_weighted_avg_unit_price numeric := 0;
  v_abnormal_listing_count integer := 0;
  v_status_counts jsonb := '{}'::jsonb;
  v_price_health_counts jsonb := '{}'::jsonb;
  v_floor_prices jsonb := '[]'::jsonb;
  v_active_average_prices jsonb := '[]'::jsonb;
  v_order_average_prices jsonb := '[]'::jsonb;
  v_recent_sale_prices jsonb := '[]'::jsonb;
  v_price_references jsonb := '[]'::jsonb;
  v_latest_sale jsonb := 'null'::jsonb;
  v_abnormal_listings jsonb := '{}'::jsonb;
  v_price_health_findings jsonb := '[]'::jsonb;
  v_wash_trade_signals jsonb := '{}'::jsonb;
  v_suspicious_trade_groups jsonb := '[]'::jsonb;
  v_fee_revenue_sources jsonb := '[]'::jsonb;
  v_price_snapshot_count integer := 0;
  v_depth_snapshot_count integer := 0;
  v_fee_settlement_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:read', 'admin:read']);

  if v_window_hours < 1 or v_window_hours > 168 then
    raise exception 'ADMIN_MARKET_STATS_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  v_started_at := v_now - make_interval(hours => v_window_hours);

  select
    count(*)::integer,
    coalesce(sum(remaining_count), 0)::integer,
    coalesce(sum(unit_price_kcoin * remaining_count), 0),
    coalesce(avg(unit_price_kcoin), 0),
    case
      when coalesce(sum(remaining_count), 0) > 0
        then coalesce(sum(unit_price_kcoin * remaining_count), 0) / sum(remaining_count)
      else 0
    end
  into
    v_active_listing_count,
    v_active_item_count,
    v_total_listing_value,
    v_active_avg_unit_price,
    v_active_weighted_avg_unit_price
  from market.listings
  where status = 'active';

  select coalesce(jsonb_object_agg(status_key, listing_count), '{}'::jsonb)
  into v_status_counts
  from (
    select lower(coalesce(nullif(status, ''), 'unknown')) as status_key,
           count(*)::integer as listing_count
    from market.listings
    group by lower(coalesce(nullif(status, ''), 'unknown'))
  ) counts;

  select
    count(*) filter (where status = 'completed')::integer,
    coalesce(sum(total_price_kcoin) filter (where status = 'completed'), 0),
    coalesce(sum(fee_amount_kcoin) filter (where status = 'completed'), 0),
    coalesce(avg(unit_price_kcoin) filter (where status = 'completed'), 0),
    case
      when coalesce(sum(item_count) filter (where status = 'completed'), 0) > 0
        then coalesce(sum(total_price_kcoin) filter (where status = 'completed'), 0)
          / (sum(item_count) filter (where status = 'completed'))
      else 0
    end
  into
    v_completed_order_count,
    v_volume,
    v_order_fee_revenue,
    v_order_avg_unit_price,
    v_order_weighted_avg_unit_price
  from market.orders
  where created_at >= v_started_at
    and created_at <= v_now;

  select coalesce(sum(fs.fee_amount), 0), count(*)::integer
  into v_fee_revenue, v_fee_settlement_count
  from market.fee_settlements fs
  join market.orders o on o.id = fs.market_order_id
  where o.status = 'completed'
    and o.created_at >= v_started_at
    and o.created_at <= v_now
    and fs.currency_code = 'KCOIN'
    and fs.status = 'settled';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'templateId', template_id,
      'formId', form_id,
      'rarityCode', rarity_code,
      'floorPriceKcoin', floor_price_kcoin,
      'activeListingCount', active_listing_count,
      'activeItemCount', active_item_count,
      'totalListingValueKcoin', total_listing_value_kcoin
    )
    order by floor_price_kcoin asc, template_id, form_id
  ), '[]'::jsonb)
  into v_floor_prices
  from (
    select
      template_id,
      form_id,
      min(rarity_code) as rarity_code,
      min(unit_price_kcoin) as floor_price_kcoin,
      count(*)::integer as active_listing_count,
      coalesce(sum(remaining_count), 0)::integer as active_item_count,
      coalesce(sum(unit_price_kcoin * remaining_count), 0) as total_listing_value_kcoin
    from market.listings
    where status = 'active'
    group by template_id, form_id
  ) floors;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'templateId', template_id,
      'formId', form_id,
      'rarityCode', rarity_code,
      'listingCount', listing_count,
      'itemCount', item_count,
      'averageUnitPriceKcoin', average_unit_price_kcoin,
      'weightedAverageUnitPriceKcoin', weighted_average_unit_price_kcoin,
      'totalListingValueKcoin', total_listing_value_kcoin
    )
    order by template_id, form_id
  ), '[]'::jsonb)
  into v_active_average_prices
  from (
    select
      template_id,
      form_id,
      min(rarity_code) as rarity_code,
      count(*)::integer as listing_count,
      coalesce(sum(remaining_count), 0)::integer as item_count,
      avg(unit_price_kcoin) as average_unit_price_kcoin,
      case
        when coalesce(sum(remaining_count), 0) > 0
          then coalesce(sum(unit_price_kcoin * remaining_count), 0) / sum(remaining_count)
        else 0
      end as weighted_average_unit_price_kcoin,
      coalesce(sum(unit_price_kcoin * remaining_count), 0) as total_listing_value_kcoin
    from market.listings
    where status = 'active'
    group by template_id, form_id
  ) averages;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'templateId', template_id,
      'formId', form_id,
      'rarityCode', rarity_code,
      'orderCount', order_count,
      'itemCount', item_count,
      'averageUnitPriceKcoin', average_unit_price_kcoin,
      'weightedAverageUnitPriceKcoin', weighted_average_unit_price_kcoin,
      'volumeKcoin', volume_kcoin
    )
    order by template_id, form_id
  ), '[]'::jsonb)
  into v_order_average_prices
  from (
    select
      l.template_id,
      l.form_id,
      min(l.rarity_code) as rarity_code,
      count(*)::integer as order_count,
      coalesce(sum(o.item_count), 0)::integer as item_count,
      avg(o.unit_price_kcoin) as average_unit_price_kcoin,
      case
        when coalesce(sum(o.item_count), 0) > 0
          then coalesce(sum(o.total_price_kcoin), 0) / sum(o.item_count)
        else 0
      end as weighted_average_unit_price_kcoin,
      coalesce(sum(o.total_price_kcoin), 0) as volume_kcoin
    from market.orders o
    join market.listings l on l.id = o.listing_id
    where o.status = 'completed'
      and o.created_at >= v_started_at
      and o.created_at <= v_now
    group by l.template_id, l.form_id
  ) averages;

  with latest_completed_orders as (
    select distinct on (l.template_id, l.form_id)
      o.id,
      o.listing_id,
      l.template_id,
      l.form_id,
      l.rarity_code,
      o.unit_price_kcoin,
      o.total_price_kcoin,
      o.item_count,
      coalesce(o.completed_at, o.created_at) as sold_at
    from market.orders o
    join market.listings l on l.id = o.listing_id
    where o.status = 'completed'
      and o.created_at >= v_started_at
      and o.created_at <= v_now
    order by l.template_id, l.form_id, coalesce(o.completed_at, o.created_at) desc, o.id desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'orderId', id,
      'listingId', listing_id,
      'templateId', template_id,
      'formId', form_id,
      'rarityCode', rarity_code,
      'unitPriceKcoin', unit_price_kcoin,
      'totalPriceKcoin', total_price_kcoin,
      'itemCount', item_count,
      'soldAt', sold_at
    )
    order by sold_at desc, id desc
  ), '[]'::jsonb)
  into v_recent_sale_prices
  from latest_completed_orders;

  select coalesce(jsonb_build_object(
    'orderId', o.id,
    'listingId', o.listing_id,
    'templateId', l.template_id,
    'formId', l.form_id,
    'rarityCode', l.rarity_code,
    'unitPriceKcoin', o.unit_price_kcoin,
    'totalPriceKcoin', o.total_price_kcoin,
    'itemCount', o.item_count,
    'soldAt', coalesce(o.completed_at, o.created_at)
  ), 'null'::jsonb)
  into v_latest_sale
  from market.orders o
  join market.listings l on l.id = o.listing_id
  where o.status = 'completed'
    and o.created_at >= v_started_at
    and o.created_at <= v_now
  order by coalesce(o.completed_at, o.created_at) desc, o.id desc
  limit 1;

  with active_listings as (
    select *
    from market.listings
    where status = 'active'
  ),
  current_floors as (
    select
      template_id,
      form_id,
      min(unit_price_kcoin) as floor_price_kcoin
    from active_listings
    group by template_id, form_id
  ),
  latest_snapshots as (
    select distinct on (template_id, form_id)
      template_id,
      form_id,
      floor_price_kcoin,
      snapshot_at
    from market.price_snapshots
    where floor_price_kcoin is not null
      and floor_price_kcoin > 0
    order by template_id, form_id, snapshot_at desc, id desc
  ),
  classified as (
    select
      l.id,
      l.seller_user_id,
      l.template_id,
      l.form_id,
      l.rarity_code,
      l.unit_price_kcoin,
      l.remaining_count,
      l.price_health as stored_price_health,
      l.created_at,
      coalesce(ls.floor_price_kcoin, cf.floor_price_kcoin) as reference_floor_price_kcoin,
      coalesce(rule.min_ratio_to_floor, 0.5000) as min_ratio_to_floor,
      coalesce(rule.max_ratio_to_floor, 2.0000) as max_ratio_to_floor,
      rule.id as rule_id,
      case
        when coalesce(ls.floor_price_kcoin, cf.floor_price_kcoin) is null
          or coalesce(ls.floor_price_kcoin, cf.floor_price_kcoin) <= 0
          then lower(coalesce(nullif(l.price_health, ''), 'unknown'))
        when l.unit_price_kcoin < floor(coalesce(ls.floor_price_kcoin, cf.floor_price_kcoin) * coalesce(rule.min_ratio_to_floor, 0.5000))
          then 'too_low'
        when l.unit_price_kcoin > ceiling(coalesce(ls.floor_price_kcoin, cf.floor_price_kcoin) * coalesce(rule.max_ratio_to_floor, 2.0000))
          then 'too_high'
        else 'healthy'
      end as computed_price_health
    from active_listings l
    left join current_floors cf
      on cf.template_id = l.template_id
     and cf.form_id is not distinct from l.form_id
    left join latest_snapshots ls
      on ls.template_id = l.template_id
     and ls.form_id is not distinct from l.form_id
    left join lateral (
      select phr.id, phr.min_ratio_to_floor, phr.max_ratio_to_floor
      from market.price_health_rules phr
      where phr.active = true
        and (phr.template_id is null or phr.template_id = l.template_id)
        and (phr.rarity_code is null or upper(phr.rarity_code) = upper(l.rarity_code))
      order by
        case when phr.template_id = l.template_id then 0 else 1 end,
        case when upper(phr.rarity_code) = upper(l.rarity_code) then 0 else 1 end,
        phr.created_at desc,
        phr.id desc
      limit 1
    ) rule on true
  ),
  health_counts as (
    select
      computed_price_health,
      count(*)::integer as listing_count
    from classified
    group by computed_price_health
  ),
  abnormal_items as (
    select *
    from classified
    where computed_price_health in ('too_low', 'too_high')
    order by created_at desc, id desc
    limit 50
  ),
  rollup as (
    select
      count(*) filter (where computed_price_health in ('too_low', 'too_high'))::integer as abnormal_count,
      count(*) filter (where computed_price_health = 'too_low')::integer as low_count,
      count(*) filter (where computed_price_health = 'too_high')::integer as high_count
    from classified
  )
  select
    rollup.abnormal_count,
    coalesce((select jsonb_object_agg(computed_price_health, listing_count) from health_counts), '{}'::jsonb),
    jsonb_build_object(
      'totalCount', rollup.abnormal_count,
      'lowCount', rollup.low_count,
      'highCount', rollup.high_count,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'listingId', id,
            'sellerUserId', seller_user_id,
            'templateId', template_id,
            'formId', form_id,
            'rarityCode', rarity_code,
            'unitPriceKcoin', unit_price_kcoin,
            'remainingCount', remaining_count,
            'priceHealth', computed_price_health,
            'storedPriceHealth', coalesce(stored_price_health, 'unknown'),
            'referenceFloorPriceKcoin', reference_floor_price_kcoin,
            'ruleId', rule_id,
            'lowBps', floor(min_ratio_to_floor * 10000),
            'highBps', ceiling(max_ratio_to_floor * 10000),
            'createdAt', created_at
          )
          order by created_at desc, id desc
        )
        from abnormal_items
      ), '[]'::jsonb),
      'limit', 50,
      'truncated', rollup.abnormal_count > 50
    )
  into v_abnormal_listing_count, v_price_health_counts, v_abnormal_listings
  from rollup;

  with completed_orders as (
    select *
    from market.orders
    where status = 'completed'
      and created_at >= v_started_at
      and created_at <= v_now
  ),
  signals as (
    select
      o.id,
      o.listing_id,
      o.buyer_user_id,
      o.seller_user_id,
      o.total_price_kcoin,
      o.created_at,
      o.buyer_user_id = o.seller_user_id as same_user,
      exists (
        select 1
        from core.app_sessions buyer_session
        join core.app_sessions seller_session
          on seller_session.user_id = o.seller_user_id
         and seller_session.ip_hash = buyer_session.ip_hash
        where buyer_session.user_id = o.buyer_user_id
          and nullif(buyer_session.ip_hash, '') is not null
          and coalesce(buyer_session.last_seen_at, buyer_session.created_at) >= v_started_at - interval '30 days'
          and coalesce(seller_session.last_seen_at, seller_session.created_at) >= v_started_at - interval '30 days'
      ) as shared_ip_hash,
      exists (
        select 1
        from core.app_sessions buyer_session
        join core.app_sessions seller_session
          on seller_session.user_id = o.seller_user_id
         and seller_session.device_id = buyer_session.device_id
        where buyer_session.user_id = o.buyer_user_id
          and nullif(buyer_session.device_id, '') is not null
          and coalesce(buyer_session.last_seen_at, buyer_session.created_at) >= v_started_at - interval '30 days'
          and coalesce(seller_session.last_seen_at, seller_session.created_at) >= v_started_at - interval '30 days'
      ) or exists (
        select 1
        from core.user_wallets buyer_wallet
        join core.user_wallets seller_wallet
          on seller_wallet.user_id = o.seller_user_id
         and seller_wallet.wallet_device = buyer_wallet.wallet_device
        where buyer_wallet.user_id = o.buyer_user_id
          and nullif(buyer_wallet.wallet_device, '') is not null
          and buyer_wallet.status = 'connected'
          and seller_wallet.status = 'connected'
      ) as shared_device,
      exists (
        select 1
        from core.user_wallets buyer_wallet
        join core.user_wallets seller_wallet
          on seller_wallet.user_id = o.seller_user_id
         and seller_wallet.chain = buyer_wallet.chain
         and seller_wallet.network = buyer_wallet.network
         and seller_wallet.address = buyer_wallet.address
        where buyer_wallet.user_id = o.buyer_user_id
          and nullif(buyer_wallet.address, '') is not null
          and buyer_wallet.status = 'connected'
          and seller_wallet.status = 'connected'
      ) as shared_wallet_address,
      (
        select count(*)::integer
        from ops.risk_events re
        where re.created_at >= v_started_at - interval '30 days'
          and (
            re.user_id in (o.buyer_user_id, o.seller_user_id)
            or (re.source_type in ('market_order', 'market_listing') and re.source_id in (o.id, o.listing_id))
          )
      ) as related_risk_event_count
    from completed_orders o
  ),
  candidates as (
    select *
    from signals
    where same_user
       or shared_ip_hash
       or shared_device
       or shared_wallet_address
       or related_risk_event_count > 0
  ),
  candidate_items as (
    select *
    from candidates
    order by created_at desc, id desc
    limit 50
  ),
  rollup as (
    select
      count(*)::integer as candidate_count,
      count(*) filter (where same_user)::integer as same_user_count,
      count(*) filter (where shared_ip_hash)::integer as shared_ip_hash_count,
      count(*) filter (where shared_device)::integer as shared_device_count,
      count(*) filter (where shared_wallet_address)::integer as shared_wallet_address_count,
      count(*) filter (where related_risk_event_count > 0)::integer as related_risk_order_count,
      coalesce(sum(related_risk_event_count), 0)::integer as related_risk_event_count
    from candidates
  )
  select jsonb_build_object(
    'totalCandidateCount', rollup.candidate_count,
    'sameUserCount', rollup.same_user_count,
    'sharedIpHashCount', rollup.shared_ip_hash_count,
    'sharedDeviceCount', rollup.shared_device_count,
    'sharedWalletAddressCount', rollup.shared_wallet_address_count,
    'relatedRiskOrderCount', rollup.related_risk_order_count,
    'relatedRiskEventCount', rollup.related_risk_event_count,
    'lookbackDays', 30,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'orderId', id,
          'listingId', listing_id,
          'buyerUserId', buyer_user_id,
          'sellerUserId', seller_user_id,
          'totalPriceKcoin', total_price_kcoin,
          'createdAt', created_at,
          'matchedSignals', to_jsonb(array_remove(array[
            case when same_user then 'same_user' end,
            case when shared_ip_hash then 'shared_ip_hash' end,
            case when shared_device then 'shared_device' end,
            case when shared_wallet_address then 'shared_wallet_address' end,
            case when related_risk_event_count > 0 then 'related_risk_event' end
          ], null)),
          'relatedRiskEventCount', related_risk_event_count
        )
        order by created_at desc, id desc
      )
      from candidate_items
    ), '[]'::jsonb),
    'limit', 50,
    'truncated', rollup.candidate_count > 50,
    'privacy', 'Only booleans and counts are returned; raw device ids, wallet addresses and IP hashes are not exposed.'
  )
  into v_wash_trade_signals
  from rollup;

  with active_metrics as (
    select
      l.template_id,
      l.form_id,
      min(l.rarity_code) as rarity_code,
      min(l.unit_price_kcoin) as floor_price_kcoin,
      count(*)::integer as active_listing_count,
      coalesce(sum(l.remaining_count), 0)::integer as active_item_count,
      avg(l.unit_price_kcoin) as active_listing_avg_price_kcoin
    from market.listings l
    where l.status = 'active'
    group by l.template_id, l.form_id
  ),
  order_metrics as (
    select
      l.template_id,
      l.form_id,
      min(l.rarity_code) as rarity_code,
      count(o.id)::integer as completed_order_count,
      coalesce(sum(o.item_count), 0)::integer as completed_item_count,
      case
        when coalesce(sum(o.item_count), 0) > 0
          then coalesce(sum(o.total_price_kcoin), 0) / sum(o.item_count)
        else null
      end as completed_order_avg_price_kcoin
    from market.orders o
    join market.listings l on l.id = o.listing_id
    where o.status = 'completed'
      and o.created_at >= v_started_at
      and o.created_at <= v_now
    group by l.template_id, l.form_id
  ),
  latest_sales as (
    select distinct on (l.template_id, l.form_id)
      l.template_id,
      l.form_id,
      l.rarity_code,
      o.id as order_id,
      o.listing_id,
      o.unit_price_kcoin,
      coalesce(o.completed_at, o.created_at) as sold_at
    from market.orders o
    join market.listings l on l.id = o.listing_id
    where o.status = 'completed'
      and o.created_at >= v_started_at
      and o.created_at <= v_now
    order by l.template_id, l.form_id, coalesce(o.completed_at, o.created_at) desc, o.id desc
  ),
  metric_keys as (
    select template_id, form_id from active_metrics
    union
    select template_id, form_id from order_metrics
    union
    select template_id, form_id from latest_sales
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'templateId', k.template_id,
      'templateName', t.display_name,
      'templateSlug', t.slug,
      'formId', k.form_id,
      'formName', f.display_name,
      'rarityCode', coalesce(a.rarity_code, o.rarity_code, s.rarity_code),
      'floorPriceKcoin', a.floor_price_kcoin,
      'activeListingAvgPriceKcoin', a.active_listing_avg_price_kcoin,
      'completedOrderAvgPriceKcoin', o.completed_order_avg_price_kcoin,
      'lastSalePriceKcoin', s.unit_price_kcoin,
      'lastSaleOrderId', s.order_id,
      'lastSaleListingId', s.listing_id,
      'lastSaleAt', s.sold_at,
      'activeListingCount', coalesce(a.active_listing_count, 0),
      'completedOrderCount', coalesce(o.completed_order_count, 0),
      'saleCount24h', coalesce(o.completed_item_count, 0),
      'snapshotAt', v_now
    )
    order by t.display_name nulls last, f.display_name nulls last, k.template_id, k.form_id
  ), '[]'::jsonb)
  into v_price_references
  from metric_keys k
  left join active_metrics a
    on a.template_id = k.template_id
   and a.form_id is not distinct from k.form_id
  left join order_metrics o
    on o.template_id = k.template_id
   and o.form_id is not distinct from k.form_id
  left join latest_sales s
    on s.template_id = k.template_id
   and s.form_id is not distinct from k.form_id
  left join catalog.collectible_templates t on t.id = k.template_id
  left join catalog.collectible_forms f on f.id = k.form_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'listingId', item ->> 'listingId',
      'status', 'active',
      'priceHealth', item ->> 'priceHealth',
      'templateId', item ->> 'templateId',
      'formId', item ->> 'formId',
      'rarityCode', item ->> 'rarityCode',
      'unitPriceKcoin', item -> 'unitPriceKcoin',
      'floorPriceKcoin', item -> 'referenceFloorPriceKcoin',
      'referencePriceKcoin', item -> 'referenceFloorPriceKcoin',
      'ruleId', item ->> 'ruleId',
      'ratioBps', case
        when nullif(item ->> 'referenceFloorPriceKcoin', '') is null
          or (item ->> 'referenceFloorPriceKcoin')::numeric = 0 then null
        else floor(((item ->> 'unitPriceKcoin')::numeric * 10000) / (item ->> 'referenceFloorPriceKcoin')::numeric)
      end,
      'ruleSummary', concat(
        'low ',
        coalesce(item ->> 'lowBps', '-'),
        ' / high ',
        coalesce(item ->> 'highBps', '-')
      ),
      'reason', item ->> 'priceHealth',
      'detectedAt', item ->> 'createdAt'
    )
    order by item ->> 'createdAt' desc, item ->> 'listingId'
  ), '[]'::jsonb)
  into v_price_health_findings
  from jsonb_array_elements(coalesce(v_abnormal_listings -> 'items', '[]'::jsonb)) item;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', item ->> 'orderId',
      'riskEventId', null,
      'status', 'review',
      'sellerUserId', item ->> 'sellerUserId',
      'buyerUserId', item ->> 'buyerUserId',
      'orderCount', 1,
      'listingCount', 1,
      'totalVolumeKcoin', item -> 'totalPriceKcoin',
      'sharedDeviceCount', case when (item -> 'matchedSignals') ? 'shared_device' then 1 else 0 end,
      'sharedWalletCount', case when (item -> 'matchedSignals') ? 'shared_wallet_address' then 1 else 0 end,
      'sharedIpHashCount', case when (item -> 'matchedSignals') ? 'shared_ip_hash' then 1 else 0 end,
      'evidenceSummary', concat('signals: ', array_to_string(ARRAY(select jsonb_array_elements_text(item -> 'matchedSignals')), ', ')),
      'detectedAt', item ->> 'createdAt',
      'relatedListingIds', jsonb_build_array(item ->> 'listingId'),
      'relatedOrderIds', jsonb_build_array(item ->> 'orderId')
    )
    order by item ->> 'createdAt' desc, item ->> 'orderId'
  ), '[]'::jsonb)
  into v_suspicious_trade_groups
  from jsonb_array_elements(coalesce(v_wash_trade_signals -> 'items', '[]'::jsonb)) item;

  v_fee_revenue_sources := jsonb_build_array(
    jsonb_build_object(
      'source', 'market.fee_settlements',
      'sourceLabel', 'Market fee settlements',
      'currencyCode', 'KCOIN',
      'amountKcoin', v_fee_revenue,
      'orderCount', v_completed_order_count,
      'settlementCount', v_fee_settlement_count,
      'status', 'settled',
      'updatedAt', v_now
    )
  );

  select count(*)::integer
  into v_price_snapshot_count
  from market.price_snapshots
  where snapshot_at >= v_started_at
    and snapshot_at <= v_now;

  select count(*)::integer
  into v_depth_snapshot_count
  from market.depth_snapshots
  where snapshot_at >= v_started_at
    and snapshot_at <= v_now;

  return jsonb_build_object(
    'activeListingCount', v_active_listing_count,
    'activeListingItemCount', v_active_item_count,
    'activeListingValueKcoin', v_total_listing_value,
    'totalListingValueKcoin', v_total_listing_value,
    'volume24hKcoin', v_volume,
    'windowVolumeKcoin', v_volume,
    'feeRevenueKcoin', v_fee_revenue,
    'orderFeeRevenueKcoin', v_order_fee_revenue,
    'abnormalListingCount', v_abnormal_listing_count,
    'statusCounts', v_status_counts,
    'priceHealthCounts', v_price_health_counts,
    'priceReferences', v_price_references,
    'priceHealthFindings', v_price_health_findings,
    'suspiciousTradeGroups', v_suspicious_trade_groups,
    'feeRevenueSources', v_fee_revenue_sources,
    'floorPrices', v_floor_prices,
    'floorPriceByTemplateForm', v_floor_prices,
    'averagePrices', jsonb_build_object(
      'activeListings', jsonb_build_object(
        'scope', 'active_listings',
        'listingCount', v_active_listing_count,
        'itemCount', v_active_item_count,
        'averageUnitPriceKcoin', v_active_avg_unit_price,
        'weightedAverageUnitPriceKcoin', v_active_weighted_avg_unit_price,
        'items', v_active_average_prices
      ),
      'completedOrders', jsonb_build_object(
        'scope', 'completed_market_orders',
        'orderCount', v_completed_order_count,
        'averageUnitPriceKcoin', v_order_avg_unit_price,
        'weightedAverageUnitPriceKcoin', v_order_weighted_avg_unit_price,
        'items', v_order_average_prices
      )
    ),
    'recentSalePrices', v_recent_sale_prices,
    'recentSales', v_recent_sale_prices,
    'latestSale', v_latest_sale,
    'abnormalListings', v_abnormal_listings,
    'priceHealthWarnings', v_price_health_findings,
    'washTradeSignals', v_wash_trade_signals,
    'selfTradeWarnings', v_suspicious_trade_groups,
    'platformFeeRevenue', jsonb_build_object(
      'amountKcoin', v_fee_revenue,
      'settlementAmountKcoin', v_fee_revenue,
      'orderFeeAmountKcoin', v_order_fee_revenue,
      'currencyCode', 'KCOIN',
      'source', 'market.fee_settlements',
      'settlementStatus', 'settled',
      'settlementCount', v_fee_settlement_count
    ),
    'window', jsonb_build_object(
      'hours', v_window_hours,
      'startedAt', v_started_at,
      'endedAt', v_now
    ),
    'sources', jsonb_build_object(
      'marketListings', jsonb_build_object(
        'schema', 'market',
        'table', 'listings',
        'aggregation', 'active count, quantity, value, floor, active averages and rule-based health counts'
      ),
      'marketOrders', jsonb_build_object(
        'schema', 'market',
        'table', 'orders',
        'filters', jsonb_build_object('createdAtGte', v_started_at, 'createdAtLte', v_now),
        'windowColumn', 'created_at',
        'aggregation', 'completed volume, completed averages and latest sale prices'
      ),
      'marketFeeSettlements', jsonb_build_object(
        'schema', 'market',
        'table', 'fee_settlements',
        'filters', jsonb_build_object('status', 'settled', 'currencyCode', 'KCOIN'),
        'joinedTable', 'market.orders',
        'fallbackReference', 'market.orders.fee_amount_kcoin',
        'aggregation', 'settled platform fee revenue for completed orders in the stats window'
      ),
      'marketPriceSnapshots', jsonb_build_object(
        'schema', 'market',
        'table', 'price_snapshots',
        'sampledRows', v_price_snapshot_count,
        'usage', 'reference floor for rule-based price health when available'
      ),
      'marketDepthSnapshots', jsonb_build_object(
        'schema', 'market',
        'table', 'depth_snapshots',
        'sampledRows', v_depth_snapshot_count
      ),
      'marketPriceHealthRules', jsonb_build_object(
        'schema', 'market',
        'table', 'price_health_rules',
        'aggregation', 'active template/rarity rule matched to active listings'
      ),
      'washTradeSignals', jsonb_build_object(
        'tables', jsonb_build_array(
          'market.orders',
          'core.app_sessions',
          'core.user_wallets',
          'ops.risk_events'
        ),
        'lookbackDays', 30,
        'privacy', 'raw device ids, wallet addresses and IP hashes are only matched inside the RPC and are not returned'
      )
    ),
    'serverTime', v_now
  );
end;
$$;

create or replace function api.admin_list_market_listings(
  p_admin_user_id uuid,
  p_status text default null,
  p_rarity_code text default null,
  p_template_id uuid default null,
  p_form_id uuid default null,
  p_min_price_kcoin numeric default null,
  p_max_price_kcoin numeric default null,
  p_seller_user_id uuid default null,
  p_price_health text default null,
  p_limit integer default 20,
  p_cursor integer default 0,
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
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_rarity_code text := upper(nullif(trim(coalesce(p_rarity_code, '')), ''));
  v_price_health text := lower(nullif(trim(coalesce(p_price_health, '')), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_cursor, 0), 0);
  v_items jsonb := '[]'::jsonb;
  v_row_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:read', 'admin:read']);

  if v_status is not null and v_status not in ('active', 'sold', 'partially_sold', 'cancelled', 'expired', 'suspended') then
    raise exception 'ADMIN_MARKET_LISTING_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_price_health is not null and v_price_health not in ('too_low', 'healthy', 'too_high', 'unknown') then
    raise exception 'ADMIN_MARKET_LISTING_PRICE_HEALTH_INVALID' using errcode = 'P0001';
  end if;

  if p_min_price_kcoin is not null and p_min_price_kcoin < 0 then
    raise exception 'ADMIN_MARKET_LISTING_MIN_PRICE_INVALID' using errcode = 'P0001';
  end if;

  if p_max_price_kcoin is not null and p_max_price_kcoin < 0 then
    raise exception 'ADMIN_MARKET_LISTING_MAX_PRICE_INVALID' using errcode = 'P0001';
  end if;

  if p_min_price_kcoin is not null and p_max_price_kcoin is not null and p_min_price_kcoin > p_max_price_kcoin then
    raise exception 'ADMIN_MARKET_LISTING_PRICE_RANGE_INVALID' using errcode = 'P0001';
  end if;

  with filtered as (
    select
      l.*,
      u.telegram_user_id,
      t.display_name as template_name,
      t.slug as template_slug,
      f.display_name as form_name,
      exists (
        select 1
        from inventory.inventory_locks il
        join market.listing_items li on li.item_instance_id = il.item_instance_id
        where li.listing_id = l.id
          and li.status = 'reserved'
          and il.user_id = l.seller_user_id
          and il.lock_type = 'market_listing'
          and il.source_type = 'market_listing'
          and il.source_id = l.id
          and il.status = 'active'
      ) as has_active_lock
    from market.listings l
    left join core.users u on u.id = l.seller_user_id
    left join catalog.collectible_templates t on t.id = l.template_id
    left join catalog.collectible_forms f on f.id = l.form_id
    where (v_status is null or l.status = v_status)
      and (v_rarity_code is null or upper(l.rarity_code) = v_rarity_code)
      and (p_template_id is null or l.template_id = p_template_id)
      and (p_form_id is null or l.form_id = p_form_id)
      and (p_seller_user_id is null or l.seller_user_id = p_seller_user_id)
      and (v_price_health is null or lower(coalesce(l.price_health, 'unknown')) = v_price_health)
      and (p_min_price_kcoin is null or l.unit_price_kcoin >= p_min_price_kcoin)
      and (p_max_price_kcoin is null or l.unit_price_kcoin <= p_max_price_kcoin)
    order by l.created_at desc, l.id desc
    limit v_limit + 1
    offset v_offset
  ),
  page_rows as (
    select *
    from filtered
    limit v_limit
  ),
  mapped as (
    select
      *,
      case
        when status = 'active' and lower(coalesce(price_health, 'unknown')) = 'too_low' then jsonb_build_array('low_price')
        when status = 'active' and lower(coalesce(price_health, 'unknown')) = 'too_high' then jsonb_build_array('high_price')
        when status = 'active' and has_active_lock = false then jsonb_build_array('lock')
        else '[]'::jsonb
      end as anomaly_types
    from page_rows
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'status', status,
        'sellerUserId', seller_user_id,
        'sellerTelegramId', telegram_user_id,
        'templateId', template_id,
        'templateName', template_name,
        'templateSlug', template_slug,
        'formId', form_id,
        'formName', form_name,
        'rarityCode', rarity_code,
        'itemCount', item_count,
        'remainingCount', remaining_count,
        'unitPriceKcoin', unit_price_kcoin,
        'totalPriceKcoin', unit_price_kcoin * remaining_count,
        'feeBps', fee_bps,
        'feeAmountKcoin', floor((unit_price_kcoin * remaining_count) * fee_bps / 10000),
        'expectedNetAmount', expected_net_amount,
        'priceHealth', coalesce(price_health, 'unknown'),
        'abnormalReasons', anomaly_types,
        'anomalyTypes', anomaly_types,
        'lockStatus', case
          when status = 'active' and has_active_lock = false then 'abnormal'
          when status = 'active' then 'active'
          else null
        end,
        'expiresAt', expires_at,
        'lastPriceChangedAt', last_price_changed_at,
        'createdAt', created_at,
        'updatedAt', updated_at
      )
      order by created_at desc, id desc
    ), '[]'::jsonb)
  into v_row_count, v_items
  from mapped;

  return jsonb_build_object(
    'items', v_items,
    'summary', jsonb_build_object(
      'returnedRows', least(v_row_count, v_limit),
      'limit', v_limit,
      'offset', v_offset
    ),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'sources', jsonb_build_object(
      'marketListings', jsonb_build_object(
        'schema', 'market',
        'table', 'listings',
        'limit', v_limit,
        'offset', v_offset,
        'truncated', v_row_count > v_limit
      )
    ),
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_list_market_price_rules(
  p_admin_user_id uuid,
  p_active boolean default null,
  p_limit integer default 20,
  p_cursor integer default 0,
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
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_cursor, 0), 0);
  v_items jsonb := '[]'::jsonb;
  v_fee_rules jsonb := '[]'::jsonb;
  v_row_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:read', 'admin:read']);

  with filtered as (
    select *
    from catalog.market_price_rules
    where p_active is null or active = p_active
    order by active desc, updated_at desc, created_at desc, id desc
    limit v_limit + 1
    offset v_offset
  ),
  page_rows as (
    select *
    from filtered
    limit v_limit
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'templateId', template_id,
        'formIndex', form_index,
        'rarityCode', rarity_code,
        'minPriceKcoin', min_price_kcoin,
        'maxPriceKcoin', max_price_kcoin,
        'suggestedPriceKcoin', suggested_price_kcoin,
        'active', active,
        'metadata', metadata,
        'createdAt', created_at,
        'updatedAt', updated_at
      )
      order by active desc, updated_at desc, created_at desc, id desc
    ), '[]'::jsonb)
  into v_row_count, v_items
  from page_rows;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'code', code,
      'feeType', fee_type,
      'currencyCode', currency_code,
      'feeBps', fee_bps,
      'minFee', min_fee,
      'maxFee', max_fee,
      'startsAt', starts_at,
      'endsAt', ends_at,
      'active', active,
      'metadata', metadata,
      'createdAt', created_at,
      'updatedAt', updated_at
    )
    order by active desc, code
  ), '[]'::jsonb)
  into v_fee_rules
  from economy.fee_rules
  where fee_type = 'market_sell';

  return jsonb_build_object(
    'items', v_items,
    'feeRules', v_fee_rules,
    'fee_rules', v_fee_rules,
    'summary', jsonb_build_object('returnedRows', least(v_row_count, v_limit), 'limit', v_limit, 'offset', v_offset),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'sources', jsonb_build_object(
      'marketPriceRules', jsonb_build_object('schema', 'catalog', 'table', 'market_price_rules'),
      'feeRules', jsonb_build_object('schema', 'economy', 'table', 'fee_rules', 'filter', 'fee_type=market_sell')
    ),
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_list_market_health_rules(
  p_admin_user_id uuid,
  p_active boolean default null,
  p_rarity_code text default null,
  p_template_id uuid default null,
  p_limit integer default 20,
  p_cursor integer default 0,
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
  v_rarity_code text := upper(nullif(trim(coalesce(p_rarity_code, '')), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_cursor, 0), 0);
  v_items jsonb := '[]'::jsonb;
  v_row_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:read', 'admin:read']);

  with filtered as (
    select *
    from market.price_health_rules
    where (p_active is null or active = p_active)
      and (v_rarity_code is null or upper(rarity_code) = v_rarity_code)
      and (p_template_id is null or template_id = p_template_id)
    order by active desc, updated_at desc, created_at desc, id desc
    limit v_limit + 1
    offset v_offset
  ),
  page_rows as (
    select *
    from filtered
    limit v_limit
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'templateId', template_id,
        'rarityCode', rarity_code,
        'minRatioToFloor', min_ratio_to_floor,
        'maxRatioToFloor', max_ratio_to_floor,
        'lowBps', floor(min_ratio_to_floor * 10000),
        'highBps', ceiling(max_ratio_to_floor * 10000),
        'active', active,
        'metadata', metadata,
        'createdAt', created_at,
        'updatedAt', updated_at
      )
      order by active desc, updated_at desc, created_at desc, id desc
    ), '[]'::jsonb)
  into v_row_count, v_items
  from page_rows;

  return jsonb_build_object(
    'items', v_items,
    'summary', jsonb_build_object('returnedRows', least(v_row_count, v_limit), 'limit', v_limit, 'offset', v_offset),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'sources', jsonb_build_object(
      'marketPriceHealthRules', jsonb_build_object('schema', 'market', 'table', 'price_health_rules')
    ),
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_upsert_market_price_rule(
  p_admin_user_id uuid,
  p_price_rule_id uuid default null,
  p_template_id uuid default null,
  p_rarity_code text default null,
  p_form_index integer default null,
  p_min_price_kcoin numeric default null,
  p_max_price_kcoin numeric default null,
  p_suggested_price_kcoin numeric default null,
  p_active boolean default true,
  p_metadata jsonb default '{}'::jsonb,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_rule catalog.market_price_rules%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_risk_event_id uuid;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.upsert_market_price_rule';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_rarity_code text := upper(nullif(trim(coalesce(p_rarity_code, '')), ''));
  v_active boolean := coalesce(p_active, true);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:write', 'admin:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_MARKET_PRICE_RULE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_form_index is not null and p_form_index < 1 then
    raise exception 'ADMIN_MARKET_PRICE_RULE_FORM_INVALID' using errcode = 'P0001';
  end if;

  if p_min_price_kcoin is null or p_min_price_kcoin < 0 then
    raise exception 'ADMIN_MARKET_PRICE_RULE_MIN_INVALID' using errcode = 'P0001';
  end if;

  if p_max_price_kcoin is not null and p_max_price_kcoin < p_min_price_kcoin then
    raise exception 'ADMIN_MARKET_PRICE_RULE_MAX_INVALID' using errcode = 'P0001';
  end if;

  if p_suggested_price_kcoin is not null and p_suggested_price_kcoin < 0 then
    raise exception 'ADMIN_MARKET_PRICE_RULE_SUGGESTED_INVALID' using errcode = 'P0001';
  end if;

  if p_template_id is not null
     and not exists (select 1 from catalog.collectible_templates where id = p_template_id) then
    raise exception 'ADMIN_MARKET_PRICE_RULE_TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_rarity_code is not null
     and not exists (select 1 from catalog.rarities where code = v_rarity_code) then
    raise exception 'ADMIN_MARKET_PRICE_RULE_RARITY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_price_rule_id is not null then
    select *
    into v_rule
    from catalog.market_price_rules
    where id = p_price_rule_id
    for update;
  else
    select *
    into v_rule
    from catalog.market_price_rules
    where template_id is not distinct from p_template_id
      and rarity_code is not distinct from v_rarity_code
      and form_index is not distinct from p_form_index
    order by active desc, updated_at desc, created_at desc
    limit 1
    for update;
  end if;

  if found then
    v_before := to_jsonb(v_rule);
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'price_rule_id', p_price_rule_id,
    'template_id', p_template_id,
    'rarity_code', v_rarity_code,
    'form_index', p_form_index,
    'min_price_kcoin', p_min_price_kcoin,
    'max_price_kcoin', p_max_price_kcoin,
    'suggested_price_kcoin', p_suggested_price_kcoin,
    'active', v_active,
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_rule.id is null then
    insert into catalog.market_price_rules (
      id,
      template_id,
      rarity_code,
      form_index,
      min_price_kcoin,
      max_price_kcoin,
      suggested_price_kcoin,
      active,
      metadata,
      updated_at
    )
    values (
      coalesce(p_price_rule_id, gen_random_uuid()),
      p_template_id,
      v_rarity_code,
      p_form_index,
      p_min_price_kcoin,
      p_max_price_kcoin,
      p_suggested_price_kcoin,
      v_active,
      v_metadata,
      v_now
    )
    returning * into v_rule;
  else
    update catalog.market_price_rules
    set template_id = p_template_id,
        rarity_code = v_rarity_code,
        form_index = p_form_index,
        min_price_kcoin = p_min_price_kcoin,
        max_price_kcoin = p_max_price_kcoin,
        suggested_price_kcoin = p_suggested_price_kcoin,
        active = v_active,
        metadata = v_metadata,
        updated_at = v_now
    where id = v_rule.id
    returning * into v_rule;
  end if;

  v_after := to_jsonb(v_rule);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'market.price_rule.upsert',
    'catalog',
    'market_price_rules',
    v_rule.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    source_id,
    score_delta,
    detail
  )
  values (
    'market_price_manipulation',
    'low',
    'open',
    'admin_market_price_rule',
    v_rule.id,
    0,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'reason', v_reason,
      'before', v_before,
      'after', v_after
    )
  )
  returning id into v_risk_event_id;

  v_response := jsonb_build_object(
    'price_rule_id', v_rule.id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'risk_event_id', v_risk_event_id,
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_upsert_market_health_rule(
  p_admin_user_id uuid,
  p_health_rule_id uuid default null,
  p_rarity_code text default null,
  p_template_id uuid default null,
  p_min_ratio_to_floor numeric default null,
  p_max_ratio_to_floor numeric default null,
  p_active boolean default true,
  p_metadata jsonb default '{}'::jsonb,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_rule market.price_health_rules%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_risk_event_id uuid;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.upsert_market_health_rule';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_rarity_code text := upper(nullif(trim(coalesce(p_rarity_code, '')), ''));
  v_active boolean := coalesce(p_active, true);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:write', 'admin:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_min_ratio_to_floor is null or p_max_ratio_to_floor is null then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_RATIO_REQUIRED' using errcode = 'P0001';
  end if;

  if not (p_min_ratio_to_floor >= 0 and p_min_ratio_to_floor < 1 and p_max_ratio_to_floor > 1) then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_RATIO_INVALID' using errcode = 'P0001';
  end if;

  if p_min_ratio_to_floor >= p_max_ratio_to_floor then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_RATIO_RANGE_INVALID' using errcode = 'P0001';
  end if;

  if p_template_id is not null
     and not exists (select 1 from catalog.collectible_templates where id = p_template_id) then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_rarity_code is not null
     and not exists (select 1 from catalog.rarities where code = v_rarity_code) then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_RARITY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_health_rule_id is not null then
    select *
    into v_rule
    from market.price_health_rules
    where id = p_health_rule_id
    for update;
  else
    select *
    into v_rule
    from market.price_health_rules
    where template_id is not distinct from p_template_id
      and rarity_code is not distinct from v_rarity_code
    order by active desc, updated_at desc, created_at desc
    limit 1
    for update;
  end if;

  if found then
    v_before := to_jsonb(v_rule);
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'health_rule_id', p_health_rule_id,
    'template_id', p_template_id,
    'rarity_code', v_rarity_code,
    'min_ratio_to_floor', p_min_ratio_to_floor,
    'max_ratio_to_floor', p_max_ratio_to_floor,
    'active', v_active,
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_rule.id is null then
    insert into market.price_health_rules (
      id,
      rarity_code,
      template_id,
      min_ratio_to_floor,
      max_ratio_to_floor,
      active,
      metadata,
      updated_at
    )
    values (
      coalesce(p_health_rule_id, gen_random_uuid()),
      v_rarity_code,
      p_template_id,
      p_min_ratio_to_floor,
      p_max_ratio_to_floor,
      v_active,
      v_metadata,
      v_now
    )
    returning * into v_rule;
  else
    update market.price_health_rules
    set rarity_code = v_rarity_code,
        template_id = p_template_id,
        min_ratio_to_floor = p_min_ratio_to_floor,
        max_ratio_to_floor = p_max_ratio_to_floor,
        active = v_active,
        metadata = v_metadata,
        updated_at = v_now
    where id = v_rule.id
    returning * into v_rule;
  end if;

  perform api.market_refresh_price_stats();

  v_after := to_jsonb(v_rule);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'market.price_health_rule.upsert',
    'market',
    'price_health_rules',
    v_rule.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    source_id,
    score_delta,
    detail
  )
  values (
    'market_price_manipulation',
    'low',
    'open',
    'admin_market_health_rule',
    v_rule.id,
    0,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'reason', v_reason,
      'before', v_before,
      'after', v_after
    )
  )
  returning id into v_risk_event_id;

  v_response := jsonb_build_object(
    'health_rule_id', v_rule.id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'risk_event_id', v_risk_event_id,
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_force_cancel_market_listing(
  p_admin_user_id uuid,
  p_listing_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_listing market.listings%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_risk_event_id uuid;
  v_response jsonb;
  v_item_ids uuid[] := array[]::uuid[];
  v_released_lock_count integer := 0;
  v_now timestamptz := now();
  v_scope text := 'admin.force_cancel_market_listing';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:write', 'admin:write']);

  if p_listing_id is null then
    raise exception 'ADMIN_MARKET_LISTING_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'listing_id', p_listing_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'ADMIN_MARKET_LISTING_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'ADMIN_MARKET_LISTING_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_listing);

  select coalesce(array_agg(li.item_instance_id order by li.created_at), array[]::uuid[])
  into v_item_ids
  from market.listing_items li
  where li.listing_id = p_listing_id
    and li.status = 'reserved';

  update market.listings
  set status = 'cancelled',
      remaining_count = 0,
      expected_net_amount = 0,
      updated_at = v_now
  where id = p_listing_id
  returning * into v_listing;

  update market.listing_items
  set status = 'cancelled'
  where listing_id = p_listing_id
    and status = 'reserved';

  if cardinality(v_item_ids) > 0 then
    update inventory.item_instances
    set status = 'available',
        updated_at = v_now,
        lock_version = lock_version + 1
    where id = any(v_item_ids)
      and owner_user_id = v_listing.seller_user_id
      and status = 'listed';

    update inventory.inventory_locks
    set status = 'released',
        released_at = v_now,
        updated_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'admin_force_cancel', true,
          'admin_user_id', p_admin_user_id,
          'reason', v_reason
        )
    where item_instance_id = any(v_item_ids)
      and user_id = v_listing.seller_user_id
      and lock_type = 'market_listing'
      and source_type = 'market_listing'
      and source_id = p_listing_id
      and status = 'active';
    get diagnostics v_released_lock_count = row_count;

    insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
    select x.id, v_listing.seller_user_id, 'delisted', 'market_listing', p_listing_id,
           jsonb_build_object(
             'listing_id', p_listing_id,
             'reason', v_reason,
             'admin_force_cancel', true,
             'admin_user_id', p_admin_user_id
           )
    from unnest(v_item_ids) as x(id);
  end if;

  v_after := to_jsonb(v_listing);

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state, metadata)
  values (
    p_listing_id,
    v_listing.seller_user_id,
    'cancelled',
    v_before,
    v_after,
    jsonb_build_object(
      'reason', v_reason,
      'admin_force_cancel', true,
      'admin_user_id', p_admin_user_id,
      'idempotency_key', v_key,
      'released_lock_count', v_released_lock_count
    )
  );

  insert into core.notifications (user_id, notification_type, title, body, payload)
  values (
    v_listing.seller_user_id,
    'market_listing_force_cancelled',
    'Market listing cancelled',
    'Your marketplace listing was cancelled by operations.',
    jsonb_build_object(
      'listing_id', p_listing_id,
      'reason', v_reason,
      'admin_force_cancel', true
    )
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'market.listing.force_cancel',
    'market',
    'listings',
    p_listing_id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  insert into ops.risk_events (
    user_id,
    event_type,
    severity,
    status,
    source_type,
    source_id,
    score_delta,
    detail
  )
  values (
    v_listing.seller_user_id,
    'market_abnormal_cancel_rate',
    case when coalesce(v_before ->> 'price_health', 'unknown') in ('too_low', 'too_high') then 'medium' else 'low' end,
    'open',
    'market_listing',
    p_listing_id,
    0,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'reason', v_reason,
      'before', v_before,
      'after', v_after
    )
  )
  returning id into v_risk_event_id;

  v_response := jsonb_build_object(
    'listing_id', p_listing_id,
    'previous_status', v_before ->> 'status',
    'status', v_listing.status,
    'released_item_instance_ids', to_jsonb(v_item_ids),
    'released_lock_count', v_released_lock_count,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'risk_event_id', v_risk_event_id,
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function api.admin_get_market_ops_stats(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_list_market_listings(uuid, text, text, uuid, uuid, numeric, numeric, uuid, text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_list_market_price_rules(uuid, boolean, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_list_market_health_rules(uuid, boolean, text, uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_upsert_market_price_rule(uuid, uuid, uuid, text, integer, numeric, numeric, numeric, boolean, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_force_cancel_market_listing(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function api.admin_get_market_ops_stats(uuid, integer, jsonb) to service_role;
grant execute on function api.admin_list_market_listings(uuid, text, text, uuid, uuid, numeric, numeric, uuid, text, integer, integer, jsonb) to service_role;
grant execute on function api.admin_list_market_price_rules(uuid, boolean, integer, integer, jsonb) to service_role;
grant execute on function api.admin_list_market_health_rules(uuid, boolean, text, uuid, integer, integer, jsonb) to service_role;
grant execute on function api.admin_upsert_market_price_rule(uuid, uuid, uuid, text, integer, numeric, numeric, numeric, boolean, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_force_cancel_market_listing(uuid, uuid, text, text, jsonb) to service_role;

comment on function api.admin_get_market_ops_stats(uuid, integer, jsonb) is
  'Phase 6 market ops stats facade for admin API.';
comment on function api.admin_list_market_listings(uuid, text, text, uuid, uuid, numeric, numeric, uuid, text, integer, integer, jsonb) is
  'Phase 6 paginated admin listing search facade.';
comment on function api.admin_list_market_price_rules(uuid, boolean, integer, integer, jsonb) is
  'Phase 6 admin read facade for catalog.market_price_rules.';
comment on function api.admin_list_market_health_rules(uuid, boolean, text, uuid, integer, integer, jsonb) is
  'Phase 6 admin read facade for market.price_health_rules.';
comment on function api.admin_upsert_market_price_rule(uuid, uuid, uuid, text, integer, numeric, numeric, numeric, boolean, jsonb, text, text, jsonb) is
  'Phase 6 audited admin write facade for catalog.market_price_rules.';
comment on function api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb) is
  'Phase 6 audited admin write facade for market.price_health_rules.';
comment on function api.admin_force_cancel_market_listing(uuid, uuid, text, text, jsonb) is
  'Phase 6 audited admin force-cancel RPC for active market listings.';

commit;
