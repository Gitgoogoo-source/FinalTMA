-- Phase 5 server idempotency RPC facade checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(11);

create temp table _ids (
  key text primary key,
  value text,
  payload jsonb
) on commit drop;

insert into core.users (id, telegram_user_id, username, invite_code)
values (
  '10000000-0000-4000-8000-000000000501',
  9500000501,
  'phase5_idempotency_rpc',
  'P5IDEM0501'
)
on conflict (id) do nothing;

select ok(
  to_regprocedure('api.idempotency_insert_started(text,text,uuid,text,timestamptz)') is not null
    and to_regprocedure('api.idempotency_get(text,text)') is not null
    and to_regprocedure('api.idempotency_update_status(text,text,text,text,timestamptz,text,timestamptz,jsonb,boolean)') is not null,
  'idempotency facade functions exist'
);

select ok(
  has_function_privilege('service_role', 'api.idempotency_insert_started(text,text,uuid,text,timestamptz)', 'EXECUTE')
    and has_function_privilege('service_role', 'api.idempotency_get(text,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'api.idempotency_update_status(text,text,text,text,timestamptz,text,timestamptz,jsonb,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'api.idempotency_insert_started(text,text,uuid,text,timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'api.idempotency_insert_started(text,text,uuid,text,timestamptz)', 'EXECUTE'),
  'idempotency facade functions are service_role only'
);

insert into _ids (key, value, payload)
values (
  'lock1',
  '2026-05-30T08:00:00Z',
  api.idempotency_insert_started(
    'wallet.connect',
    'phase5-idempotency-facade-key',
    '10000000-0000-4000-8000-000000000501',
    'hash-one',
    '2026-05-30T08:00:00Z'::timestamptz
  )
);

select is(
  (select payload ->> 'status' from _ids where key = 'lock1'),
  'started',
  'insert_started returns a started record'
);

select is(
  (select payload ->> 'scope' from _ids where key = 'lock1'),
  'wallet.connect',
  'insert_started stores the requested scope'
);

insert into _ids (key, payload)
values (
  'get1',
  api.idempotency_get('wallet.connect', 'phase5-idempotency-facade-key')
);

select is(
  (select payload ->> 'request_hash' from _ids where key = 'get1'),
  'hash-one',
  'get returns the stored request hash'
);

insert into _ids (key, payload)
values (
  'complete1',
  api.idempotency_update_status(
    'wallet.connect',
    'phase5-idempotency-facade-key',
    'hash-one',
    'started',
    (select value from _ids where key = 'lock1')::timestamptz,
    'completed',
    null,
    '{"ok":true,"value":1}'::jsonb,
    true
  )
);

select is(
  (select payload ->> 'status' from _ids where key = 'complete1'),
  'completed',
  'update_status can complete a started record'
);

select is(
  (select payload -> 'response' ->> 'value' from _ids where key = 'complete1'),
  '1',
  'update_status stores completion response'
);

select is(
  (select status from ops.idempotency_keys where key = 'phase5-idempotency-facade-key'),
  'completed',
  'facade writes the private ops idempotency table'
);

select is(
  api.idempotency_update_status(
    'wallet.connect',
    'phase5-idempotency-facade-key',
    'hash-one',
    'started',
    (select value from _ids where key = 'lock1')::timestamptz,
    'failed',
    null,
    '{"ok":false}'::jsonb,
    true
  ),
  null,
  'stale status and lock do not update an already completed record'
);

insert into _ids (key, value, payload)
values (
  'lock2',
  '2026-05-30T07:00:00Z',
  api.idempotency_insert_started(
    'wallet.mint',
    'phase5-idempotency-takeover-key',
    '10000000-0000-4000-8000-000000000501',
    'hash-two',
    '2026-05-30T07:00:00Z'::timestamptz
  )
);

insert into _ids (key, payload)
values (
  'takeover',
  api.idempotency_update_status(
    'wallet.mint',
    'phase5-idempotency-takeover-key',
    'hash-two',
    'started',
    (select value from _ids where key = 'lock2')::timestamptz,
    'started',
    '2026-05-30T08:05:00Z'::timestamptz,
    null,
    false
  )
);

select is(
  (select payload ->> 'locked_until' from _ids where key = 'takeover'),
  '2026-05-30T08:05:00+00:00',
  'update_status can take over a matching stale lock'
);

select is(
  api.idempotency_get('wallet.connect', 'missing-idempotency-key'),
  null,
  'get returns null for a missing scoped key'
);

select * from finish();

rollback;
