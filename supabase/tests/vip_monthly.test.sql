-- VIP monthly card database and RPC checks.
-- Covers manual 30-day activation/renewal, UTC daily claim, and market fee rebate.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, vip, api;

select no_plan();

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

create or replace function testutil.create_catalog_fixture(
  p_prefix text,
  p_rarity_code text default 'RARE'
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
    slug, display_name, subtitle, description, rarity_code, type_code,
    series_id, faction_id, base_power, max_level, release_status,
    tradeable, upgradeable, evolvable, decomposable, nft_mintable, sort_order
  ) values (
    p_prefix || '-template', 'Test Collectible ' || p_prefix, 'fixture', 'test fixture collectible',
    p_rarity_code, 'CHARACTER', v_series_id, v_faction_id,
    30, 100, 'active', true, true, true, true, true, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      tradeable = true,
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
  p_form_id uuid,
  p_power integer default 30
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
    p_user_id, p_template_id, p_form_id, 1, p_power, 'available', 'admin',
    jsonb_build_object('fixture', true)
  ) returning id into v_item_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_item_id, p_user_id, 'created', 'admin', null, jsonb_build_object('fixture', true));

  return v_item_id;
end;
$$;

create or replace function testutil.create_paid_vip_order(
  p_user_id uuid,
  p_telegram_user_id bigint,
  p_plan_id uuid,
  p_prefix text,
  p_update_base bigint
)
returns jsonb
language plpgsql
as $$
declare
  v_order jsonb;
  v_precheckout jsonb;
  v_payment jsonb;
  v_process jsonb;
begin
  v_order := api.vip_create_order_checked(
    p_user_id,
    p_plan_id,
    p_prefix || '-order-idem',
    199
  );

  v_precheckout := api.payment_mark_precheckout_checked(
    p_update_base,
    p_prefix || '-pcq',
    v_order ->> 'invoice_payload',
    'XTR',
    (v_order ->> 'xtr_amount')::integer,
    p_telegram_user_id,
    jsonb_build_object('update_id', p_update_base, 'test_prefix', p_prefix),
    'headers-' || p_prefix || '-precheckout',
    'req_' || p_prefix || '_precheckout',
    true
  );

  v_payment := api.payment_record_successful_payment(
    p_update_base + 1,
    v_order ->> 'invoice_payload',
    'XTR',
    (v_order ->> 'xtr_amount')::integer,
    p_prefix || '-tg-charge',
    p_prefix || '-provider-charge',
    p_telegram_user_id,
    jsonb_build_object('update_id', p_update_base + 1, 'test_prefix', p_prefix),
    'headers-' || p_prefix || '-payment',
    'req_' || p_prefix || '_payment',
    true
  );

  v_process := api.vip_process_paid_order(
    (v_order ->> 'star_order_id')::uuid,
    p_prefix || '-tg-charge',
    p_prefix || '-provider-charge',
    jsonb_build_object('test_prefix', p_prefix)
  );

  return jsonb_build_object(
    'order', v_order,
    'precheckout', v_precheckout,
    'payment', v_payment,
    'process', v_process,
    'vip_order_id', v_order ->> 'vip_order_id',
    'star_order_id', v_order ->> 'star_order_id',
    'subscription_id', v_process ->> 'subscription_id'
  );
end;
$$;

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb
) on commit drop;

create temp table _times (
  key text primary key,
  ts timestamptz
) on commit drop;

insert into _ids (key, id)
select 'plan', id
from vip.vip_plans
where code = 'vip_monthly';

select isnt((select id from _ids where key = 'plan'), null::uuid, 'seeded vip_monthly plan exists');
select is((select price_xtr from vip.vip_plans where id = (select id from _ids where key = 'plan')), 199, 'vip_monthly price is 199 XTR');
select is((select duration_days from vip.vip_plans where id = (select id from _ids where key = 'plan')), 30, 'vip_monthly duration is 30 days');
select is((select daily_fgems from vip.vip_plans where id = (select id from _ids where key = 'plan')), 100::numeric, 'vip_monthly grants 100 daily FGEMS');
select is((select daily_free_box_count from vip.vip_plans where id = (select id from _ids where key = 'plan')), 1, 'vip_monthly grants one daily free box counter');
select is((select fee_rebate_bps from vip.vip_plans where id = (select id from _ids where key = 'plan')), 2000, 'vip_monthly market fee rebate is 20%');
select ok(to_regclass('vip.vip_free_box_entitlements') is null, 'free box entitlement is not split into a separate table');
select ok(exists (
  select 1
  from information_schema.columns
  where table_schema = 'vip'
    and table_name = 'vip_daily_claims'
    and column_name in ('free_box_count', 'free_box_used_count')
  group by table_schema, table_name
  having count(*) = 2
), 'daily free box counters live on vip_daily_claims');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'vip' and c.relname = 'vip_orders'), 'vip_orders has RLS enabled');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'vip' and c.relname = 'vip_daily_claims'), 'vip_daily_claims has RLS enabled');

insert into _ids (key, id)
values ('user', testutil.make_user(9901000001, 'vip_monthly_user'));

insert into _ids (key, id)
values ('non_vip_user', testutil.make_user(9901000002, 'vip_non_member_user'));

insert into _ids (key, id)
values ('buyer', testutil.make_user(9901000003, 'vip_market_buyer'));

insert into _ids (key, payload)
select 'status_before', api.vip_get_status((select id from _ids where key = 'user'));

select is(((select payload from _ids where key = 'status_before') ->> 'is_vip')::boolean, false, 'new user is not VIP before payment');
select is((((select payload from _ids where key = 'status_before') -> 'plan' ->> 'price_xtr')::integer), 199, 'status RPC exposes the 199 XTR plan');

insert into _ids (key, payload)
select 'order', api.vip_create_order_checked(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'plan'),
  'vip-monthly-order-001',
  199
);
insert into _ids (key, id) select 'vip_order', ((select payload from _ids where key = 'order') ->> 'vip_order_id')::uuid;
insert into _ids (key, id) select 'star_order', ((select payload from _ids where key = 'order') ->> 'star_order_id')::uuid;

select is(((select payload from _ids where key = 'order') ->> 'xtr_amount')::integer, 199, 'VIP create order returns 199 XTR');
select is((select business_type from payments.star_orders where id = (select id from _ids where key = 'star_order')), 'vip_monthly', 'Stars order uses vip_monthly business type');
select is((select business_id from payments.star_orders where id = (select id from _ids where key = 'star_order')), (select id from _ids where key = 'vip_order'), 'Stars order points to vip order');
select is((select status from vip.vip_orders where id = (select id from _ids where key = 'vip_order')), 'created', 'VIP order starts as created');

insert into _ids (key, payload)
select 'order_repeat', api.vip_create_order_checked(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'plan'),
  'vip-monthly-order-001',
  199
);

select ok(((select payload from _ids where key = 'order_repeat') ->> 'idempotent')::boolean, 'VIP create order is idempotent for the same key');
select is(((select payload from _ids where key = 'order_repeat') ->> 'vip_order_id'), ((select payload from _ids where key = 'order') ->> 'vip_order_id'), 'idempotent create returns same VIP order');
select is((select count(*)::integer from vip.vip_orders where idempotency_key = 'vip-monthly-order-001'), 1, 'idempotent create does not duplicate VIP order');
select ok(testutil.raises_like(format(
  'select api.vip_create_order_checked(%L::uuid, %L::uuid, %L, 198)',
  (select id::text from _ids where key = 'user'),
  (select id::text from _ids where key = 'plan'),
  'vip-monthly-price-mismatch'
), '%expected price changed%'), 'VIP create order rejects stale expected price');

insert into _ids (key, payload)
select 'precheckout', api.payment_mark_precheckout_checked(
  97010001,
  'vip-pcq-001',
  (select payload ->> 'invoice_payload' from _ids where key = 'order'),
  'XTR',
  199,
  9901000001,
  jsonb_build_object('update_id', 97010001, 'pre_checkout_query', jsonb_build_object('id', 'vip-pcq-001')),
  'headers-vip-precheckout',
  'req_vip_precheckout',
  true
);

select ok(((select payload from _ids where key = 'precheckout') ->> 'allowed')::boolean, 'VIP pre_checkout is allowed');
select is(((select payload from _ids where key = 'precheckout') ->> 'business_type'), 'vip_monthly', 'VIP pre_checkout returns vip_monthly business type');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'star_order')), 'precheckout_checked', 'VIP pre_checkout marks Stars order precheckout_checked');
select is((select status from vip.vip_orders where id = (select id from _ids where key = 'vip_order')), 'invoice_created', 'VIP pre_checkout marks VIP order invoice_created');

insert into _ids (key, payload)
select 'payment', api.payment_record_successful_payment(
  97010002,
  (select payload ->> 'invoice_payload' from _ids where key = 'order'),
  'XTR',
  199,
  'tg-vip-monthly-001',
  'provider-vip-monthly-001',
  9901000001,
  jsonb_build_object('update_id', 97010002, 'message', jsonb_build_object('successful_payment', jsonb_build_object('telegram_payment_charge_id', 'tg-vip-monthly-001'))),
  'headers-vip-payment',
  'req_vip_payment',
  true
);

select ok(((select payload from _ids where key = 'payment') ->> 'payment_recorded')::boolean, 'VIP successful_payment is recorded');
select is(((select payload from _ids where key = 'payment') ->> 'vip_order_id'), (select id::text from _ids where key = 'vip_order'), 'successful_payment returns VIP order id');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'star_order')), 'paid', 'VIP successful_payment marks Stars order paid');
select is((select status from vip.vip_orders where id = (select id from _ids where key = 'vip_order')), 'paid', 'VIP successful_payment marks VIP order paid');
select is((select count(*)::integer from payments.star_payments where telegram_payment_charge_id = 'tg-vip-monthly-001'), 1, 'VIP successful_payment inserts one payment row');

insert into _ids (key, payload)
select 'process', api.vip_process_paid_order(
  (select id from _ids where key = 'star_order'),
  'tg-vip-monthly-001',
  'provider-vip-monthly-001',
  jsonb_build_object('test', true)
);
insert into _ids (key, id) select 'subscription', ((select payload from _ids where key = 'process') ->> 'subscription_id')::uuid;
insert into _times (key, ts)
select 'period_end_after_first', current_period_end
from vip.vip_subscriptions
where id = (select id from _ids where key = 'subscription');

select ok(((select payload from _ids where key = 'process') ->> 'fulfilled')::boolean, 'paid VIP order is fulfilled');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'star_order')), 'fulfilled', 'VIP process marks Stars order fulfilled');
select is((select status from vip.vip_orders where id = (select id from _ids where key = 'vip_order')), 'fulfilled', 'VIP process marks VIP order fulfilled');
select is((select status from vip.vip_subscriptions where id = (select id from _ids where key = 'subscription')), 'active', 'VIP process creates active subscription');
select ok((select current_period_end > now() + interval '29 days' from vip.vip_subscriptions where id = (select id from _ids where key = 'subscription')), 'active subscription is roughly 30 days long');
select is((select count(*)::integer from vip.vip_benefit_ledger where vip_order_id = (select id from _ids where key = 'vip_order') and benefit_type = 'subscription_activation'), 1, 'subscription activation benefit ledger is written once');

insert into _ids (key, payload)
select 'process_repeat', api.vip_process_paid_order(
  (select id from _ids where key = 'star_order'),
  'tg-vip-monthly-001',
  'provider-vip-monthly-001',
  jsonb_build_object('test', true, 'repeat', true)
);

select ok(((select payload from _ids where key = 'process_repeat') ->> 'idempotent')::boolean, 'VIP process is idempotent for fulfilled order');
select is((select current_period_end from vip.vip_subscriptions where id = (select id from _ids where key = 'subscription')), (select ts from _times where key = 'period_end_after_first'), 'idempotent VIP process does not extend again');
select is((select count(*)::integer from vip.vip_benefit_ledger where vip_order_id = (select id from _ids where key = 'vip_order') and benefit_type = 'subscription_activation'), 1, 'idempotent VIP process does not duplicate activation ledger');

insert into _ids (key, payload)
select 'process_repeat_via_legacy_entrypoint', api.gacha_process_paid_order(
  (select id from _ids where key = 'star_order'),
  'tg-vip-monthly-001',
  'provider-vip-monthly-001',
  jsonb_build_object('test', true, 'legacy_entrypoint', true)
);

select ok(((select payload from _ids where key = 'process_repeat_via_legacy_entrypoint') ->> 'idempotent')::boolean, 'legacy payment fulfillment entrypoint routes fulfilled VIP orders idempotently');
select is(((select payload from _ids where key = 'process_repeat_via_legacy_entrypoint') ->> 'business_type'), 'vip_monthly', 'legacy payment fulfillment entrypoint returns vip_monthly business type');
select is((select current_period_end from vip.vip_subscriptions where id = (select id from _ids where key = 'subscription')), (select ts from _times where key = 'period_end_after_first'), 'legacy VIP route does not extend fulfilled order again');

insert into _ids (key, payload)
select 'renewal', testutil.create_paid_vip_order(
  (select id from _ids where key = 'user'),
  9901000001,
  (select id from _ids where key = 'plan'),
  'vip-renewal-001',
  97010010
);

select is((select count(*)::integer from vip.vip_subscriptions where user_id = (select id from _ids where key = 'user') and status = 'active'), 1, 'VIP renewal keeps one active subscription row');
select is((select current_period_end from vip.vip_subscriptions where id = (select id from _ids where key = 'subscription')), (select ts + interval '30 days' from _times where key = 'period_end_after_first'), 'VIP renewal extends current period by exactly 30 days');
select is((select count(*)::integer from vip.vip_orders where user_id = (select id from _ids where key = 'user') and status = 'fulfilled'), 2, 'initial payment and renewal are both fulfilled orders');

insert into _ids (key, payload)
select 'claim', api.vip_claim_daily_benefit(
  (select id from _ids where key = 'user'),
  'vip-monthly-claim-001'
);

select is(((select payload from _ids where key = 'claim') ->> 'fgems_amount')::numeric, 100::numeric, 'daily claim grants 100 FGEMS');
select is(((select payload from _ids where key = 'claim') ->> 'free_box_count')::integer, 1, 'daily claim grants one free box counter');
select is(((select payload from _ids where key = 'claim') ->> 'free_box_used_count')::integer, 0, 'daily free box starts unused');
select is((select count(*)::integer from vip.vip_daily_claims where user_id = (select id from _ids where key = 'user') and claim_date = (now() at time zone 'UTC')::date), 1, 'only one UTC daily claim row exists');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 100::numeric, 'daily claim credits FGEMS balance');
select is((select count(*)::integer from economy.currency_ledger where user_id = (select id from _ids where key = 'user') and source_type = 'vip_daily_claim'), 1, 'daily claim writes one currency ledger row');
select is((select count(*)::integer from vip.vip_benefit_ledger where user_id = (select id from _ids where key = 'user') and benefit_type = 'daily_free_box'), 1, 'daily free box grant is written to VIP benefit ledger');

insert into _ids (key, payload)
select 'claim_repeat', api.vip_claim_daily_benefit(
  (select id from _ids where key = 'user'),
  'vip-monthly-claim-001'
);

select ok(((select payload from _ids where key = 'claim_repeat') ->> 'idempotent')::boolean, 'daily claim is idempotent for same key');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 100::numeric, 'same daily claim key does not credit twice');

insert into _ids (key, payload)
select 'claim_same_day_other_key', api.vip_claim_daily_benefit(
  (select id from _ids where key = 'user'),
  'vip-monthly-claim-002'
);

select ok(((select payload from _ids where key = 'claim_same_day_other_key') ->> 'already_claimed')::boolean, 'same UTC day with another key returns already_claimed');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 100::numeric, 'same UTC day with another key does not credit twice');

insert into _ids (key, payload)
select 'status_after_claim', api.vip_get_status((select id from _ids where key = 'user'));

select is(((select payload from _ids where key = 'status_after_claim') ->> 'is_vip')::boolean, true, 'status RPC reports active VIP after fulfillment');
select is((((select payload from _ids where key = 'status_after_claim') -> 'today' ->> 'claimed')::boolean), true, 'status RPC reports today claimed after daily claim');
select is((((select payload from _ids where key = 'status_after_claim') -> 'today' ->> 'free_box_used_count')::integer), 0, 'status RPC returns free box used counter from vip_daily_claims');

insert into _ids (key, payload)
select 'consume_free_box', api.vip_consume_daily_free_box(
  (select id from _ids where key = 'user'),
  'vip-monthly-free-box-consume-001'
);

select ok(((select payload from _ids where key = 'consume_free_box') ->> 'consumed')::boolean, 'daily free box counter can be consumed');
select is(((select payload from _ids where key = 'consume_free_box') ->> 'free_box_used_count')::integer, 1, 'daily free box consume increments used counter');
select is((select free_box_used_count from vip.vip_daily_claims where user_id = (select id from _ids where key = 'user') and claim_date = (now() at time zone 'UTC')::date), 1, 'used counter is stored on vip_daily_claims');
select is((select status from vip.vip_daily_claims where user_id = (select id from _ids where key = 'user') and claim_date = (now() at time zone 'UTC')::date), 'used', 'claim row becomes used when all free boxes are consumed');
select is((select count(*)::integer from vip.vip_benefit_ledger where user_id = (select id from _ids where key = 'user') and benefit_type = 'daily_free_box' and entry_type = 'consume'), 1, 'free box consume writes one VIP benefit ledger row');

insert into _ids (key, payload)
select 'consume_free_box_repeat', api.vip_consume_daily_free_box(
  (select id from _ids where key = 'user'),
  'vip-monthly-free-box-consume-001'
);

select ok(((select payload from _ids where key = 'consume_free_box_repeat') ->> 'idempotent')::boolean, 'daily free box consume is idempotent for same key');
select is((select count(*)::integer from vip.vip_benefit_ledger where user_id = (select id from _ids where key = 'user') and benefit_type = 'daily_free_box' and entry_type = 'consume'), 1, 'repeat free box consume does not duplicate ledger row');
select ok(testutil.raises_like(format(
  'select api.vip_consume_daily_free_box(%L::uuid, %L)',
  (select id::text from _ids where key = 'user'),
  'vip-monthly-free-box-consume-002'
), '%VIP_FREE_BOX_ALREADY_USED%'), 'daily free box cannot be consumed twice with a different key');

select ok(testutil.raises_like(format(
  'select api.vip_claim_daily_benefit(%L::uuid, %L)',
  (select id::text from _ids where key = 'non_vip_user'),
  'vip-non-member-claim'
), '%VIP_EXPIRED%'), 'non-VIP user cannot claim daily benefit');

insert into _ids (key, payload)
values ('catalog', testutil.create_catalog_fixture('vip-market-rebate', 'RARE'));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;
insert into _ids (key, id) select 'market_item', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 31);

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'buyer'),
    'KCOIN',
    500,
    'test_setup',
    null,
    null,
    'vip-market-buyer-kcoin-001',
    'fixture',
    '{}'::jsonb
  );
end;
$$;

insert into _ids (key, payload)
select 'listing', api.market_create_listing(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 'market_item')],
  100,
  'vip-market-listing-001'
);
insert into _ids (key, id) select 'listing_id', ((select payload from _ids where key = 'listing') ->> 'listing_id')::uuid;

insert into _ids (key, payload)
select 'market_buy', api.market_buy_listing(
  (select id from _ids where key = 'buyer'),
  (select id from _ids where key = 'listing_id'),
  1,
  100,
  'vip-market-buy-001'
);
insert into _ids (key, id) select 'market_order', ((select payload from _ids where key = 'market_buy') ->> 'order_id')::uuid;

select ok((((select payload from _ids where key = 'market_buy') -> 'vip_fee_rebate' ->> 'applied')::boolean), 'VIP seller receives market fee rebate through buy RPC');
select is((((select payload from _ids where key = 'market_buy') -> 'vip_fee_rebate' ->> 'rebate_amount')::numeric), 1::numeric, '20% of 5 KCOIN fee floors to 1 KCOIN rebate');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 96::numeric, 'VIP seller balance receives 95 net plus 1 rebate');
select is((select count(*)::integer from vip.vip_fee_rebates where market_order_id = (select id from _ids where key = 'market_order')), 1, 'VIP fee rebate row is written once');
select is((select count(*)::integer from economy.currency_ledger where user_id = (select id from _ids where key = 'user') and source_type = 'vip_fee_rebate'), 1, 'VIP fee rebate writes one currency ledger row');

insert into _ids (key, payload)
select 'market_rebate_repeat', api.vip_apply_market_fee_rebate(
  (select id from _ids where key = 'market_order'),
  (select id from _ids where key = 'user'),
  5,
  'KCOIN',
  'vip_fee_rebate:market_order:' || (select id::text from _ids where key = 'market_order')
);

select ok(((select payload from _ids where key = 'market_rebate_repeat') ->> 'idempotent')::boolean, 'VIP fee rebate repeat call is idempotent');
select is((select count(*)::integer from vip.vip_fee_rebates where market_order_id = (select id from _ids where key = 'market_order')), 1, 'VIP fee rebate repeat does not duplicate row');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 96::numeric, 'VIP fee rebate repeat does not credit twice');

insert into _ids (key, id)
values ('expired_user', testutil.make_user(9901000004, 'vip_expired_job_user'));
with inserted as (
  insert into vip.vip_subscriptions (
    user_id,
    plan_id,
    status,
    auto_renew_enabled,
    current_period_start,
    current_period_end,
    metadata
  ) values (
    (select id from _ids where key = 'expired_user'),
    (select id from _ids where key = 'plan'),
    'active',
    false,
    now() - interval '31 days',
    now() - interval '1 day',
    jsonb_build_object('fixture', true)
  )
  returning id
)
insert into _ids (key, id)
select 'expired_subscription', id
from inserted;

insert into _ids (key, payload)
select 'expire_job', api.vip_expire_subscriptions_job(10);

select ok(((select payload from _ids where key = 'expire_job') ->> 'expired_count')::integer >= 1, 'expire job processes due subscriptions');
select is((
  select status
  from vip.vip_subscriptions
  where id = (select id from _ids where key = 'expired_subscription')
), 'expired', 'expire job marks due subscription expired');

select * from finish();

rollback;
