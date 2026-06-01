-- Phase 6 payment retry candidate listing RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(10);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

insert into _ids (key, id)
values
  ('user', gen_random_uuid()),
  ('retry_paid', gen_random_uuid()),
  ('retry_fulfilling', gen_random_uuid()),
  ('retry_failed', gen_random_uuid()),
  ('skip_future_retry', gen_random_uuid()),
  ('skip_exhausted_retry', gen_random_uuid()),
  ('skip_created', gen_random_uuid()),
  ('skip_fulfilled', gen_random_uuid());

insert into core.users (id, telegram_user_id, username, first_name, status)
values (
  (select id from _ids where key = 'user'),
  880061501,
  'phase6_payment_retry_candidates_user',
  'Phase6 Payment Retry Candidates',
  'active'
);

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  idempotency_key,
  paid_at,
  fulfilled_at,
  created_at,
  updated_at,
  retry_count,
  max_retry_count,
  next_retry_at,
  retry_exhausted_at
)
values
  (
    (select id from _ids where key = 'retry_paid'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'paid',
    10,
    'phase6-retry-candidates-paid',
    'Phase 6 retry paid',
    'phase6-retry-candidates-paid',
    now() - interval '10 minutes',
    null,
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    0,
    5,
    null,
    null
  ),
  (
    (select id from _ids where key = 'retry_fulfilling'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'fulfilling',
    20,
    'phase6-retry-candidates-fulfilling',
    'Phase 6 retry fulfilling',
    'phase6-retry-candidates-fulfilling',
    now() - interval '9 minutes',
    null,
    now() - interval '9 minutes',
    now() - interval '9 minutes',
    0,
    5,
    null,
    null
  ),
  (
    (select id from _ids where key = 'retry_failed'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'failed',
    30,
    'phase6-retry-candidates-failed',
    'Phase 6 retry failed',
    'phase6-retry-candidates-failed',
    now() - interval '8 minutes',
    null,
    now() - interval '8 minutes',
    now() - interval '8 minutes',
    2,
    5,
    now() - interval '1 minute',
    null
  ),
  (
    (select id from _ids where key = 'skip_future_retry'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'failed',
    35,
    'phase6-retry-candidates-future',
    'Phase 6 skip future retry',
    'phase6-retry-candidates-future',
    now() - interval '7 minutes',
    null,
    now() - interval '7 minutes',
    now() - interval '7 minutes',
    1,
    5,
    now() + interval '1 hour',
    null
  ),
  (
    (select id from _ids where key = 'skip_exhausted_retry'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'failed',
    36,
    'phase6-retry-candidates-exhausted',
    'Phase 6 skip exhausted retry',
    'phase6-retry-candidates-exhausted',
    now() - interval '7 minutes',
    null,
    now() - interval '7 minutes',
    now() - interval '7 minutes',
    5,
    5,
    null,
    now() - interval '1 minute'
  ),
  (
    (select id from _ids where key = 'skip_created'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'created',
    40,
    'phase6-retry-candidates-created',
    'Phase 6 skip created',
    'phase6-retry-candidates-created',
    null,
    null,
    now() - interval '7 minutes',
    now() - interval '7 minutes',
    0,
    5,
    null,
    null
  ),
  (
    (select id from _ids where key = 'skip_fulfilled'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'fulfilled',
    50,
    'phase6-retry-candidates-fulfilled',
    'Phase 6 skip fulfilled',
    'phase6-retry-candidates-fulfilled',
    now() - interval '6 minutes',
    now() - interval '5 minutes',
    now() - interval '6 minutes',
    now() - interval '5 minutes',
    0,
    5,
    null,
    null
  );

select ok(
  to_regprocedure('api.admin_list_retryable_payment_orders(integer)') is not null,
  'admin_list_retryable_payment_orders RPC exists'
);

select ok(
  has_function_privilege('service_role', 'api.admin_list_retryable_payment_orders(integer)', 'EXECUTE')
    and not has_function_privilege('public', 'api.admin_list_retryable_payment_orders(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'api.admin_list_retryable_payment_orders(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'api.admin_list_retryable_payment_orders(integer)', 'EXECUTE'),
  'admin_list_retryable_payment_orders is service_role only'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'retry_count',
      'max_retry_count',
      'next_retry_at',
      'retry_exhausted_at'
    ]) as expected(column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'payments'
        and c.table_name = 'star_orders'
        and c.column_name = expected.column_name
    )
  ),
  'star_orders has structured payment retry backoff columns'
);

insert into _ids (key, payload)
values ('limited_candidates', api.admin_list_retryable_payment_orders(2));

select is(
  ((select payload from _ids where key = 'limited_candidates') ->> 'limit')::integer,
  2,
  'candidate RPC returns the effective limit'
);

select is(
  jsonb_array_length((select payload from _ids where key = 'limited_candidates') -> 'orders'),
  2,
  'candidate RPC applies the limit'
);

select is(
  ((select payload from _ids where key = 'limited_candidates') #>> '{orders,0,star_order_id}')::uuid,
  (select id from _ids where key = 'retry_paid'),
  'candidate RPC orders candidates by oldest updated_at first'
);

select ok(
  ((select payload from _ids where key = 'limited_candidates') #> '{orders,0}')
    ?& array['retry_count', 'max_retry_count', 'next_retry_at', 'retry_exhausted_at'],
  'candidate RPC returns retry backoff metadata'
);

insert into _ids (key, payload)
values ('all_candidates', api.admin_list_retryable_payment_orders(10));

select is(
  jsonb_array_length((select payload from _ids where key = 'all_candidates') -> 'orders'),
  3,
  'candidate RPC returns only paid, fulfilling, and failed unfulfilled orders'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload from _ids where key = 'all_candidates') -> 'orders') as candidate(value)
    where candidate.value ->> 'status' not in ('paid', 'fulfilling', 'failed')
      or candidate.value ->> 'fulfilled_at' is not null
  ),
  'candidate RPC excludes non-retryable and fulfilled orders'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload from _ids where key = 'all_candidates') -> 'orders') as candidate(value)
    where (candidate.value ->> 'star_order_id')::uuid in (
      (select id from _ids where key = 'skip_future_retry'),
      (select id from _ids where key = 'skip_exhausted_retry')
    )
  ),
  'candidate RPC excludes future-scheduled and exhausted retries'
);

select * from finish();

rollback;
