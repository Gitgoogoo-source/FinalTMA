-- Phase 5 payment-status read RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

create or replace function testutil.create_payment_status_order(
  p_prefix text,
  p_star_status text default 'fulfilled',
  p_draw_status text default 'completed',
  p_payment_status text default 'dev_paid',
  p_with_payment boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_telegram_user_id bigint := 940000000000 + floor(random() * 100000000)::bigint;
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
    'Payment Status Box ' || p_prefix,
    'payment status fixture',
    'normal',
    'active',
    10,
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
    paid_at,
    fulfilled_at,
    metadata
  ) values (
    v_star_order_id,
    v_user_id,
    'gacha_open',
    v_draw_order_id,
    p_star_status,
    10,
    v_invoice_payload,
    'Payment Status Box',
    'Open blind box',
    p_prefix || '-idem',
    now() + interval '15 minutes',
    now() - interval '1 minute',
    case when p_star_status in ('paid', 'fulfilling', 'fulfilled') then now() - interval '30 seconds' else null end,
    case when p_star_status = 'fulfilled' then now() else null end,
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
    paid_at,
    opened_at,
    payment_provider,
    payment_status,
    star_amount,
    telegram_invoice_payload,
    metadata
  ) values (
    v_draw_order_id,
    v_user_id,
    v_box_id,
    v_pool_id,
    v_star_order_id,
    p_draw_status,
    1,
    1,
    10,
    0,
    10,
    100,
    v_invoice_payload,
    p_prefix || '-draw-idem',
    case when p_draw_status in ('paid', 'opening', 'opened', 'completed') then now() - interval '30 seconds' else null end,
    case when p_draw_status in ('opened', 'completed') then now() else null end,
    'telegram_stars',
    p_payment_status,
    10,
    v_invoice_payload,
    jsonb_build_object('test', true)
  );

  if p_with_payment then
    insert into payments.star_payments (
      star_order_id,
      user_id,
      telegram_payment_charge_id,
      provider_payment_charge_id,
      xtr_amount,
      currency,
      invoice_payload,
      raw_update,
      metadata,
      paid_at
    ) values (
      v_star_order_id,
      v_user_id,
      p_prefix || '-tg-charge',
      p_prefix || '-provider-charge',
      10,
      'XTR',
      v_invoice_payload,
      jsonb_build_object('secret', 'must-not-leak'),
      jsonb_build_object('test', true),
      now() - interval '30 seconds'
    );
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'telegram_user_id', v_telegram_user_id,
    'box_id', v_box_id,
    'pool_id', v_pool_id,
    'star_order_id', v_star_order_id,
    'draw_order_id', v_draw_order_id,
    'invoice_payload', v_invoice_payload
  );
end;
$$;

create temp table _cases (
  key text primary key,
  payload jsonb
) on commit drop;

insert into _cases (key, payload)
values (
  'fulfilled_order',
  testutil.create_payment_status_order('phase5-payment-status-fulfilled')
);

select ok(
  to_regprocedure('api.gacha_get_payment_status(uuid, uuid)') is not null,
  'gacha_get_payment_status exists'
);

select ok(
  has_function_privilege('service_role', 'api.gacha_get_payment_status(uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'api.gacha_get_payment_status(uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'api.gacha_get_payment_status(uuid, uuid)', 'EXECUTE'),
  'gacha_get_payment_status is service_role only'
);

insert into _cases (key, payload)
select 'fulfilled_status', api.gacha_get_payment_status(
  (payload ->> 'user_id')::uuid,
  (payload ->> 'draw_order_id')::uuid
)
from _cases
where key = 'fulfilled_order';

select is(
  ((select payload from _cases where key = 'fulfilled_status') -> 'draw_order' ->> 'id'),
  ((select payload from _cases where key = 'fulfilled_order') ->> 'draw_order_id'),
  'returns the requested user-owned draw order'
);

select is(
  ((select payload from _cases where key = 'fulfilled_status') -> 'star_order' ->> 'id'),
  ((select payload from _cases where key = 'fulfilled_order') ->> 'star_order_id'),
  'returns linked star order'
);

select is(
  ((select payload from _cases where key = 'fulfilled_status') -> 'payment' ->> 'currency'),
  'XTR',
  'returns sanitized successful payment summary'
);

select ok(
  position('telegram_payment_charge_id' in (select payload::text from _cases where key = 'fulfilled_status')) = 0
    and position('provider_payment_charge_id' in (select payload::text from _cases where key = 'fulfilled_status')) = 0
    and position('raw_update' in (select payload::text from _cases where key = 'fulfilled_status')) = 0
    and position('must-not-leak' in (select payload::text from _cases where key = 'fulfilled_status')) = 0,
  'does not expose payment charge ids or raw webhook payload'
);

select ok(
  api.gacha_get_payment_status(
    gen_random_uuid(),
    ((select payload from _cases where key = 'fulfilled_order') ->> 'draw_order_id')::uuid
  ) is null,
  'returns null for orders not owned by the caller'
);

select *
from finish();

rollback;
