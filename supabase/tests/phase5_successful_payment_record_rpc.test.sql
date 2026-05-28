-- Phase 5 step 06: Telegram Stars successful_payment record RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

create or replace function testutil.create_successful_payment_order(
  p_prefix text,
  p_quantity integer default 1,
  p_total_amount integer default 10,
  p_status text default 'precheckout_checked'
)
returns jsonb
language plpgsql
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_telegram_user_id bigint := 930000000000 + floor(random() * 100000000)::bigint;
  v_box_id uuid := gen_random_uuid();
  v_pool_id uuid := gen_random_uuid();
  v_star_order_id uuid := gen_random_uuid();
  v_draw_order_id uuid := gen_random_uuid();
  v_invoice_payload text := p_prefix || '-' || replace(gen_random_uuid()::text, '-', '');
begin
  insert into core.users (id, telegram_user_id, username, invite_code)
  values (
    v_user_id,
    v_telegram_user_id,
    p_prefix,
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  );

  insert into gacha.blind_boxes (
    id,
    slug,
    display_name,
    description,
    tier,
    status,
    price_stars,
    total_stock,
    remaining_stock,
    open_reward_kcoin,
    starts_at,
    ends_at,
    sort_order
  ) values (
    v_box_id,
    p_prefix || '-box',
    'Successful Payment Box ' || p_prefix,
    'successful payment fixture',
    'normal',
    'active',
    greatest(p_total_amount / greatest(p_quantity, 1), 1),
    100,
    100,
    100,
    now() - interval '1 hour',
    now() + interval '1 day',
    1
  );

  insert into gacha.drop_pool_versions (
    id,
    box_id,
    version_no,
    status,
    total_weight,
    published_at,
    effective_from,
    effective_to
  ) values (
    v_pool_id,
    v_box_id,
    1,
    'active',
    100,
    now(),
    now() - interval '1 hour',
    now() + interval '1 day'
  );

  insert into payments.star_orders (
    id,
    user_id,
    business_type,
    business_id,
    status,
    xtr_amount,
    telegram_invoice_payload,
    title,
    description,
    idempotency_key,
    expires_at,
    precheckout_at,
    metadata
  ) values (
    v_star_order_id,
    v_user_id,
    'gacha_open',
    v_draw_order_id,
    p_status,
    p_total_amount,
    v_invoice_payload,
    'Successful Payment Box',
    'Open blind box',
    p_prefix || '-idem',
    now() + interval '15 minutes',
    case when p_status in ('precheckout_ok', 'precheckout_checked') then now() else null end,
    jsonb_build_object('test', true)
  );

  insert into gacha.draw_orders (
    id,
    user_id,
    box_id,
    pool_version_id,
    payment_star_order_id,
    status,
    quantity,
    unit_price_stars,
    discount_bps,
    total_price_stars,
    open_reward_kcoin,
    invoice_payload,
    idempotency_key,
    metadata
  ) values (
    v_draw_order_id,
    v_user_id,
    v_box_id,
    v_pool_id,
    v_star_order_id,
    'invoice_created',
    p_quantity,
    greatest(p_total_amount / greatest(p_quantity, 1), 1),
    0,
    p_total_amount,
    100,
    v_invoice_payload,
    p_prefix || '-draw-idem',
    jsonb_build_object('test', true)
  );

  return jsonb_build_object(
    'user_id', v_user_id,
    'telegram_user_id', v_telegram_user_id,
    'box_id', v_box_id,
    'pool_id', v_pool_id,
    'star_order_id', v_star_order_id,
    'draw_order_id', v_draw_order_id,
    'invoice_payload', v_invoice_payload,
    'total_amount', p_total_amount,
    'quantity', p_quantity
  );
end;
$$;

create temp table _cases (
  key text primary key,
  payload jsonb
) on commit drop;

insert into _cases (key, payload)
values ('valid_order', testutil.create_successful_payment_order('phase5-success-valid', 1, 10));

insert into _cases (key, payload)
select 'valid_result', api.payment_record_successful_payment(
  96060001,
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  'tg-charge-success-001',
  'provider-charge-success-001',
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object(
    'update_id', 96060001,
    'message', jsonb_build_object(
      'successful_payment', jsonb_build_object(
        'telegram_payment_charge_id', 'tg-charge-success-001',
        'invoice_payload', payload ->> 'invoice_payload'
      )
    )
  ),
  'headers-hash-success',
  'req_success',
  true
)
from _cases
where key = 'valid_order';

select ok(((select payload from _cases where key = 'valid_result') ->> 'payment_recorded')::boolean, 'valid successful_payment records payment');
select is(((select payload from _cases where key = 'valid_result') ->> 'payment_order_status'), 'paid', 'valid successful_payment returns paid order status');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'valid_order') ->> 'star_order_id')::uuid
  ),
  'paid',
  'valid successful_payment marks star order paid'
);
select is(
  (
    select count(*)::integer
    from payments.star_payments
    where telegram_payment_charge_id = 'tg-charge-success-001'
  ),
  1,
  'valid successful_payment inserts one star payment'
);
select is(
  (
    select invoice_payload
    from payments.star_payments
    where telegram_payment_charge_id = 'tg-charge-success-001'
  ),
  (select payload ->> 'invoice_payload' from _cases where key = 'valid_order'),
  'star payment stores invoice payload'
);
select is(
  (
    select process_status
    from payments.telegram_webhook_events
    where update_id = 96060001
  ),
  'processed',
  'valid successful_payment event is processed'
);
select is(
  (
    select status
    from gacha.draw_orders
    where id = ((select payload from _cases where key = 'valid_order') ->> 'draw_order_id')::uuid
  ),
  'invoice_created',
  'step 06 does not fulfill the draw order'
);
select is(
  (
    select payment_status
    from gacha.draw_orders
    where id = ((select payload from _cases where key = 'valid_order') ->> 'draw_order_id')::uuid
  ),
  'paid',
  'star payment trigger mirrors paid payment_status to draw order'
);
select is(
  (
    select count(*)::integer
    from gacha.draw_results
    where draw_order_id = ((select payload from _cases where key = 'valid_order') ->> 'draw_order_id')::uuid
  ),
  0,
  'step 06 does not create draw results'
);

insert into _cases (key, payload)
select 'duplicate_update_result', api.payment_record_successful_payment(
  96060001,
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  'tg-charge-success-001',
  'provider-charge-success-001',
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 96060001),
  'headers-hash-success',
  'req_success_duplicate_update',
  true
)
from _cases
where key = 'valid_order';

select ok(((select payload from _cases where key = 'duplicate_update_result') ->> 'idempotent')::boolean, 'duplicate update_id returns idempotent result');
select ok(((select payload from _cases where key = 'duplicate_update_result') ->> 'duplicate_update')::boolean, 'duplicate update_id is reported');
select is((select count(*)::integer from payments.telegram_webhook_events where update_id = 96060001), 1, 'duplicate update_id does not create another event');
select is((select count(*)::integer from payments.star_payments where telegram_payment_charge_id = 'tg-charge-success-001'), 1, 'duplicate update_id does not create another payment');

insert into _cases (key, payload)
select 'duplicate_charge_result', api.payment_record_successful_payment(
  96060002,
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  'tg-charge-success-001',
  'provider-charge-success-001',
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 96060002),
  'headers-hash-success-duplicate-charge',
  'req_success_duplicate_charge',
  true
)
from _cases
where key = 'valid_order';

select ok(((select payload from _cases where key = 'duplicate_charge_result') ->> 'idempotent')::boolean, 'duplicate charge id returns idempotent result');
select ok(((select payload from _cases where key = 'duplicate_charge_result') ->> 'duplicate_charge')::boolean, 'duplicate charge id is reported');
select is((select process_status from payments.telegram_webhook_events where update_id = 96060002), 'ignored', 'duplicate charge event is ignored');
select is((select count(*)::integer from payments.star_payments where telegram_payment_charge_id = 'tg-charge-success-001'), 1, 'duplicate charge id does not create another payment');

insert into _cases (key, payload)
values ('amount_order', testutil.create_successful_payment_order('phase5-success-amount', 1, 10));

insert into _cases (key, payload)
select 'amount_result', api.payment_record_successful_payment(
  96060003,
  payload ->> 'invoice_payload',
  'XTR',
  11,
  'tg-charge-success-amount',
  null,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 96060003),
  'headers-hash-amount',
  'req_amount',
  true
)
from _cases
where key = 'amount_order';

select is(((select payload from _cases where key = 'amount_result') ->> 'reason_code'), 'AMOUNT_MISMATCH', 'amount mismatch is rejected');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'amount_order') ->> 'star_order_id')::uuid
  ),
  'failed',
  'amount mismatch marks pending star order failed'
);
select is((select process_status from payments.telegram_webhook_events where update_id = 96060003), 'failed', 'amount mismatch event is failed');
select is((select count(*)::integer from payments.star_payments where telegram_payment_charge_id = 'tg-charge-success-amount'), 0, 'amount mismatch does not insert payment');

insert into _cases (key, payload)
values (
  'missing_payload_result',
  api.payment_record_successful_payment(
    96060004,
    'missing-successful-payment-payload',
    'XTR',
    10,
    'tg-charge-success-missing',
    null,
    93060004,
    jsonb_build_object('update_id', 96060004),
    'headers-hash-missing',
    'req_missing',
    true
  )
);

select is(((select payload from _cases where key = 'missing_payload_result') ->> 'reason_code'), 'ORDER_NOT_FOUND', 'missing invoice payload is rejected');
select is((select process_status from payments.telegram_webhook_events where update_id = 96060004), 'failed', 'missing payload event is failed');
select is((select count(*)::integer from payments.star_payments where telegram_payment_charge_id = 'tg-charge-success-missing'), 0, 'missing payload does not insert payment');

insert into _cases (key, payload)
values ('conflict_order', testutil.create_successful_payment_order('phase5-success-conflict', 1, 10));

insert into _cases (key, payload)
select 'conflict_result', api.payment_record_successful_payment(
  96060005,
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  'tg-charge-success-001',
  null,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 96060005),
  'headers-hash-conflict',
  'req_conflict',
  true
)
from _cases
where key = 'conflict_order';

select is(((select payload from _cases where key = 'conflict_result') ->> 'reason_code'), 'PAYMENT_CHARGE_CONFLICT', 'charge id bound to another order is rejected');
select is((select process_status from payments.telegram_webhook_events where update_id = 96060005), 'failed', 'charge conflict event is failed');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'conflict_order') ->> 'star_order_id')::uuid
  ),
  'precheckout_checked',
  'charge conflict does not fail the unrelated pending order'
);

update payments.star_orders
set status = 'fulfilled',
    fulfilled_at = now()
where id = ((select payload from _cases where key = 'valid_order') ->> 'star_order_id')::uuid;

insert into _cases (key, payload)
select 'fulfilled_new_charge_result', api.payment_record_successful_payment(
  96060006,
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  'tg-charge-success-fulfilled-new',
  'provider-charge-success-fulfilled-new',
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 96060006),
  'headers-hash-fulfilled-new',
  'req_fulfilled_new',
  true
)
from _cases
where key = 'valid_order';

select is(((select payload from _cases where key = 'fulfilled_new_charge_result') ->> 'reason_code'), 'ORDER_ALREADY_FULFILLED', 'fulfilled order with new charge is rejected');
select is((select process_status from payments.telegram_webhook_events where update_id = 96060006), 'failed', 'fulfilled order new charge event is failed');
select is((select count(*)::integer from payments.star_payments where telegram_payment_charge_id = 'tg-charge-success-fulfilled-new'), 0, 'fulfilled order new charge does not create another payment');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'valid_order') ->> 'star_order_id')::uuid
  ),
  'fulfilled',
  'fulfilled order remains fulfilled after rejected new charge'
);

insert into _cases (key, payload)
select 'fulfilled_duplicate_charge_result', api.payment_record_successful_payment(
  96060007,
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  'tg-charge-success-001',
  'provider-charge-success-001',
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 96060007),
  'headers-hash-fulfilled-duplicate',
  'req_fulfilled_duplicate',
  true
)
from _cases
where key = 'valid_order';

select ok(((select payload from _cases where key = 'fulfilled_duplicate_charge_result') ->> 'duplicate_charge')::boolean, 'fulfilled order duplicate charge remains idempotent');
select is((select process_status from payments.telegram_webhook_events where update_id = 96060007), 'ignored', 'fulfilled duplicate charge event is ignored');
select is((select count(*)::integer from payments.star_payments where telegram_payment_charge_id = 'tg-charge-success-001'), 1, 'fulfilled duplicate charge does not create another payment');

select * from finish();

rollback;
