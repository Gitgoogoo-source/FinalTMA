-- K-coin topup status and fulfillment checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

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

create or replace function testutil.balance_of(
  p_user_id uuid,
  p_currency_code text
)
returns numeric
language sql
stable
as $$
  select coalesce((
    select available_amount
    from economy.user_balances
    where user_id = p_user_id
      and currency_code = upper(p_currency_code)
  ), 0)::numeric;
$$;

create temp table _ids (
  key text primary key,
  id uuid
) on commit drop;

create temp table _payloads (
  key text primary key,
  payload jsonb
) on commit drop;

insert into _ids (key, id)
values ('user', testutil.make_user(9905142608, 'kcoin_topup_user'));

insert into _payloads (key, payload)
select 'created_order', api.kcoin_topup_create_order(
  (select id from _ids where key = 'user'),
  1,
  'kcoin-topup-status-test-idem-0001'
);

insert into _ids (key, id)
select 'topup_order', (payload ->> 'topup_order_id')::uuid
from _payloads
where key = 'created_order';

insert into _ids (key, id)
select 'star_order', (payload ->> 'star_order_id')::uuid
from _payloads
where key = 'created_order';

select is(
  ((select payload from _payloads where key = 'created_order') ->> 'xtr_amount')::integer,
  1,
  '1 Star topup order is allowed'
);

select is(
  ((select payload from _payloads where key = 'created_order') ->> 'kcoin_amount')::numeric,
  1::numeric,
  '1 Star maps to 1 K-coin'
);

select throws_ok(
  $$
    select api.kcoin_topup_create_order(
      (select id from _ids where key = 'user'),
      0,
      'kcoin-topup-status-test-idem-0000'
    );
  $$,
  'P0001',
  'kcoin topup amount is invalid',
  'non-positive topup order is rejected'
);

insert into _payloads (key, payload)
select 'created_status', api.kcoin_topup_get_status(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'topup_order')
);

select is(
  ((select payload from _payloads where key = 'created_status') ->> 'payment_order_status'),
  'created',
  'new topup status is created'
);

select is(
  (((select payload from _payloads where key = 'created_status') -> 'payment') ->> 'recorded')::boolean,
  false,
  'new topup has no recorded payment'
);

insert into _payloads (key, payload)
select 'first_fulfillment', api.kcoin_topup_process_paid_order(
  (select id from _ids where key = 'star_order'),
  'tg-charge-kcoin-topup-status-001',
  'provider-charge-kcoin-topup-status-001',
  jsonb_build_object('test', true, 'update_id', 99051426081)
);

select ok(
  ((select payload from _payloads where key = 'first_fulfillment') ->> 'fulfilled')::boolean,
  'paid topup fulfillment succeeds'
);

select is(
  testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'),
  1::numeric,
  'paid topup credits exactly 1 K-coin'
);

select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and currency_code = 'KCOIN'
      and source_type = 'kcoin_topup'
      and source_id = (select id from _ids where key = 'topup_order')
  ),
  1,
  'paid topup writes one K-coin ledger entry'
);

insert into _payloads (key, payload)
select 'repeat_fulfillment', api.kcoin_topup_process_paid_order(
  (select id from _ids where key = 'star_order'),
  'tg-charge-kcoin-topup-status-001',
  'provider-charge-kcoin-topup-status-001',
  jsonb_build_object('test', true, 'update_id', 99051426082)
);

select ok(
  ((select payload from _payloads where key = 'repeat_fulfillment') ->> 'idempotent')::boolean,
  'replayed topup fulfillment is idempotent'
);

select is(
  testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'),
  1::numeric,
  'replayed topup fulfillment does not credit again'
);

insert into _payloads (key, payload)
select 'fulfilled_status', api.kcoin_topup_get_status(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'topup_order')
);

select is(
  ((select payload from _payloads where key = 'fulfilled_status') ->> 'payment_order_status'),
  'fulfilled',
  'fulfilled topup status returns fulfilled'
);

select ok(
  (((select payload from _payloads where key = 'fulfilled_status') -> 'fulfillment') ->> 'credited')::boolean,
  'fulfilled topup status reports credited'
);

select * from finish();

rollback;
