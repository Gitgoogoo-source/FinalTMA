-- This pgTAP test is designed for the Telegram Mini App blind-box game schema.
-- Run after migrations, RPC files and RLS files have been applied.
-- Each file wraps its fixture data in a transaction and rolls back at the end.

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
exception when others then
  return lower(sqlerrm) like lower(p_pattern);
end;
$$;

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null,
  p_start_param text default null
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
    p_start_param := p_start_param,
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.balance_of(p_user_id uuid, p_currency_code text)
returns numeric
language sql
stable
as $$
  select coalesce((
    select available_amount
    from economy.user_balances
    where user_id = p_user_id and currency_code = upper(p_currency_code)
  ), 0)::numeric;
$$;

select no_plan();


create or replace function testutil.create_catalog_fixture(
  p_prefix text,
  p_rarity_code text default 'COMMON',
  p_tradeable boolean default true,
  p_upgradeable boolean default true,
  p_evolvable boolean default true,
  p_decomposable boolean default true,
  p_nft_mintable boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_form1_id uuid;
  v_form2_id uuid;
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
    slug, display_name, subtitle, description, rarity_code, type_code,
    series_id, faction_id, base_power, max_level, release_status,
    tradeable, upgradeable, evolvable, decomposable, nft_mintable, sort_order
  ) values (
    p_prefix || '-template', 'Test Collectible ' || p_prefix, 'fixture', 'test fixture collectible',
    p_rarity_code, 'CHARACTER', v_series_id, v_faction_id,
    case when p_rarity_code = 'LEGENDARY' then 100 when p_rarity_code = 'EPIC' then 60 when p_rarity_code = 'RARE' then 30 else 10 end,
    100, 'active', p_tradeable, p_upgradeable, p_evolvable, p_decomposable, p_nft_mintable, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      tradeable = excluded.tradeable,
      upgradeable = excluded.upgradeable,
      evolvable = excluded.evolvable,
      decomposable = excluded.decomposable,
      nft_mintable = excluded.nft_mintable,
      updated_at = now()
  returning id into v_template_id;

  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, description,
    image_url, thumbnail_url, avatar_url, base_power_bonus, is_default
  ) values (
    v_template_id, 1, 'base', 'Base Form', 'Base form',
    'https://example.test/' || p_prefix || '/base.png',
    'https://example.test/' || p_prefix || '/base-thumb.png',
    'https://example.test/' || p_prefix || '/base-avatar.png',
    0, true
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id into v_form1_id;

  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, description,
    image_url, thumbnail_url, avatar_url, base_power_bonus, is_default
  ) values (
    v_template_id, 2, 'evolved', 'Evolved Form', 'Evolved form',
    'https://example.test/' || p_prefix || '/evolved.png',
    'https://example.test/' || p_prefix || '/evolved-thumb.png',
    'https://example.test/' || p_prefix || '/evolved-avatar.png',
    20, false
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = false,
      updated_at = now()
  returning id into v_form2_id;

  update catalog.collectible_forms
  set next_form_id = v_form2_id,
      updated_at = now()
  where id = v_form1_id;

  return jsonb_build_object(
    'series_id', v_series_id,
    'faction_id', v_faction_id,
    'template_id', v_template_id,
    'form1_id', v_form1_id,
    'form2_id', v_form2_id,
    'rarity_code', p_rarity_code
  );
end;
$$;

create or replace function testutil.create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid,
  p_level integer default 1,
  p_power integer default 10,
  p_source_type text default 'admin'
)
returns uuid
language plpgsql
as $$
declare
  v_item_id uuid;
begin
  insert into inventory.item_instances (
    owner_user_id, template_id, form_id, level, power, status, source_type, metadata
  ) values (
    p_user_id, p_template_id, p_form_id, p_level, p_power, 'available', p_source_type,
    jsonb_build_object('fixture', true)
  ) returning id into v_item_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_item_id, p_user_id, 'created', p_source_type, null, jsonb_build_object('fixture', true));

  return v_item_id;
end;
$$;


create or replace function testutil.create_gacha_fixture(
  p_prefix text,
  p_price integer default 10,
  p_stock integer default 100,
  p_open_reward_kcoin numeric default 100,
  p_pity_threshold integer default null,
  p_pity_target_rarity text default 'EPIC'
)
returns jsonb
language plpgsql
as $$
declare
  v_common jsonb;
  v_epic jsonb;
  v_box_id uuid;
  v_pool_id uuid;
  v_pity_id uuid;
  v_common_item_id uuid;
  v_epic_item_id uuid;
begin
  v_common := testutil.create_catalog_fixture(p_prefix || '-common', 'COMMON', true, true, true, true, true);
  v_epic := testutil.create_catalog_fixture(p_prefix || '-epic', 'EPIC', true, true, true, true, true);

  insert into gacha.blind_boxes (
    slug, display_name, description, tier, status, price_stars,
    total_stock, remaining_stock, open_reward_kcoin, starts_at, ends_at, sort_order
  ) values (
    p_prefix || '-box', 'Test Box ' || p_prefix, 'pgTAP gacha fixture', 'normal', 'active', p_price,
    p_stock, p_stock, p_open_reward_kcoin, now() - interval '1 hour', now() + interval '1 day', 1
  )
  on conflict (slug) do update
  set status = 'active',
      price_stars = excluded.price_stars,
      total_stock = excluded.total_stock,
      remaining_stock = excluded.remaining_stock,
      open_reward_kcoin = excluded.open_reward_kcoin,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      updated_at = now()
  returning id into v_box_id;

  insert into gacha.box_price_rules (box_id, quantity, discount_bps, active)
  values (v_box_id, 10, 1000, true)
  on conflict (box_id, quantity, active) do update
  set discount_bps = excluded.discount_bps,
      updated_at = now();

  insert into gacha.drop_pool_versions (box_id, version_no, status, published_at, effective_from, effective_to)
  values (v_box_id, 1, 'active', now(), now() - interval '1 hour', now() + interval '1 day')
  on conflict (box_id, version_no) do update
  set status = 'active',
      published_at = now(),
      effective_from = now() - interval '1 hour',
      effective_to = now() + interval '1 day',
      updated_at = now()
  returning id into v_pool_id;

  insert into gacha.drop_pool_items (
    pool_version_id, template_id, form_id, rarity_code, drop_weight,
    probability_bps, stock_total, stock_remaining, is_pity_eligible, sort_order
  ) values (
    v_pool_id, (v_common ->> 'template_id')::uuid, (v_common ->> 'form1_id')::uuid, 'COMMON', 100,
    9000, null, null, false, 10
  ) returning id into v_common_item_id;

  insert into gacha.drop_pool_items (
    pool_version_id, template_id, form_id, rarity_code, drop_weight,
    probability_bps, stock_total, stock_remaining, is_pity_eligible, sort_order
  ) values (
    v_pool_id, (v_epic ->> 'template_id')::uuid, (v_epic ->> 'form1_id')::uuid, 'EPIC', 1,
    1000, null, null, true, 20
  ) returning id into v_epic_item_id;

  if p_pity_threshold is not null then
    insert into gacha.pity_rules (
      box_id, pool_version_id, rule_name, threshold, target_rarity_code,
      reset_on_rarity_code, guaranteed_template_id, guaranteed_form_id, priority, active
    ) values (
      v_box_id, v_pool_id, p_prefix || ' pity', p_pity_threshold, p_pity_target_rarity,
      p_pity_target_rarity, (v_epic ->> 'template_id')::uuid, (v_epic ->> 'form1_id')::uuid, 1, true
    ) returning id into v_pity_id;
  end if;

  return jsonb_build_object(
    'box_id', v_box_id,
    'pool_id', v_pool_id,
    'pity_rule_id', v_pity_id,
    'common_template_id', (v_common ->> 'template_id')::uuid,
    'common_form_id', (v_common ->> 'form1_id')::uuid,
    'epic_template_id', (v_epic ->> 'template_id')::uuid,
    'epic_form_id', (v_epic ->> 'form1_id')::uuid,
    'common_drop_item_id', v_common_item_id,
    'epic_drop_item_id', v_epic_item_id
  );
end;
$$;

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;
insert into _ids (key, id) values ('user', testutil.make_user(9500000001, 'gacha_payment_user', null));
insert into _ids (key, payload) values ('fixture', testutil.create_gacha_fixture('gacha-payment', 11, 10, 100, null, 'EPIC'));
insert into _ids (key, id) select 'box', ((select payload from _ids where key = 'fixture') ->> 'box_id')::uuid;

insert into _ids (key, payload) select 'order', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 1, 'gacha-payment-order-001');
insert into _ids (key, id) select 'draw_order', ((select payload from _ids where key = 'order') ->> 'draw_order_id')::uuid;
insert into _ids (key, id) select 'star_order', ((select payload from _ids where key = 'order') ->> 'star_order_id')::uuid;

insert into payments.telegram_webhook_events (
  update_id,
  event_type,
  user_id,
  telegram_user_id,
  invoice_payload,
  payload,
  process_status,
  webhook_secret_verified
) values (
  97070001,
  'successful_payment',
  (select id from _ids where key = 'user'),
  9500000001,
  (select payload ->> 'invoice_payload' from _ids where key = 'order'),
  jsonb_build_object('update_id', 97070001, 'test', 'payment_idempotency_first'),
  'processed',
  true
);

insert into _ids (key, payload) select 'process1', api.gacha_process_paid_order((select id from _ids where key = 'star_order'), 'tg-charge-idempotency-001', 'provider-charge-idempotency-001', jsonb_build_object('update_id', 97070001, 'test', 'payment_idempotency_first'));
insert into _ids (key, payload) select 'process2', api.gacha_process_paid_order((select id from _ids where key = 'star_order'), 'tg-charge-idempotency-001', 'provider-charge-idempotency-001', jsonb_build_object('update_id', 97070001, 'test', 'payment_idempotency_second'));

select ok(((select payload from _ids where key = 'process2') ->> 'idempotent')::boolean, 'second payment fulfillment call returns idempotent=true');
select ok(((select payload from _ids where key = 'process1') ->> 'fulfilled')::boolean, 'first payment fulfillment returns fulfilled=true');
select is(((select payload from _ids where key = 'process1') ->> 'status'), 'completed', 'first payment fulfillment completes the draw order');
select is(((select payload from _ids where key = 'process1') ->> 'payment_order_status'), 'fulfilled', 'first payment fulfillment marks Stars order fulfilled');
select is((select status from gacha.draw_orders where id = (select id from _ids where key = 'draw_order')), 'completed', 'draw order persists completed status after fulfillment');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'star_order')), 'fulfilled', 'Stars order persists fulfilled status after fulfillment');
select is((select count(*)::int from payments.star_payments where telegram_payment_charge_id = 'tg-charge-idempotency-001'), 1, 'duplicate successful_payment charge id is not double-inserted');
select is((select payment_provider from gacha.draw_orders where id = (select id from _ids where key = 'draw_order')), 'telegram_stars', 'formal successful_payment records telegram_stars payment_provider');
select is((select payment_status from gacha.draw_orders where id = (select id from _ids where key = 'draw_order')), 'paid', 'formal successful_payment records paid payment_status');
select is((select telegram_payment_charge_id from gacha.draw_orders where id = (select id from _ids where key = 'draw_order')), 'tg-charge-idempotency-001', 'formal successful_payment records Telegram charge id on draw order');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'draw_order')), 1, 'duplicate payment processing does not create duplicate draw results');
select is((select count(*)::int from inventory.item_instances where source_type = 'gacha' and source_id = (select id from _ids where key = 'draw_order')), 1, 'duplicate payment processing does not create duplicate inventory items');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 100::numeric, 'duplicate payment processing does not double-credit open reward');
select is((select process_status from payments.telegram_webhook_events where update_id = 97070001), 'processed', 'fulfilled webhook event remains processed');
select is((select status_context #>> '{fulfillment,status}' from payments.telegram_webhook_events where update_id = 97070001), 'fulfilled', 'fulfilled webhook event records fulfillment status');
select is(
  (select status_context #>> '{fulfillment,draw_order_id}' from payments.telegram_webhook_events where update_id = 97070001),
  (select id::text from _ids where key = 'draw_order'),
  'fulfilled webhook event records draw order id'
);
select is(
  (
    select up.progress_count
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'user')
      and td.code = 'DAILY_OPEN_BOX_10'
      and up.period_key = current_date::text
  ),
  1,
  'duplicate payment processing advances open-box task progress only once'
);
select is(
  (
    select jsonb_array_length(up.source_events)
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'user')
      and td.code = 'DAILY_OPEN_BOX_10'
      and up.period_key = current_date::text
  ),
  1,
  'duplicate payment processing stores one open-box task progress source event'
);

insert into _ids (key, payload) select 'result_by_id', api.gacha_get_draw_result((select id from _ids where key = 'user'), (select id from _ids where key = 'draw_order'), null);
select is(((select payload from _ids where key = 'result_by_id') ->> 'status'), 'completed', 'draw result can be queried by draw_order_id');
select is(jsonb_array_length((select payload -> 'results' from _ids where key = 'result_by_id')), 1, 'draw result query returns one reward result');

insert into _ids (key, payload) select 'result_by_payload', api.gacha_get_draw_result((select id from _ids where key = 'user'), null, (select payload ->> 'invoice_payload' from _ids where key = 'order'));
select is(((select payload from _ids where key = 'result_by_payload') ->> 'status'), 'completed', 'draw result can be queried by invoice_payload');

insert into payments.telegram_webhook_events (
  update_id,
  event_type,
  user_id,
  telegram_user_id,
  invoice_payload,
  payload,
  process_status,
  webhook_secret_verified
) values (
  97070004,
  'successful_payment',
  (select id from _ids where key = 'user'),
  9500000001,
  (select payload ->> 'invoice_payload' from _ids where key = 'order'),
  jsonb_build_object('update_id', 97070004, 'test', 'payment_duplicate_fulfillment_attempt'),
  'processed',
  true
);

insert into _ids (key, payload)
select 'duplicate_fulfilled_attempt', api.gacha_process_paid_order(
  (select id from _ids where key = 'star_order'),
  'tg-charge-idempotency-duplicate-001',
  'provider-charge-idempotency-duplicate-001',
  jsonb_build_object('update_id', 97070004, 'test', 'payment_duplicate_fulfillment_attempt')
);

select is(((select payload from _ids where key = 'duplicate_fulfilled_attempt') ->> 'fulfilled')::boolean, false, 'fulfilled order rejects another charge id');
select is(((select payload from _ids where key = 'duplicate_fulfilled_attempt') ->> 'reason_code'), 'ORDER_ALREADY_FULFILLED', 'fulfilled order duplicate attempt returns fulfilled-order reason');
select is((select count(*)::int from payments.star_payments where telegram_payment_charge_id = 'tg-charge-idempotency-duplicate-001'), 0, 'fulfilled order duplicate attempt does not insert another payment row');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'draw_order')), 1, 'fulfilled order duplicate attempt does not create more draw results');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 100::numeric, 'fulfilled order duplicate attempt does not credit another open reward');
select is(
  (
    select count(*)::int
    from ops.risk_events
    where source_id = (select id from _ids where key = 'star_order')
      and event_type = 'gacha_fulfillment_duplicate_or_conflicting_charge'
      and detail ->> 'reason_code' = 'ORDER_ALREADY_FULFILLED'
  ),
  1,
  'fulfilled order duplicate attempt writes risk event'
);
select is((select process_status from payments.telegram_webhook_events where update_id = 97070004), 'failed', 'fulfilled order duplicate attempt marks webhook event failed');
select is((select status_context #>> '{fulfillment,reason_code}' from payments.telegram_webhook_events where update_id = 97070004), 'ORDER_ALREADY_FULFILLED', 'fulfilled order duplicate attempt records fulfillment reason');

insert into _ids (key, payload) select 'retry_order', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 1, 'gacha-payment-order-retry-001');
insert into _ids (key, id) select 'retry_star_order', ((select payload from _ids where key = 'retry_order') ->> 'star_order_id')::uuid;
insert into _ids (key, id) select 'retry_draw_order', ((select payload from _ids where key = 'retry_order') ->> 'draw_order_id')::uuid;

insert into payments.telegram_webhook_events (
  update_id,
  event_type,
  user_id,
  telegram_user_id,
  invoice_payload,
  payload,
  process_status,
  webhook_secret_verified
) values (
  97070002,
  'successful_payment',
  (select id from _ids where key = 'user'),
  9500000001,
  (select payload ->> 'invoice_payload' from _ids where key = 'retry_order'),
  jsonb_build_object('update_id', 97070002, 'test', 'payment_retry_failure'),
  'processed',
  true
);

update gacha.blind_boxes
set remaining_stock = 0,
    status = 'active',
    updated_at = now()
where id = (select id from _ids where key = 'box');

insert into _ids (key, payload)
select 'retry_failed', api.gacha_process_paid_order(
  (select id from _ids where key = 'retry_star_order'),
  'tg-charge-idempotency-retry-001',
  'provider-charge-idempotency-retry-001',
  jsonb_build_object('update_id', 97070002, 'test', 'payment_retry_failure')
);

select is(((select payload from _ids where key = 'retry_failed') ->> 'fulfilled')::boolean, false, 'stock failure returns fulfilled=false');
select is(((select payload from _ids where key = 'retry_failed') ->> 'reason_code'), 'STOCK_INSUFFICIENT', 'stock failure returns retryable stock reason');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'retry_star_order')), 'failed', 'stock failure marks Stars order failed');
select is((select status from gacha.draw_orders where id = (select id from _ids where key = 'retry_draw_order')), 'failed', 'stock failure marks draw order failed');
select is((select count(*)::int from payments.star_payments where telegram_payment_charge_id = 'tg-charge-idempotency-retry-001'), 1, 'stock failure keeps successful payment row for retry');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'retry_draw_order')), 0, 'stock failure does not create draw results');
select is((select count(*)::int from ops.risk_events where source_id = (select id from _ids where key = 'retry_star_order') and event_type = 'gacha_fulfillment_failed'), 1, 'stock failure writes risk event');
select is((select process_status from payments.telegram_webhook_events where update_id = 97070002), 'failed', 'stock failure marks webhook event failed');
select is((select status_context #>> '{fulfillment,status}' from payments.telegram_webhook_events where update_id = 97070002), 'failed', 'stock failure records fulfillment status');
select is((select status_context #>> '{fulfillment,reason_code}' from payments.telegram_webhook_events where update_id = 97070002), 'STOCK_INSUFFICIENT', 'stock failure records fulfillment reason');
select is((select retry_count from payments.telegram_webhook_events where update_id = 97070002), 1, 'stock failure increments webhook retry count');
select ok((select next_retry_at is not null from payments.telegram_webhook_events where update_id = 97070002), 'stock failure schedules webhook retry');

update gacha.blind_boxes
set remaining_stock = 10,
    status = 'active',
    updated_at = now()
where id = (select id from _ids where key = 'box');

insert into _ids (key, payload)
select 'retry_success', api.gacha_process_paid_order(
  (select id from _ids where key = 'retry_star_order'),
  'tg-charge-idempotency-retry-001',
  'provider-charge-idempotency-retry-001',
  jsonb_build_object('update_id', 97070002, 'test', 'payment_retry_success')
);

select ok(((select payload from _ids where key = 'retry_success') ->> 'fulfilled')::boolean, 'retry after stock recovery fulfills paid order');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'retry_star_order')), 'fulfilled', 'retry after stock recovery marks Stars order fulfilled');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'retry_draw_order')), 1, 'retry after stock recovery creates one draw result');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 200::numeric, 'retry after stock recovery credits open reward once');
select is((select process_status from payments.telegram_webhook_events where update_id = 97070002), 'processed', 'retry success marks webhook event processed');
select is((select status_context #>> '{fulfillment,status}' from payments.telegram_webhook_events where update_id = 97070002), 'fulfilled', 'retry success records fulfilled context');
select ok((select next_retry_at is null from payments.telegram_webhook_events where update_id = 97070002), 'retry success clears webhook next retry time');

insert into _ids (key, payload) select 'amount_mismatch_order', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 1, 'gacha-payment-order-amount-mismatch-001');
insert into _ids (key, id) select 'amount_mismatch_star_order', ((select payload from _ids where key = 'amount_mismatch_order') ->> 'star_order_id')::uuid;
insert into _ids (key, id) select 'amount_mismatch_draw_order', ((select payload from _ids where key = 'amount_mismatch_order') ->> 'draw_order_id')::uuid;

update payments.star_orders
set xtr_amount = xtr_amount + 1,
    updated_at = now()
where id = (select id from _ids where key = 'amount_mismatch_star_order');

insert into payments.telegram_webhook_events (
  update_id,
  event_type,
  user_id,
  telegram_user_id,
  invoice_payload,
  payload,
  process_status,
  webhook_secret_verified
) values (
  97070005,
  'successful_payment',
  (select id from _ids where key = 'user'),
  9500000001,
  (select payload ->> 'invoice_payload' from _ids where key = 'amount_mismatch_order'),
  jsonb_build_object('update_id', 97070005, 'test', 'payment_amount_mismatch'),
  'processed',
  true
);

insert into _ids (key, payload)
select 'amount_mismatch_process', api.gacha_process_paid_order(
  (select id from _ids where key = 'amount_mismatch_star_order'),
  'tg-charge-idempotency-amount-mismatch-001',
  'provider-charge-idempotency-amount-mismatch-001',
  jsonb_build_object('update_id', 97070005, 'test', 'payment_amount_mismatch')
);

select is(((select payload from _ids where key = 'amount_mismatch_process') ->> 'fulfilled')::boolean, false, 'amount mismatch is not fulfilled');
select is(((select payload from _ids where key = 'amount_mismatch_process') ->> 'reason_code'), 'AMOUNT_MISMATCH', 'amount mismatch returns amount reason');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'amount_mismatch_star_order')), 'failed', 'amount mismatch marks Stars order failed');
select is((select status from gacha.draw_orders where id = (select id from _ids where key = 'amount_mismatch_draw_order')), 'failed', 'amount mismatch marks draw order failed');
select is((select count(*)::int from payments.star_payments where telegram_payment_charge_id = 'tg-charge-idempotency-amount-mismatch-001'), 0, 'amount mismatch does not insert payment row during fulfillment');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'amount_mismatch_draw_order')), 0, 'amount mismatch does not create draw results');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 200::numeric, 'amount mismatch does not credit another open reward');
select is(
  (
    select count(*)::int
    from ops.risk_events
    where source_id = (select id from _ids where key = 'amount_mismatch_star_order')
      and event_type = 'gacha_fulfillment_validation_failed'
      and detail ->> 'reason_code' = 'AMOUNT_MISMATCH'
  ),
  1,
  'amount mismatch writes risk event'
);
select is((select process_status from payments.telegram_webhook_events where update_id = 97070005), 'failed', 'amount mismatch marks webhook event failed');
select is((select status_context #>> '{fulfillment,reason_code}' from payments.telegram_webhook_events where update_id = 97070005), 'AMOUNT_MISMATCH', 'amount mismatch records fulfillment reason');

insert into _ids (key, payload) select 'conflict_order', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 1, 'gacha-payment-order-conflict-001');
insert into _ids (key, id) select 'conflict_star_order', ((select payload from _ids where key = 'conflict_order') ->> 'star_order_id')::uuid;
insert into _ids (key, id) select 'conflict_draw_order', ((select payload from _ids where key = 'conflict_order') ->> 'draw_order_id')::uuid;

insert into payments.telegram_webhook_events (
  update_id,
  event_type,
  user_id,
  telegram_user_id,
  invoice_payload,
  payload,
  process_status,
  webhook_secret_verified
) values (
  97070003,
  'successful_payment',
  (select id from _ids where key = 'user'),
  9500000001,
  (select payload ->> 'invoice_payload' from _ids where key = 'conflict_order'),
  jsonb_build_object('update_id', 97070003, 'test', 'payment_idempotency_conflict'),
  'processed',
  true
);

insert into _ids (key, payload)
select 'conflict_process', api.gacha_process_paid_order(
  (select id from _ids where key = 'conflict_star_order'),
  'tg-charge-idempotency-001',
  'provider-charge-idempotency-conflict',
  jsonb_build_object('update_id', 97070003, 'test', 'payment_idempotency_conflict')
);

select is(((select payload from _ids where key = 'conflict_process') ->> 'fulfilled')::boolean, false, 'reused successful_payment charge id is not fulfilled for another order');
select is(((select payload from _ids where key = 'conflict_process') ->> 'reason_code'), 'PAYMENT_CHARGE_CONFLICT', 'reused successful_payment charge id returns conflict reason');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'conflict_draw_order')), 0, 'conflicting charge id does not create draw results');
select is((select count(*)::int from inventory.item_instances where source_type = 'gacha' and source_id = (select id from _ids where key = 'conflict_draw_order')), 0, 'conflicting charge id does not create inventory items');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 200::numeric, 'conflicting charge id does not credit another open reward');
select is((select count(*)::int from ops.risk_events where source_id = (select id from _ids where key = 'conflict_star_order') and event_type = 'gacha_fulfillment_validation_failed'), 1, 'conflicting charge id writes one risk event');
select is((select process_status from payments.telegram_webhook_events where update_id = 97070003), 'failed', 'conflicting charge marks webhook event failed');
select is((select status_context #>> '{fulfillment,reason_code}' from payments.telegram_webhook_events where update_id = 97070003), 'PAYMENT_CHARGE_CONFLICT', 'conflicting charge records fulfillment reason');
select is((select status_context #>> '{fulfillment,retryable}' from payments.telegram_webhook_events where update_id = 97070003), 'false', 'conflicting charge records non-retryable fulfillment');

select * from finish();

rollback;
