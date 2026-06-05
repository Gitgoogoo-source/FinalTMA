-- Phase 5 step 05: Telegram Stars pre_checkout_query RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

create or replace function testutil.create_precheckout_order(
  p_prefix text,
  p_quantity integer default 1,
  p_total_amount integer default 10
)
returns jsonb
language plpgsql
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_telegram_user_id bigint := 920000000000 + floor(random() * 100000000)::bigint;
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
    'Precheckout Box ' || p_prefix,
    'precheckout fixture',
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
    metadata
  ) values (
    v_star_order_id,
    v_user_id,
    'gacha_open',
    v_draw_order_id,
    'invoice_created',
    p_total_amount,
    v_invoice_payload,
    'Precheckout Box',
    'Open blind box',
    p_prefix || '-idem',
    now() + interval '15 minutes',
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
    draw_count,
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
  payload jsonb,
  observed_at timestamptz
) on commit drop;

insert into _cases (key, payload)
values ('valid_order', testutil.create_precheckout_order('phase5-precheckout-valid', 1, 10));

insert into _cases (key, payload)
select 'valid_result', api.payment_mark_precheckout_checked(
  95050001,
  'pcq-valid',
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object(
    'update_id', 95050001,
    'pre_checkout_query', jsonb_build_object('id', 'pcq-valid')
  ),
  'headers-hash-valid',
  'req_valid',
  true
)
from _cases
where key = 'valid_order';

select ok(((select payload from _cases where key = 'valid_result') ->> 'allowed')::boolean, 'valid pre_checkout_query is allowed');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'valid_order') ->> 'star_order_id')::uuid
  ),
  'precheckout_checked',
  'valid pre_checkout marks star order precheckout_checked'
);
select ok(
  (
    select precheckout_at is not null
    from payments.star_orders
    where id = ((select payload from _cases where key = 'valid_order') ->> 'star_order_id')::uuid
  ),
  'valid pre_checkout records precheckout_at'
);
select is(
  (
    select process_status
    from payments.telegram_webhook_events
    where update_id = 95050001
  ),
  'processed',
  'valid pre_checkout event is marked processed'
);
select is(
  (
    select count(*)::integer
    from gacha.draw_results
    where draw_order_id = ((select payload from _cases where key = 'valid_order') ->> 'draw_order_id')::uuid
  ),
  0,
  'pre_checkout does not create draw_results'
);

insert into _cases (key, observed_at)
select 'valid_precheckout_at', precheckout_at
from payments.star_orders
where id = ((select payload from _cases where key = 'valid_order') ->> 'star_order_id')::uuid;

insert into _cases (key, payload)
select 'valid_duplicate_result', api.payment_mark_precheckout_checked(
  95050001,
  'pcq-valid',
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 95050001),
  'headers-hash-valid',
  'req_valid_duplicate',
  true
)
from _cases
where key = 'valid_order';

select ok(((select payload from _cases where key = 'valid_duplicate_result') ->> 'idempotent')::boolean, 'duplicate update_id returns idempotent result');
select is((select count(*)::integer from payments.telegram_webhook_events where update_id = 95050001), 1, 'duplicate update_id does not create another webhook event');
select is(
  (
    select precheckout_at
    from payments.star_orders
    where id = ((select payload from _cases where key = 'valid_order') ->> 'star_order_id')::uuid
  ),
  (select observed_at from _cases where key = 'valid_precheckout_at'),
  'duplicate update_id does not move precheckout_at'
);

insert into _cases (key, payload)
values ('retry_after_answer_failure_order', testutil.create_precheckout_order('phase5-precheckout-retry', 1, 10));

insert into _cases (key, payload)
select 'retry_after_answer_failure_first_result', api.payment_mark_precheckout_checked(
  95050008,
  'pcq-retry',
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 95050008),
  'headers-hash-retry',
  'req_retry_first',
  true
)
from _cases
where key = 'retry_after_answer_failure_order';

update payments.telegram_webhook_events
set process_status = 'failed',
    error_message = 'Telegram answerPreCheckoutQuery failed',
    processed_at = now()
where update_id = 95050008;

insert into _cases (key, payload)
select 'retry_after_answer_failure_second_result', api.payment_mark_precheckout_checked(
  95050008,
  'pcq-retry',
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 95050008),
  'headers-hash-retry',
  'req_retry_second',
  true
)
from _cases
where key = 'retry_after_answer_failure_order';

select ok(
  ((select payload from _cases where key = 'retry_after_answer_failure_second_result') ->> 'allowed')::boolean,
  'failed pre_checkout event can be retried and allowed again'
);
select ok(
  ((select payload from _cases where key = 'retry_after_answer_failure_second_result') ->> 'idempotent')::boolean,
  'retry after answer failure remains idempotent'
);
select is(
  (select process_status from payments.telegram_webhook_events where update_id = 95050008),
  'processed',
  'retry after answer failure marks event processed'
);

insert into _cases (key, payload)
values ('user_mismatch_order', testutil.create_precheckout_order('phase5-precheckout-user-mismatch', 1, 10));

insert into _cases (key, payload)
select 'user_mismatch_result', api.payment_mark_precheckout_checked(
  95050009,
  'pcq-user-mismatch',
  payload ->> 'invoice_payload',
  'XTR',
  (payload ->> 'total_amount')::integer,
  ((payload ->> 'telegram_user_id')::bigint + 1),
  jsonb_build_object('update_id', 95050009),
  'headers-hash-user-mismatch',
  'req_user_mismatch',
  true
)
from _cases
where key = 'user_mismatch_order';

select is(((select payload from _cases where key = 'user_mismatch_result') ->> 'reason_code'), 'TELEGRAM_USER_MISMATCH', 'telegram user mismatch is rejected');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'user_mismatch_order') ->> 'star_order_id')::uuid
  ),
  'invoice_created',
  'telegram user mismatch does not fail the original star order'
);

insert into _cases (key, payload)
values (
  'missing_order_result',
  api.payment_mark_precheckout_checked(
    95050002,
    'pcq-missing',
    'missing-precheckout-payload',
    'XTR',
    10,
    92050002,
    jsonb_build_object('update_id', 95050002),
    'headers-hash-missing',
    'req_missing',
    true
  )
);

select is(((select payload from _cases where key = 'missing_order_result') ->> 'reason_code'), 'ORDER_NOT_FOUND', 'missing invoice payload is rejected');
select is((select process_status from payments.telegram_webhook_events where update_id = 95050002), 'failed', 'missing order event is marked failed');

insert into _cases (key, payload)
values ('amount_order', testutil.create_precheckout_order('phase5-precheckout-amount', 1, 10));

insert into _cases (key, payload)
select 'amount_result', api.payment_mark_precheckout_checked(
  95050003,
  'pcq-amount',
  payload ->> 'invoice_payload',
  'XTR',
  11,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 95050003),
  'headers-hash-amount',
  'req_amount',
  true
)
from _cases
where key = 'amount_order';

select is(((select payload from _cases where key = 'amount_result') ->> 'reason_code'), 'AMOUNT_MISMATCH', 'amount mismatch is rejected');
select is(((select payload from _cases where key = 'amount_result') ->> 'payment_order_status'), 'failed', 'amount mismatch returns updated payment order status');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'amount_order') ->> 'star_order_id')::uuid
  ),
  'failed',
  'amount mismatch marks pending star order failed'
);

insert into _cases (key, payload)
values ('currency_order', testutil.create_precheckout_order('phase5-precheckout-currency', 1, 10));

insert into _cases (key, payload)
select 'currency_result', api.payment_mark_precheckout_checked(
  95050004,
  'pcq-currency',
  payload ->> 'invoice_payload',
  'USD',
  10,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 95050004),
  'headers-hash-currency',
  'req_currency',
  true
)
from _cases
where key = 'currency_order';

select is(((select payload from _cases where key = 'currency_result') ->> 'reason_code'), 'CURRENCY_INVALID', 'non-XTR pre_checkout is rejected');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'currency_order') ->> 'star_order_id')::uuid
  ),
  'failed',
  'currency failure marks pending star order failed'
);

insert into _cases (key, payload)
values ('expired_order', testutil.create_precheckout_order('phase5-precheckout-expired', 1, 10));

update payments.star_orders
set expires_at = now() - interval '1 minute'
where id = ((select payload from _cases where key = 'expired_order') ->> 'star_order_id')::uuid;

insert into _cases (key, payload)
select 'expired_result', api.payment_mark_precheckout_checked(
  95050005,
  'pcq-expired',
  payload ->> 'invoice_payload',
  'XTR',
  10,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 95050005),
  'headers-hash-expired',
  'req_expired',
  true
)
from _cases
where key = 'expired_order';

select is(((select payload from _cases where key = 'expired_result') ->> 'reason_code'), 'ORDER_EXPIRED', 'expired pre_checkout is rejected');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'expired_order') ->> 'star_order_id')::uuid
  ),
  'expired',
  'expired pre_checkout marks star order expired'
);

insert into _cases (key, payload)
values ('paused_order', testutil.create_precheckout_order('phase5-precheckout-paused', 1, 10));

update gacha.blind_boxes
set status = 'paused'
where id = ((select payload from _cases where key = 'paused_order') ->> 'box_id')::uuid;

insert into _cases (key, payload)
select 'paused_result', api.payment_mark_precheckout_checked(
  95050006,
  'pcq-paused',
  payload ->> 'invoice_payload',
  'XTR',
  10,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 95050006),
  'headers-hash-paused',
  'req_paused',
  true
)
from _cases
where key = 'paused_order';

select is(((select payload from _cases where key = 'paused_result') ->> 'reason_code'), 'BLIND_BOX_UNAVAILABLE', 'paused blind box pre_checkout is rejected');
select is(
  (
    select status
    from payments.star_orders
    where id = ((select payload from _cases where key = 'paused_order') ->> 'star_order_id')::uuid
  ),
  'failed',
  'paused blind box marks pending star order failed'
);

insert into _cases (key, payload)
values ('stock_order', testutil.create_precheckout_order('phase5-precheckout-stock', 10, 90));

update gacha.blind_boxes
set remaining_stock = 0
where id = ((select payload from _cases where key = 'stock_order') ->> 'box_id')::uuid;

insert into _cases (key, payload)
select 'stock_result', api.payment_mark_precheckout_checked(
  95050007,
  'pcq-stock',
  payload ->> 'invoice_payload',
  'XTR',
  90,
  (payload ->> 'telegram_user_id')::bigint,
  jsonb_build_object('update_id', 95050007),
  'headers-hash-stock',
  'req_stock',
  true
)
from _cases
where key = 'stock_order';

select ok(((select payload from _cases where key = 'stock_result') ->> 'allowed')::boolean, 'legacy zero stock does not block pre_checkout because blind boxes are unlimited');
select is(
  (
    select count(*)::integer
    from gacha.draw_results
    where draw_order_id = ((select payload from _cases where key = 'stock_order') ->> 'draw_order_id')::uuid
  ),
  0,
  'pre_checkout still does not create draw_results'
);

select * from finish();

rollback;
