-- Phase 6 step 2.9 market operations admin API RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.raises_like(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm like p_pattern;
end;
$$;

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null
)
returns uuid
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := api.auth_upsert_telegram_user(
    p_telegram_user_id := p_telegram_user_id,
    p_username := coalesce(p_username, 'u' || p_telegram_user_id::text),
    p_first_name := 'Test',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true)
  );

  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.create_catalog_fixture(
  p_prefix text,
  p_rarity_code text default 'COMMON'
)
returns jsonb
language plpgsql
as $$
declare
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_form_id uuid;
begin
  insert into catalog.series (slug, display_name, status)
  values (p_prefix || '-series', 'Test Series ' || p_prefix, 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Test Faction ' || p_prefix)
  on conflict (slug) do update
  set display_name = excluded.display_name,
      updated_at = now()
  returning id into v_faction_id;

  insert into catalog.collectible_templates (
    slug,
    display_name,
    subtitle,
    description,
    rarity_code,
    type_code,
    series_id,
    faction_id,
    base_power,
    max_level,
    release_status,
    tradeable,
    upgradeable,
    evolvable,
    decomposable,
    nft_mintable,
    sort_order
  )
  values (
    p_prefix || '-template',
    'Test Collectible ' || p_prefix,
    'fixture',
    'test fixture collectible',
    p_rarity_code,
    'CHARACTER',
    v_series_id,
    v_faction_id,
    10,
    100,
    'active',
    true,
    true,
    true,
    true,
    true,
    10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      tradeable = true,
      updated_at = now()
  returning id into v_template_id;

  insert into catalog.collectible_forms (
    template_id,
    form_index,
    form_slug,
    display_name,
    description,
    image_url,
    thumbnail_url,
    avatar_url,
    base_power_bonus,
    is_default
  )
  values (
    v_template_id,
    1,
    'base',
    'Base Form',
    'Base form',
    'https://example.test/' || p_prefix || '/base.png',
    'https://example.test/' || p_prefix || '/base-thumb.png',
    'https://example.test/' || p_prefix || '/base-avatar.png',
    0,
    true
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id into v_form_id;

  return jsonb_build_object(
    'series_id', v_series_id,
    'faction_id', v_faction_id,
    'template_id', v_template_id,
    'form_id', v_form_id,
    'rarity_code', p_rarity_code
  );
end;
$$;

create or replace function testutil.create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid
)
returns uuid
language plpgsql
as $$
declare
  v_item_id uuid;
begin
  insert into inventory.item_instances (
    owner_user_id,
    template_id,
    form_id,
    level,
    power,
    status,
    source_type,
    metadata
  )
  values (
    p_user_id,
    p_template_id,
    p_form_id,
    1,
    10,
    'available',
    'admin',
    jsonb_build_object('fixture', true)
  )
  returning id into v_item_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_item_id, p_user_id, 'created', 'admin', null, jsonb_build_object('fixture', true));

  return v_item_id;
end;
$$;

select no_plan();

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb
) on commit drop;

insert into ops.admin_users (id, email, display_name, status, metadata)
values (
  '69000000-0000-4000-8000-000000000001',
  'phase6-market-ops-admin@example.test',
  'Phase 6 Market Ops Admin',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_roles (code, display_name, permissions)
values (
  'PHASE6_MARKET_OPS_WRITE',
  'Phase 6 Market Ops Write',
  '["market:read","market:write"]'::jsonb
)
on conflict (code) do update
set permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select '69000000-0000-4000-8000-000000000001'::uuid, id, '69000000-0000-4000-8000-000000000001'::uuid
from ops.admin_roles
where code = 'PHASE6_MARKET_OPS_WRITE'
on conflict (admin_user_id, role_id) do nothing;

insert into _ids (key, id)
values
  ('actor', '69000000-0000-4000-8000-000000000001'),
  ('seller', testutil.make_user(6900001001, 'phase6_market_ops_seller')),
  ('buyer', testutil.make_user(6900001002, 'phase6_market_ops_buyer'));

insert into _ids (key, payload)
values ('catalog', testutil.create_catalog_fixture('phase6-market-ops', 'RARE'));

insert into _ids (key, id)
select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid
union all
select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;

insert into market.price_health_rules (
  rarity_code,
  template_id,
  min_ratio_to_floor,
  max_ratio_to_floor,
  active,
  metadata
)
values (
  'RARE',
  (select id from _ids where key = 'template'),
  0.7000,
  1.3000,
  true,
  '{"test":true,"source":"phase6_market_ops_admin_api"}'::jsonb
);

insert into market.price_snapshots (
  template_id,
  form_id,
  rarity_code,
  floor_price_kcoin,
  avg_price_kcoin,
  last_sale_price_kcoin,
  active_listing_count,
  sale_count_24h,
  volume_24h_kcoin,
  snapshot_at,
  metadata
)
values (
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form'),
  'RARE',
  100,
  100,
  null,
  1,
  0,
  0,
  now(),
  '{"test":true,"source":"phase6_market_ops_admin_api"}'::jsonb
);

insert into _ids (key, id)
select 'item', testutil.create_item(
  (select id from _ids where key = 'seller'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form')
)
union all
select 'low_item', testutil.create_item(
  (select id from _ids where key = 'seller'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form')
)
union all
select 'high_item', testutil.create_item(
  (select id from _ids where key = 'seller'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form')
)
union all
select 'order_item', testutil.create_item(
  (select id from _ids where key = 'seller'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form')
);

insert into _ids (key, payload)
values (
  'listing_create',
  api.market_create_listing(
    p_user_id := (select id from _ids where key = 'seller'),
    p_item_instance_ids := array[(select id from _ids where key = 'item')],
    p_unit_price_kcoin := 100,
    p_idempotency_key := 'phase6-market-ops-create-listing-001'
  )
),
(
  'low_listing_create',
  api.market_create_listing(
    p_user_id := (select id from _ids where key = 'seller'),
    p_item_instance_ids := array[(select id from _ids where key = 'low_item')],
    p_unit_price_kcoin := 60,
    p_idempotency_key := 'phase6-market-ops-create-listing-low-001'
  )
),
(
  'high_listing_create',
  api.market_create_listing(
    p_user_id := (select id from _ids where key = 'seller'),
    p_item_instance_ids := array[(select id from _ids where key = 'high_item')],
    p_unit_price_kcoin := 220,
    p_idempotency_key := 'phase6-market-ops-create-listing-high-001'
  )
),
(
  'order_listing_create',
  api.market_create_listing(
    p_user_id := (select id from _ids where key = 'seller'),
    p_item_instance_ids := array[(select id from _ids where key = 'order_item')],
    p_unit_price_kcoin := 150,
    p_idempotency_key := 'phase6-market-ops-create-listing-order-001'
  )
);

insert into _ids (key, id)
select 'listing', (payload ->> 'listing_id')::uuid
from _ids
where key = 'listing_create'
union all
select 'low_listing', (payload ->> 'listing_id')::uuid
from _ids
where key = 'low_listing_create'
union all
select 'high_listing', (payload ->> 'listing_id')::uuid
from _ids
where key = 'high_listing_create'
union all
select 'order_listing', (payload ->> 'listing_id')::uuid
from _ids
where key = 'order_listing_create';

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'buyer'),
    'KCOIN',
    1000,
    'test_setup',
    null,
    null,
    'phase6-market-ops-buyer-kcoin-001',
    'market ops stats fixture',
    '{}'::jsonb
  );

  perform api.auth_create_session(
    (select id from _ids where key = 'buyer'),
    'phase6-market-ops-buyer-session-hash',
    now() + interval '1 day',
    now(),
    'phase6-market-ops-buyer-init-hash',
    'same-ip-hash-for-market-ops',
    'buyer-agent',
    'same-device-for-market-ops',
    'ios'
  );

  perform api.auth_create_session(
    (select id from _ids where key = 'seller'),
    'phase6-market-ops-seller-session-hash',
    now() + interval '1 day',
    now(),
    'phase6-market-ops-seller-init-hash',
    'same-ip-hash-for-market-ops',
    'seller-agent',
    'same-device-for-market-ops',
    'ios'
  );
end;
$$;

insert into core.user_wallets (
  user_id,
  chain,
  network,
  address,
  wallet_app_name,
  wallet_device,
  is_primary,
  status,
  verified_at,
  metadata
)
values (
  (select id from _ids where key = 'buyer'),
  'TON',
  'testnet',
  'EQDphase6MarketOpsSharedWalletAddress',
  'Tonkeeper',
  'same-wallet-device-for-market-ops',
  true,
  'connected',
  now(),
  '{"test":true}'::jsonb
),
(
  (select id from _ids where key = 'seller'),
  'TON',
  'testnet',
  'EQDphase6MarketOpsSharedWalletAddress',
  'Tonkeeper',
  'same-wallet-device-for-market-ops',
  true,
  'connected',
  now(),
  '{"test":true}'::jsonb
)
on conflict (user_id, chain, network, address) do update
set wallet_device = excluded.wallet_device,
    status = excluded.status,
    verified_at = excluded.verified_at,
    updated_at = now();

insert into _ids (key, payload)
select 'order_buy', api.market_buy_listing(
  (select id from _ids where key = 'buyer'),
  (select id from _ids where key = 'order_listing'),
  1,
  150,
  'phase6-market-ops-buy-order-001'
);

insert into _ids (key, id)
select 'order', (payload ->> 'order_id')::uuid
from _ids
where key = 'order_buy';

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
  (select id from _ids where key = 'buyer'),
  'market_self_trade',
  'medium',
  'open',
  'market_order',
  (select id from _ids where key = 'order'),
  10,
  '{"test":true,"source":"phase6_market_ops_admin_api"}'::jsonb
);

select ok(
  to_regprocedure('api.admin_get_market_ops_stats(uuid,integer,jsonb)') is not null
    and to_regprocedure('api.admin_list_market_listings(uuid,text,text,uuid,uuid,numeric,numeric,uuid,text,integer,integer,jsonb)') is not null
    and to_regprocedure('api.admin_list_market_price_rules(uuid,boolean,integer,integer,jsonb)') is not null
    and to_regprocedure('api.admin_list_market_health_rules(uuid,boolean,text,uuid,uuid,integer,integer,jsonb)') is not null
    and to_regprocedure('api.admin_upsert_market_price_rule(uuid,uuid,uuid,text,integer,numeric,numeric,numeric,boolean,jsonb,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_upsert_market_health_rule(uuid,uuid,text,uuid,uuid,numeric,numeric,boolean,jsonb,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_upsert_market_fee_rule(uuid,uuid,text,text,text,integer,numeric,numeric,boolean,timestamptz,timestamptz,jsonb,text,text,jsonb)') is not null
    and to_regprocedure('api.market_rebuild_stats_job(text,jsonb)') is not null
    and to_regprocedure('api.admin_rebuild_market_stats(uuid,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_force_cancel_market_listing(uuid,uuid,text,text,jsonb)') is not null,
  'market ops admin RPCs exist with p-prefixed signatures'
);

with signatures(signature) as (
  values
    ('api.admin_get_market_ops_stats(uuid,integer,jsonb)'),
    ('api.admin_list_market_listings(uuid,text,text,uuid,uuid,numeric,numeric,uuid,text,integer,integer,jsonb)'),
    ('api.admin_list_market_price_rules(uuid,boolean,integer,integer,jsonb)'),
    ('api.admin_list_market_health_rules(uuid,boolean,text,uuid,uuid,integer,integer,jsonb)'),
    ('api.admin_upsert_market_price_rule(uuid,uuid,uuid,text,integer,numeric,numeric,numeric,boolean,jsonb,text,text,jsonb)'),
    ('api.admin_upsert_market_health_rule(uuid,uuid,text,uuid,uuid,numeric,numeric,boolean,jsonb,text,text,jsonb)'),
    ('api.admin_upsert_market_fee_rule(uuid,uuid,text,text,text,integer,numeric,numeric,boolean,timestamptz,timestamptz,jsonb,text,text,jsonb)'),
    ('api.market_rebuild_stats_job(text,jsonb)'),
    ('api.admin_rebuild_market_stats(uuid,text,text,jsonb)'),
    ('api.admin_force_cancel_market_listing(uuid,uuid,text,text,jsonb)')
)
select ok(
  not exists (
    select 1
    from signatures
    where not has_function_privilege('service_role', signature, 'EXECUTE')
       or has_function_privilege('public', signature, 'EXECUTE')
       or has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  'market ops admin RPCs are service_role only'
);

insert into _ids (key, payload)
values (
  'stats',
  api.admin_get_market_ops_stats(
    p_admin_user_id := (select id from _ids where key = 'actor'),
    p_window_hours := 24,
    p_request_context := '{"request_id":"phase6-market-ops-stats"}'::jsonb
  )
);

select is(
  ((select payload from _ids where key = 'stats') ->> 'activeListingCount')::integer,
  3,
  '3.1 总挂单数：stats counts active market listings'
);

select is(
  ((select payload from _ids where key = 'stats') ->> 'activeListingValueKcoin')::numeric,
  380::numeric,
  '3.2 总挂单价值：stats sums active listing price times remaining quantity'
);

select is(
  ((select payload from _ids where key = 'stats') ->> 'activeListingItemCount')::integer,
  3,
  '3.2 总挂单价值：stats also returns active listing quantity'
);

select is(
  ((select payload from _ids where key = 'stats') ->> 'volume24hKcoin')::numeric,
  150::numeric,
  '3.3 24h 成交额：stats sums completed market orders in the window'
);

select is(
  ((select payload from _ids where key = 'stats') #>> '{floorPrices,0,floorPriceKcoin}')::numeric,
  60::numeric,
  '3.4 地板价：stats returns minimum active listing price per template/form'
);

select ok(
  ((select payload from _ids where key = 'stats') #>> '{averagePrices,activeListings,listingCount}')::integer = 3
    and ((select payload from _ids where key = 'stats') #>> '{averagePrices,completedOrders,orderCount}')::integer = 1
    and ((select payload from _ids where key = 'stats') #>> '{averagePrices,completedOrders,weightedAverageUnitPriceKcoin}')::numeric = 150::numeric,
  '3.5 平均价：stats separates active-listing averages from completed-order averages'
);

select is(
  ((select payload from _ids where key = 'stats') #>> '{latestSale,unitPriceKcoin}')::numeric,
  150::numeric,
  '3.6 最近成交价：stats returns the latest market order price'
);

select ok(
  ((select payload from _ids where key = 'stats') #>> '{abnormalListings,totalCount}')::integer = 2
    and ((select payload from _ids where key = 'stats') #>> '{abnormalListings,lowCount}')::integer = 1
    and ((select payload from _ids where key = 'stats') #>> '{abnormalListings,highCount}')::integer = 1
    and ((select payload from _ids where key = 'stats') -> 'priceHealthCounts') @> '{"too_low":1,"too_high":1}'::jsonb,
  '3.7 异常低价 / 高价挂单：stats classifies active listings with price health rules'
);

select ok(
  ((select payload from _ids where key = 'stats') #>> '{washTradeSignals,totalCandidateCount}')::integer = 1
    and ((select payload from _ids where key = 'stats') #>> '{washTradeSignals,sharedIpHashCount}')::integer = 1
    and ((select payload from _ids where key = 'stats') #>> '{washTradeSignals,sharedDeviceCount}')::integer = 1
    and ((select payload from _ids where key = 'stats') #>> '{washTradeSignals,sharedWalletAddressCount}')::integer = 1
    and ((select payload from _ids where key = 'stats') #>> '{washTradeSignals,relatedRiskEventCount}')::integer = 1
    and ((select payload from _ids where key = 'stats') #> '{washTradeSignals,items,0,matchedSignals}') @> '["shared_ip_hash","shared_device","shared_wallet_address","related_risk_event"]'::jsonb,
  '3.8 同用户异常刷单：stats correlates order parties with session, wallet and risk-event signals without exposing raw hashes'
);

select ok(
  ((select payload from _ids where key = 'stats') ->> 'feeRevenueKcoin')::numeric = 7::numeric
    and ((select payload from _ids where key = 'stats') #>> '{platformFeeRevenue,source}') = 'market.fee_settlements'
    and ((select payload from _ids where key = 'stats') #>> '{platformFeeRevenue,orderFeeAmountKcoin}')::numeric = 7::numeric,
  '3.9 平台手续费收入：stats aggregates settled market fee settlements and exposes order-fee reference'
);

select ok(
  ((select payload from _ids where key = 'stats') #>> '{sources,marketPriceSnapshots,table}') = 'price_snapshots'
    and ((select payload from _ids where key = 'stats') #>> '{sources,marketDepthSnapshots,table}') = 'depth_snapshots'
    and ((select payload from _ids where key = 'stats') #>> '{sources,marketOrders,table}') = 'orders',
  'stats reports price/depth/order sources'
);

select ok(
  ((select payload from _ids where key = 'stats') #>> '{sources,marketFeeSettlements,table}') = 'fee_settlements'
    and ((select payload from _ids where key = 'stats') #>> '{sources,washTradeSignals,privacy}') like '%not returned%',
  'stats reports fee settlement and privacy-preserving wash-trade sources'
);

insert into _ids (key, payload)
values (
  'listings',
  api.admin_list_market_listings(
    p_admin_user_id := (select id from _ids where key = 'actor'),
    p_status := 'active',
    p_rarity_code := 'RARE',
    p_template_id := (select id from _ids where key = 'template'),
    p_form_id := (select id from _ids where key = 'form'),
    p_min_price_kcoin := 1,
    p_max_price_kcoin := 1000,
    p_seller_user_id := (select id from _ids where key = 'seller'),
    p_price_health := null,
    p_limit := 10,
    p_cursor := 0,
    p_request_context := '{"request_id":"phase6-market-ops-listings"}'::jsonb
  )
);

select is(
  jsonb_array_length((select payload from _ids where key = 'listings') -> 'items'),
  3,
  'listings returns a bounded filtered page'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements((select payload from _ids where key = 'listings') -> 'items') item
    where item ->> 'id' = (select id::text from _ids where key = 'listing')
  ),
  'listings page contains the fixture listing'
);

insert into _ids (key, payload)
values (
  'price_rule',
  api.admin_upsert_market_price_rule(
    p_admin_user_id := (select id from _ids where key = 'actor'),
    p_price_rule_id := null,
    p_template_id := (select id from _ids where key = 'template'),
    p_rarity_code := 'RARE',
    p_form_index := 1,
    p_min_price_kcoin := 50,
    p_max_price_kcoin := 500,
    p_suggested_price_kcoin := 120,
    p_active := true,
    p_metadata := '{"test":true}'::jsonb,
    p_reason := 'configure phase6 market price rule',
    p_idempotency_key := 'phase6-market-ops-price-rule-001',
    p_request_context := '{"request_id":"phase6-market-ops-price-rule","ip_hash":"ip","user_agent_hash":"ua"}'::jsonb
  )
);

select ok(
  ((select payload from _ids where key = 'price_rule') ->> 'audit_log_id') is not null
    and ((select payload from _ids where key = 'price_rule') ->> 'risk_event_id') is not null,
  'price rule write returns audit and risk event ids'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where id = ((select payload from _ids where key = 'price_rule') ->> 'audit_log_id')::uuid
      and action = 'market.price_rule.upsert'
  )
  and exists (
    select 1
    from ops.risk_events
    where id = ((select payload from _ids where key = 'price_rule') ->> 'risk_event_id')::uuid
      and event_type = 'market_price_manipulation'
  ),
  'price rule write persists audit and risk event rows'
);

insert into _ids (key, payload)
values (
  'health_rule',
  api.admin_upsert_market_health_rule(
    p_admin_user_id := (select id from _ids where key = 'actor'),
    p_health_rule_id := null,
    p_rarity_code := 'RARE',
    p_template_id := (select id from _ids where key = 'template'),
    p_form_id := (select id from _ids where key = 'form'),
    p_min_ratio_to_floor := 0.7000,
    p_max_ratio_to_floor := 1.3000,
    p_active := true,
    p_metadata := '{"test":true}'::jsonb,
    p_reason := 'configure phase6 market health rule',
    p_idempotency_key := 'phase6-market-ops-health-rule-001',
    p_request_context := '{"request_id":"phase6-market-ops-health-rule","ip_hash":"ip","user_agent_hash":"ua"}'::jsonb
  )
);

select ok(
  ((select payload from _ids where key = 'health_rule') ->> 'audit_log_id') is not null
    and ((select payload from _ids where key = 'health_rule') ->> 'risk_event_id') is not null
    and ((select payload from _ids where key = 'health_rule') #>> '{rule,formId}') = (select id::text from _ids where key = 'form')
    and ((select payload from _ids where key = 'health_rule') #>> '{rule,lowBps}')::integer = 7000
    and ((select payload from _ids where key = 'health_rule') #>> '{rule,highBps}')::integer = 13000,
  'health rule write returns audit, risk event and normalized rule payload'
);

insert into _ids (key, payload)
values (
  'health_rules_list',
  api.admin_list_market_health_rules(
    p_admin_user_id := (select id from _ids where key = 'actor'),
    p_active := true,
    p_rarity_code := 'RARE',
    p_template_id := (select id from _ids where key = 'template'),
    p_form_id := (select id from _ids where key = 'form'),
    p_limit := 10,
    p_cursor := 0,
    p_request_context := '{"request_id":"phase6-market-ops-health-rules-list"}'::jsonb
  )
);

select ok(
  ((select payload from _ids where key = 'health_rules_list') #>> '{items,0,formId}') = (select id::text from _ids where key = 'form')
    and ((select payload from _ids where key = 'health_rules_list') #>> '{items,0,lowBps}')::integer = 7000
    and ((select payload from _ids where key = 'health_rules_list') #>> '{items,0,highBps}')::integer = 13000,
  'health rules list supports form override scope and bps fields'
);

select ok(
  testutil.raises_like(
    format(
      $$select api.admin_upsert_market_health_rule(
        p_admin_user_id := %L::uuid,
        p_health_rule_id := null,
        p_rarity_code := 'RARE',
        p_template_id := %L::uuid,
        p_form_id := null,
        p_min_ratio_to_floor := 1.1000,
        p_max_ratio_to_floor := 1.3000,
        p_active := true,
        p_metadata := '{}'::jsonb,
        p_reason := 'bad health rule',
        p_idempotency_key := 'phase6-market-ops-health-rule-bad',
        p_request_context := '{}'::jsonb
      )$$,
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'template')
    ),
    '%ADMIN_MARKET_HEALTH_RULE_RATIO_INVALID%'
  ),
  'health rule rejects low ratio above floor'
);

insert into _ids (key, payload)
values (
  'fee_rule',
  api.admin_upsert_market_fee_rule(
    p_admin_user_id := (select id from _ids where key = 'actor'),
    p_fee_rule_id := null,
    p_code := 'MARKET_SELL_FEE_PHASE6_TEST',
    p_fee_type := 'market_sell',
    p_currency_code := 'KCOIN',
    p_fee_bps := 750,
    p_min_fee := 0,
    p_max_fee := 1000,
    p_active := true,
    p_starts_at := null,
    p_ends_at := null,
    p_metadata := '{"test":true}'::jsonb,
    p_reason := 'configure phase6 market fee rule',
    p_idempotency_key := 'phase6-market-ops-fee-rule-001',
    p_request_context := '{"request_id":"phase6-market-ops-fee-rule","ip_hash":"ip","user_agent_hash":"ua"}'::jsonb
  )
);

select ok(
  ((select payload from _ids where key = 'fee_rule') ->> 'audit_log_id') is not null
    and ((select payload from _ids where key = 'fee_rule') ->> 'risk_event_id') is not null
    and ((select payload from _ids where key = 'fee_rule') #>> '{rule,feeBps}')::integer = 750,
  'fee rule write returns audit, risk event and normalized rule payload'
);

select is(
  (
    select fee_bps
    from market.orders
    where id = (select id from _ids where key = 'order')
  ),
  500,
  'fee rule changes do not rewrite existing order fee snapshots'
);

select ok(
  testutil.raises_like(
    format(
      $$select api.admin_upsert_market_fee_rule(
        p_admin_user_id := %L::uuid,
        p_fee_rule_id := null,
        p_code := 'MARKET_SELL_FEE_PHASE6_BAD',
        p_fee_type := 'market_sell',
        p_currency_code := 'KCOIN',
        p_fee_bps := 3001,
        p_min_fee := 0,
        p_max_fee := null,
        p_active := true,
        p_starts_at := null,
        p_ends_at := null,
        p_metadata := '{}'::jsonb,
        p_reason := 'bad fee rule',
        p_idempotency_key := 'phase6-market-ops-fee-rule-bad',
        p_request_context := '{}'::jsonb
      )$$,
      (select id::text from _ids where key = 'actor')
    ),
    '%ADMIN_MARKET_FEE_RULE_BPS_INVALID%'
  ),
  'fee rule rejects fee bps above the 3000 cap'
);

insert into _ids (key, payload)
values (
  'rebuild_job',
  api.market_rebuild_stats_job(
    'phase6-market-ops-rebuild-job-001',
    '{"request_id":"phase6-market-ops-rebuild-job","source":"pgtap"}'::jsonb
  )
);

select ok(
  ((select payload from _ids where key = 'rebuild_job') ->> 'status') = 'success'
    and ((select payload from _ids where key = 'rebuild_job') ->> 'start_app_event_id') is not null
    and ((select payload from _ids where key = 'rebuild_job') ->> 'end_app_event_id') is not null,
  'market stats rebuild job records start and end app events'
);

select ok(
  exists (
    select 1
    from ops.app_events
    where id = ((select payload from _ids where key = 'rebuild_job') ->> 'start_app_event_id')::uuid
      and event_name = 'market_stats_rebuild_started'
  )
  and exists (
    select 1
    from ops.app_events
    where id = ((select payload from _ids where key = 'rebuild_job') ->> 'end_app_event_id')::uuid
      and event_name = 'market_stats_rebuild_succeeded'
  ),
  'rebuild job app events are queryable for cron observability'
);

insert into _ids (key, payload)
values (
  'admin_rebuild',
  api.admin_rebuild_market_stats(
    p_admin_user_id := (select id from _ids where key = 'actor'),
    p_reason := 'manual stats rebuild from market ops admin',
    p_idempotency_key := 'phase6-market-ops-admin-rebuild-001',
    p_request_context := '{"request_id":"phase6-market-ops-admin-rebuild","ip_hash":"ip","user_agent_hash":"ua"}'::jsonb
  )
);

select ok(
  ((select payload from _ids where key = 'admin_rebuild') ->> 'audit_log_id') is not null
    and ((select payload from _ids where key = 'admin_rebuild') ->> 'risk_event_id') is not null,
  'manual stats rebuild returns audit and risk event ids'
);

select ok(
  position('market_stats_rebuild_failed' in pg_get_functiondef('api.market_rebuild_stats_job(text,jsonb)'::regprocedure)) > 0
    and position('ops.risk_events' in pg_get_functiondef('api.market_rebuild_stats_job(text,jsonb)'::regprocedure)) > 0,
  'rebuild job failure branch writes app_events and risk_events'
);

insert into _ids (key, payload)
values (
  'force_cancel',
  api.admin_force_cancel_market_listing(
    p_admin_user_id := (select id from _ids where key = 'actor'),
    p_listing_id := (select id from _ids where key = 'listing'),
    p_reason := 'force cancel abnormal phase6 listing',
    p_idempotency_key := 'phase6-market-ops-force-cancel-001',
    p_request_context := '{"request_id":"phase6-market-ops-force-cancel","ip_hash":"ip","user_agent_hash":"ua"}'::jsonb
  )
);

select is(
  (select status from market.listings where id = (select id from _ids where key = 'listing')),
  'cancelled',
  'force cancel updates active listing to cancelled'
);

select is(
  (
    select count(*)::integer
    from inventory.inventory_locks
    where source_id = (select id from _ids where key = 'listing')
      and status = 'active'
  ),
  0,
  'force cancel releases active inventory locks'
);

select ok(
  ((select payload from _ids where key = 'force_cancel') ->> 'audit_log_id') is not null
    and ((select payload from _ids where key = 'force_cancel') ->> 'risk_event_id') is not null,
  'force cancel returns audit and risk event ids'
);

select ok(
  exists (
    select 1
    from market.listing_events
    where listing_id = (select id from _ids where key = 'listing')
      and event_type = 'cancelled'
      and metadata ->> 'admin_force_cancel' = 'true'
  )
  and exists (
    select 1
    from core.notifications
    where user_id = (select id from _ids where key = 'seller')
      and notification_type = 'market_listing_force_cancelled'
  ),
  'force cancel writes listing event and seller notification'
);

select ok(
  testutil.raises_like(
    format(
      $$select api.admin_force_cancel_market_listing(%L::uuid, %L::uuid, 'second cancel rejected', 'phase6-market-ops-force-cancel-002', '{}'::jsonb)$$,
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'listing')
    ),
    '%ADMIN_MARKET_LISTING_NOT_ACTIVE%'
  ),
  'force cancel rejects non-active listings'
);

select finish();

rollback;
