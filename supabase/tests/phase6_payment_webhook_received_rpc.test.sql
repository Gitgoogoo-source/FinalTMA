-- Phase 6 payment webhook received RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = 'payment_record_telegram_webhook_received'
  ),
  'payment_record_telegram_webhook_received RPC exists'
);

create temp table _results (
  key text primary key,
  payload jsonb
) on commit drop;

insert into _results (key, payload)
select 'unknown_ignored', api.payment_record_telegram_webhook_received(
  98080001,
  'message',
  7080001,
  null,
  jsonb_build_object(
    'update_id', 98080001,
    'message', jsonb_build_object('message_id', 1, 'text', '/start')
  ),
  'headers-hash-unknown',
  'req_unknown',
  true,
  'ignored',
  null,
  jsonb_build_object('handler', 'api.telegram.webhook'),
  null,
  false
);

select is(((select payload from _results where key = 'unknown_ignored') ->> 'process_status'), 'ignored', 'unknown update is marked ignored');
select is((select count(*)::integer from payments.telegram_webhook_events where update_id = 98080001), 1, 'unknown update creates one webhook event');
select is((select event_type from payments.telegram_webhook_events where update_id = 98080001), 'message', 'unknown update stores inferred event type');
select is((select telegram_user_id from payments.telegram_webhook_events where update_id = 98080001), 7080001::bigint, 'unknown update stores telegram user id');
select is((select webhook_secret_verified from payments.telegram_webhook_events where update_id = 98080001), true, 'unknown update stores secret verification result');
select is((select status_context ->> 'handler' from payments.telegram_webhook_events where update_id = 98080001), 'api.telegram.webhook', 'unknown update stores status context');

insert into _results (key, payload)
select 'unknown_duplicate', api.payment_record_telegram_webhook_received(
  98080001,
  'message',
  7080001,
  null,
  jsonb_build_object('update_id', 98080001, 'message', jsonb_build_object('message_id', 1)),
  'headers-hash-unknown-retry',
  'req_unknown_retry',
  true,
  'received',
  null,
  jsonb_build_object('handler', 'api.telegram.webhook'),
  null,
  true
);

select ok(((select payload from _results where key = 'unknown_duplicate') ->> 'duplicate_update')::boolean, 'duplicate update reports duplicate_update');
select is((select count(*)::integer from payments.telegram_webhook_events where update_id = 98080001), 1, 'duplicate update_id does not insert a second event');
select is((select process_status from payments.telegram_webhook_events where update_id = 98080001), 'ignored', 'duplicate received write does not downgrade ignored status');
select is((select retry_count from payments.telegram_webhook_events where update_id = 98080001), 1, 'duplicate received write increments retry_count');

insert into _results (key, payload)
select 'invalid_secret_received', api.payment_record_telegram_webhook_received(
  98080002,
  'successful_payment',
  7080002,
  'invoice-secret-invalid',
  jsonb_build_object('update_id', 98080002, 'message', jsonb_build_object('successful_payment', jsonb_build_object('invoice_payload', 'invoice-secret-invalid'))),
  'headers-hash-invalid-secret',
  'req_invalid_secret',
  false,
  'received',
  null,
  jsonb_build_object('handler', 'api.telegram.webhook'),
  null,
  false
);

insert into _results (key, payload)
select 'invalid_secret_failed', api.payment_record_telegram_webhook_received(
  98080002,
  'successful_payment',
  7080002,
  'invoice-secret-invalid',
  jsonb_build_object('update_id', 98080002),
  'headers-hash-invalid-secret',
  'req_invalid_secret',
  false,
  'failed',
  'Telegram webhook secret invalid.',
  jsonb_build_object('error_reason', 'TELEGRAM_WEBHOOK_SECRET_INVALID'),
  now() + interval '5 minutes',
  false
);

select is((select process_status from payments.telegram_webhook_events where update_id = 98080002), 'failed', 'invalid secret event is failed after received write');
select is((select webhook_secret_verified from payments.telegram_webhook_events where update_id = 98080002), false, 'invalid secret remains unverified');
select is((select error_message from payments.telegram_webhook_events where update_id = 98080002), 'Telegram webhook secret invalid.', 'invalid secret stores error message');
select is((select status_context ->> 'error_reason' from payments.telegram_webhook_events where update_id = 98080002), 'TELEGRAM_WEBHOOK_SECRET_INVALID', 'invalid secret stores error reason context');
select ok((select next_retry_at is not null from payments.telegram_webhook_events where update_id = 98080002), 'invalid secret can schedule retry metadata');

insert into _results (key, payload)
select 'success_received', api.payment_record_telegram_webhook_received(
  98080003,
  'successful_payment',
  7080003,
  'missing-invoice-payload',
  jsonb_build_object(
    'update_id', 98080003,
    'message', jsonb_build_object(
      'from', jsonb_build_object('id', 7080003),
      'successful_payment', jsonb_build_object(
        'currency', 'XTR',
        'total_amount', 10,
        'invoice_payload', 'missing-invoice-payload',
        'telegram_payment_charge_id', 'tg-charge-missing-order'
      )
    )
  ),
  'headers-hash-success-received',
  'req_success_received',
  true,
  'received',
  null,
  jsonb_build_object('handler', 'api.telegram.webhook'),
  null,
  false
);

insert into _results (key, payload)
select 'success_record_result', api.payment_record_successful_payment(
  98080003,
  'missing-invoice-payload',
  'XTR',
  10,
  'tg-charge-missing-order',
  null,
  7080003,
  jsonb_build_object('update_id', 98080003),
  'headers-hash-success-record',
  'req_success_record',
  true
);

select is(
  ((select payload from _results where key = 'success_record_result') ->> 'event_id')::uuid,
  ((select payload from _results where key = 'success_received') ->> 'event_id')::uuid,
  'successful_payment business RPC reuses the pre-recorded webhook event'
);
select is((select count(*)::integer from payments.telegram_webhook_events where update_id = 98080003), 1, 'successful_payment handoff keeps one event row');
select is((select process_status from payments.telegram_webhook_events where update_id = 98080003), 'failed', 'successful_payment business RPC owns final failed status');
select is(((select payload from _results where key = 'success_record_result') ->> 'reason_code'), 'ORDER_NOT_FOUND', 'successful_payment handoff still runs business validation');

insert into _results (key, payload)
select 'invalid_update_no_id', api.payment_record_telegram_webhook_received(
  null,
  'invalid_update',
  null,
  null,
  jsonb_build_object('message', 'missing update_id'),
  'headers-hash-invalid-update',
  'req_invalid_update',
  true,
  'failed',
  'Telegram update_id missing.',
  jsonb_build_object('error_reason', 'TELEGRAM_UPDATE_ID_MISSING'),
  null,
  false
);

select is(((select payload from _results where key = 'invalid_update_no_id') ->> 'event_type'), 'invalid_update', 'invalid update without update_id is still recorded');
select is(((select payload from _results where key = 'invalid_update_no_id') ->> 'process_status'), 'failed', 'invalid update without update_id can be failed');

select * from finish();

rollback;
