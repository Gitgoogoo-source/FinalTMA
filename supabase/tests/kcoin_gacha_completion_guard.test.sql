-- Verifies that KCOIN gacha completion is backed by the immutable debit ledger.

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

select plan(4);

insert into economy.currencies (
  code, display_name, symbol, decimals, currency_type, is_spendable, is_transferable
) values (
  'KCOIN', 'K-coin', 'K', 0, 'internal', true, false
) on conflict (code) do update
set display_name = excluded.display_name,
    is_spendable = true;

create temp table _ids (key text primary key, id uuid) on commit drop;

insert into _ids (key, id)
values ('user', testutil.make_user(9400000001, 'kcoin_gacha_guard_user'));

with inserted as (
  insert into gacha.blind_boxes (
    slug, display_name, description, tier, status, price_stars,
    total_stock, remaining_stock, open_reward_kcoin, starts_at, ends_at, sort_order
  ) values (
    'kcoin-guard-box', 'KCOIN Guard Box', 'pgTAP fixture', 'normal', 'active', 10,
    null, null, 0, now() - interval '1 hour', now() + interval '1 day', 1
  )
  returning id
)
insert into _ids (key, id)
select 'box', id from inserted;

with inserted as (
  insert into gacha.drop_pool_versions (
    box_id, version_no, status, published_at, effective_from, effective_to
  ) values (
    (select id from _ids where key = 'box'), 1, 'active', now(), now() - interval '1 hour', now() + interval '1 day'
  )
  returning id
)
insert into _ids (key, id)
select 'pool', id from inserted;

with inserted as (
insert into gacha.draw_orders (
  user_id, box_id, pool_version_id, status, quantity, draw_count,
  unit_price_stars, discount_bps, total_price_stars, open_reward_kcoin,
  invoice_payload, idempotency_key, paid_at, payment_provider, payment_status,
  star_amount, telegram_invoice_payload, metadata
) values (
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'pool'),
  'opening', 1, 1, 10, 0, 10, 0,
  'kcoin_guard_no_ledger_payload',
  'kcoin_guard_no_ledger',
  now(), 'kcoin', 'paid', 0,
  'kcoin_guard_no_ledger_payload',
  jsonb_build_object('currency_code', 'KCOIN')
)
returning id
)
insert into _ids (key, id)
select 'no_ledger_order', id from inserted;

select ok(
  testutil.raises_like(
    format(
      'update gacha.draw_orders set status = ''completed'' where id = %L::uuid',
      (select id::text from _ids where key = 'no_ledger_order')
    ),
    '%matching kcoin debit ledger is required before opening%'
  ),
  'KCOIN draw order cannot complete without matching debit ledger'
);

with inserted as (
insert into gacha.draw_orders (
  user_id, box_id, pool_version_id, status, quantity, draw_count,
  unit_price_stars, discount_bps, total_price_stars, open_reward_kcoin,
  invoice_payload, idempotency_key, paid_at, payment_provider, payment_status,
  star_amount, telegram_invoice_payload, metadata
) values (
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'pool'),
  'opening', 1, 1, 10, 0, 10, 0,
  'kcoin_guard_wrong_amount_payload',
  'kcoin_guard_wrong_amount',
  now(), 'kcoin', 'paid', 0,
  'kcoin_guard_wrong_amount_payload',
  jsonb_build_object('currency_code', 'KCOIN')
)
returning id
)
insert into _ids (key, id)
select 'wrong_amount_order', id from inserted;

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'user'),
    'KCOIN',
    100,
    'test_setup',
    null,
    null,
    'kcoin-gacha-guard-credit',
    'fixture',
    '{}'::jsonb
  );

  perform api._debit_balance(
    (select id from _ids where key = 'user'),
    'KCOIN',
    1,
    'gacha_open',
    (select id from _ids where key = 'wrong_amount_order'),
    null,
    'gacha_open:kcoin:' || (select id::text from _ids where key = 'wrong_amount_order'),
    'wrong amount fixture',
    '{}'::jsonb
  );
end;
$$;

select ok(
  testutil.raises_like(
    format(
      'update gacha.draw_orders set status = ''completed'' where id = %L::uuid',
      (select id::text from _ids where key = 'wrong_amount_order')
    ),
    '%matching kcoin debit ledger is required before opening%'
  ),
  'KCOIN draw order cannot complete with a mismatched debit amount'
);

with inserted as (
insert into gacha.draw_orders (
  user_id, box_id, pool_version_id, status, quantity, draw_count,
  unit_price_stars, discount_bps, total_price_stars, open_reward_kcoin,
  invoice_payload, idempotency_key, paid_at, payment_provider, payment_status,
  star_amount, telegram_invoice_payload, metadata
) values (
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'pool'),
  'opening', 1, 1, 10, 0, 10, 0,
  'kcoin_guard_matching_payload',
  'kcoin_guard_matching',
  now(), 'kcoin', 'paid', 0,
  'kcoin_guard_matching_payload',
  jsonb_build_object('currency_code', 'KCOIN')
)
returning id
)
insert into _ids (key, id)
select 'matching_order', id from inserted;

do $$
begin
  perform api._debit_balance(
    (select id from _ids where key = 'user'),
    'KCOIN',
    10,
    'gacha_open',
    (select id from _ids where key = 'matching_order'),
    null,
    'gacha_open:kcoin:' || (select id::text from _ids where key = 'matching_order'),
    'matching fixture',
    '{}'::jsonb
  );
end;
$$;

update gacha.draw_orders
set status = 'completed'
where id = (select id from _ids where key = 'matching_order');

select is(
  (select status from gacha.draw_orders where id = (select id from _ids where key = 'matching_order')),
  'completed',
  'KCOIN draw order completes when the matching debit ledger exists'
);

with inserted as (
insert into gacha.draw_orders (
  user_id, box_id, pool_version_id, status, quantity, draw_count,
  unit_price_stars, discount_bps, total_price_stars, open_reward_kcoin,
  invoice_payload, idempotency_key, paid_at, payment_provider, payment_status,
  star_amount, telegram_invoice_payload, metadata
) values (
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'pool'),
  'opening', 1, 1, 10, 0, 10, 0,
  'stars_guard_no_payment_payload',
  'stars_guard_no_payment',
  now(), 'telegram_stars', 'paid', 10,
  'stars_guard_no_payment_payload',
  '{}'::jsonb
)
returning id
)
insert into _ids (key, id)
select 'stars_no_payment_order', id from inserted;

select ok(
  testutil.raises_like(
    format(
      'update gacha.draw_orders set status = ''completed'' where id = %L::uuid',
      (select id::text from _ids where key = 'stars_no_payment_order')
    ),
    '%draw order payment_star_order_id is required before opening%'
  ),
  'Stars draw order still requires successful payment proof'
);

select * from finish();

rollback;
