-- K-coin opens and K-coin topups through Telegram Stars.
--
-- User-facing change:
-- - Opening blind boxes spends internal KCOIN in one database transaction.
-- - Telegram Stars is only used to recharge KCOIN when the user chooses a
--   topup amount.

begin;

alter table payments.star_orders
  drop constraint if exists star_orders_business_type_check;

alter table payments.star_orders
  add constraint star_orders_business_type_check
  check (business_type in ('gacha_open', 'vip_monthly', 'kcoin_topup', 'admin_test', 'other'));

alter table gacha.draw_orders
  drop constraint if exists draw_orders_payment_provider_check;

alter table gacha.draw_orders
  add constraint draw_orders_payment_provider_check
  check (
    payment_provider is null
    or payment_provider in ('dev', 'telegram_stars', 'vip_daily_free', 'kcoin')
  );

create table if not exists payments.kcoin_topup_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  star_order_id uuid unique references payments.star_orders(id) on delete set null,
  status text not null default 'created'
    check (status in (
      'created',
      'invoice_created',
      'paid',
      'fulfilling',
      'fulfilled',
      'cancelled',
      'expired',
      'failed',
      'refunded'
    )),
  xtr_amount integer not null check (xtr_amount > 0),
  kcoin_amount numeric(38,0) not null check (kcoin_amount > 0),
  invoice_payload text not null unique check (nullif(btrim(invoice_payload), '') is not null),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  paid_at timestamptz,
  fulfilled_at timestamptz,
  credit_ledger_id uuid references economy.currency_ledger(id) on delete set null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kcoin_amount = xtr_amount)
);

comment on table payments.kcoin_topup_orders is
  'KCOIN recharge business orders. Telegram Stars is only the external payment rail; successful webhook fulfillment credits KCOIN ledger.';

alter table payments.kcoin_topup_orders enable row level security;

drop trigger if exists kcoin_topup_orders_set_updated_at on payments.kcoin_topup_orders;
create trigger kcoin_topup_orders_set_updated_at
  before update on payments.kcoin_topup_orders
  for each row execute function core.set_updated_at();

create index if not exists kcoin_topup_orders_user_status_created_idx
  on payments.kcoin_topup_orders (user_id, status, created_at desc);

create index if not exists kcoin_topup_orders_star_order_idx
  on payments.kcoin_topup_orders (star_order_id);

revoke all on table payments.kcoin_topup_orders from public, anon, authenticated;
grant select, insert, update on table payments.kcoin_topup_orders to service_role;

create or replace function api.kcoin_topup_create_order(
  p_user_id uuid,
  p_amount integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_status text;
  v_existing payments.kcoin_topup_orders%rowtype;
  v_existing_star_order payments.star_orders%rowtype;
  v_amount integer := p_amount;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_topup_order_id uuid := pg_catalog.gen_random_uuid();
  v_star_order_id uuid := pg_catalog.gen_random_uuid();
  v_payload text;
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;
  if v_amount not in (1, 500, 1000, 5000, 10000) then
    raise exception 'kcoin topup amount is invalid';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('kcoin_topup_create_order'),
    pg_catalog.hashtext(v_key)
  );

  select status into v_user_status
  from core.users
  where id = p_user_id
  for update;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  select * into v_existing
  from payments.kcoin_topup_orders
  where idempotency_key = v_key
  for update;

  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id or v_existing.xtr_amount <> v_amount then
      raise exception 'idempotency key conflict';
    end if;

    select * into v_existing_star_order
    from payments.star_orders
    where id = v_existing.star_order_id;

    return jsonb_build_object(
      'topup_order_id', v_existing.id,
      'star_order_id', v_existing.star_order_id,
      'invoice_payload', v_existing.invoice_payload,
      'xtr_amount', v_existing.xtr_amount,
      'kcoin_amount', v_existing.kcoin_amount,
      'status', v_existing.status,
      'payment_order_status', coalesce(v_existing_star_order.status, v_existing.status),
      'expires_at', v_existing_star_order.expires_at,
      'paid_at', v_existing.paid_at,
      'fulfilled_at', v_existing.fulfilled_at,
      'idempotent', true
    );
  end if;

  v_payload :=
    'kcoin_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into payments.kcoin_topup_orders (
    id,
    user_id,
    status,
    xtr_amount,
    kcoin_amount,
    invoice_payload,
    idempotency_key,
    metadata
  ) values (
    v_topup_order_id,
    p_user_id,
    'created',
    v_amount,
    v_amount,
    v_payload,
    v_key,
    jsonb_build_object(
      'exchange_rate', '1_star_to_1_kcoin',
      'allowed_amounts', jsonb_build_array(1, 500, 1000, 5000, 10000)
    )
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
    p_user_id,
    'kcoin_topup',
    v_topup_order_id,
    'created',
    v_amount,
    v_payload,
    'K-coin Recharge',
    v_amount::text || ' K-coin',
    v_key,
    v_expires_at,
    jsonb_build_object(
      'topup_order_id', v_topup_order_id,
      'kcoin_amount', v_amount,
      'exchange_rate', '1_star_to_1_kcoin'
    )
  );

  update payments.kcoin_topup_orders
  set star_order_id = v_star_order_id,
      updated_at = now()
  where id = v_topup_order_id;

  return jsonb_build_object(
    'topup_order_id', v_topup_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', v_amount,
    'kcoin_amount', v_amount,
    'status', 'created',
    'payment_order_status', 'created',
    'expires_at', v_expires_at,
    'idempotent', false
  );
end;
$$;

create or replace function api.kcoin_topup_process_paid_order(
  p_star_order_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_raw_update jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_star_order payments.star_orders%rowtype;
  v_topup_order payments.kcoin_topup_orders%rowtype;
  v_payment payments.star_payments%rowtype;
  v_credit jsonb;
  v_credit_ledger_id uuid;
  v_charge_id text := nullif(btrim(coalesce(p_telegram_payment_charge_id, '')), '');
  v_provider_charge_id text := nullif(btrim(coalesce(p_provider_payment_charge_id, '')), '');
  v_raw_update jsonb := coalesce(p_raw_update, '{}'::jsonb);
begin
  if p_star_order_id is null or v_charge_id is null then
    raise exception 'star_order_id and telegram_payment_charge_id are required';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  if v_star_order.id is null then
    raise exception 'star order not found';
  end if;
  if v_star_order.business_type <> 'kcoin_topup' then
    raise exception 'Stars order business type is not kcoin_topup';
  end if;

  select * into v_topup_order
  from payments.kcoin_topup_orders
  where id = v_star_order.business_id
    and star_order_id = v_star_order.id
  for update;

  if v_topup_order.id is null then
    raise exception 'kcoin topup order not found';
  end if;
  if v_star_order.user_id <> v_topup_order.user_id then
    raise exception 'kcoin topup order user mismatch';
  end if;
  if v_star_order.xtr_amount <> v_topup_order.xtr_amount
     or v_topup_order.kcoin_amount <> v_topup_order.xtr_amount then
    raise exception 'kcoin topup amount mismatch';
  end if;
  if v_star_order.telegram_invoice_payload <> v_topup_order.invoice_payload then
    raise exception 'kcoin topup invoice payload mismatch';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('kcoin_topup_process_paid_order:user'),
    pg_catalog.hashtext(v_topup_order.user_id::text)
  );

  perform 1
  from core.users
  where id = v_topup_order.user_id
  for update;

  if not found then
    raise exception 'user not found';
  end if;

  select * into v_payment
  from payments.star_payments
  where telegram_payment_charge_id = v_charge_id
  for update;

  if v_payment.id is not null and v_payment.star_order_id <> v_star_order.id then
    raise exception 'telegram payment charge id is already bound to another order';
  end if;

  if v_topup_order.status = 'fulfilled' and v_topup_order.credit_ledger_id is not null then
    if v_payment.id is null then
      raise exception 'fulfilled kcoin topup order has no matching payment charge';
    end if;

    update payments.star_orders
    set status = 'fulfilled',
        fulfilled_at = coalesce(fulfilled_at, v_topup_order.fulfilled_at, now()),
        error_message = null,
        updated_at = now()
    where id = v_star_order.id
    returning * into v_star_order;

    return jsonb_build_object(
      'fulfilled', true,
      'idempotent', true,
      'retryable', false,
      'business_type', 'kcoin_topup',
      'star_order_id', v_star_order.id,
      'star_payment_id', v_payment.id,
      'topup_order_id', v_topup_order.id,
      'kcoin_amount', v_topup_order.kcoin_amount,
      'credit_ledger_id', v_topup_order.credit_ledger_id,
      'telegram_payment_charge_id', v_charge_id,
      'payment_order_status', v_star_order.status
    );
  end if;

  if v_star_order.status not in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked', 'paid', 'fulfilling', 'failed') then
    raise exception 'kcoin topup star order status is not fulfillable';
  end if;
  if v_topup_order.status not in ('created', 'invoice_created', 'paid', 'fulfilling', 'failed') then
    raise exception 'kcoin topup order status is not fulfillable';
  end if;

  if v_payment.id is null then
    insert into payments.star_payments (
      star_order_id,
      user_id,
      telegram_payment_charge_id,
      provider_payment_charge_id,
      xtr_amount,
      currency,
      invoice_payload,
      raw_update
    ) values (
      v_star_order.id,
      v_star_order.user_id,
      v_charge_id,
      v_provider_charge_id,
      v_star_order.xtr_amount,
      'XTR',
      v_star_order.telegram_invoice_payload,
      v_raw_update
    )
    on conflict (telegram_payment_charge_id) do nothing
    returning * into v_payment;

    if v_payment.id is null then
      select * into v_payment
      from payments.star_payments
      where telegram_payment_charge_id = v_charge_id
      for update;
    end if;
  end if;

  if v_payment.id is null or v_payment.star_order_id <> v_star_order.id then
    raise exception 'successful payment row is missing or conflicting';
  end if;

  update payments.star_orders
  set status = 'fulfilling',
      paid_at = coalesce(paid_at, v_payment.paid_at, now()),
      error_message = null,
      updated_at = now()
  where id = v_star_order.id
  returning * into v_star_order;

  update payments.kcoin_topup_orders
  set status = 'fulfilling',
      paid_at = coalesce(paid_at, v_payment.paid_at, now()),
      error_message = null,
      updated_at = now()
  where id = v_topup_order.id
  returning * into v_topup_order;

  v_credit := api._credit_balance(
    v_topup_order.user_id,
    'KCOIN',
    v_topup_order.kcoin_amount,
    'kcoin_topup',
    v_topup_order.id,
    null,
    'kcoin_topup:' || v_topup_order.id::text,
    'K-coin topup via Telegram Stars',
    jsonb_build_object(
      'topup_order_id', v_topup_order.id,
      'star_order_id', v_star_order.id,
      'star_payment_id', v_payment.id,
      'telegram_payment_charge_id', v_charge_id,
      'xtr_amount', v_topup_order.xtr_amount,
      'exchange_rate', '1_star_to_1_kcoin'
    )
  );
  v_credit_ledger_id := (v_credit ->> 'ledger_id')::uuid;

  update payments.kcoin_topup_orders
  set status = 'fulfilled',
      fulfilled_at = coalesce(fulfilled_at, now()),
      credit_ledger_id = coalesce(credit_ledger_id, v_credit_ledger_id),
      error_message = null,
      updated_at = now()
  where id = v_topup_order.id
  returning * into v_topup_order;

  update payments.star_orders
  set status = 'fulfilled',
      fulfilled_at = coalesce(fulfilled_at, now()),
      error_message = null,
      updated_at = now()
  where id = v_star_order.id
  returning * into v_star_order;

  return jsonb_build_object(
    'fulfilled', true,
    'idempotent', false,
    'retryable', false,
    'business_type', 'kcoin_topup',
    'star_order_id', v_star_order.id,
    'star_payment_id', v_payment.id,
    'topup_order_id', v_topup_order.id,
    'kcoin_amount', v_topup_order.kcoin_amount,
    'kcoin_ledger', v_credit,
    'credit_ledger_id', v_topup_order.credit_ledger_id,
    'telegram_payment_charge_id', v_charge_id,
    'payment_order_status', v_star_order.status
  );
end;
$$;

create or replace function api.payment_record_star_invoice_failure(
  p_star_order_id uuid,
  p_draw_order_id uuid,
  p_payload text,
  p_open_mode text,
  p_expires_at timestamptz,
  p_raw_request jsonb,
  p_raw_response jsonb,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice payments.star_invoices%rowtype;
  v_star_order payments.star_orders%rowtype;
  v_payload text := nullif(trim(p_payload), '');
  v_open_mode text := coalesce(nullif(trim(p_open_mode), ''), 'web_app_open_invoice');
  v_error_message text := left(trim(coalesce(p_error_message, 'Telegram Stars invoice failed.')), 500);
begin
  if p_star_order_id is null then
    raise exception 'star_order_id is required';
  end if;
  if p_draw_order_id is null then
    raise exception 'draw_order_id is required';
  end if;
  if v_payload is null then
    raise exception 'invoice payload is required';
  end if;
  if v_open_mode not in ('telegram_link', 'web_app_open_invoice', 'bot_api', 'unknown') then
    raise exception 'invoice open_mode is invalid';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  insert into payments.star_invoices (
    star_order_id,
    invoice_link,
    payload,
    status,
    open_mode,
    bot_api_method,
    expires_at,
    raw_request,
    raw_response
  ) values (
    p_star_order_id,
    null,
    v_payload,
    'failed',
    v_open_mode,
    'createInvoiceLink',
    p_expires_at,
    coalesce(p_raw_request, '{}'::jsonb),
    coalesce(p_raw_response, '{}'::jsonb)
  )
  on conflict (payload) do update
  set star_order_id = excluded.star_order_id,
      invoice_link = null,
      status = excluded.status,
      open_mode = excluded.open_mode,
      bot_api_method = excluded.bot_api_method,
      expires_at = excluded.expires_at,
      raw_request = excluded.raw_request,
      raw_response = excluded.raw_response,
      updated_at = now()
  returning * into v_invoice;

  update payments.star_orders
  set status = 'failed',
      error_message = v_error_message,
      updated_at = now()
  where id = p_star_order_id;

  if v_star_order.business_type = 'gacha_open' then
    update gacha.draw_orders
    set status = 'failed',
        payment_status = 'failed',
        telegram_invoice_payload = v_payload,
        error_message = v_error_message,
        updated_at = now()
    where id = p_draw_order_id;
  elsif v_star_order.business_type = 'kcoin_topup' then
    update payments.kcoin_topup_orders
    set status = 'failed',
        error_message = v_error_message,
        updated_at = now()
    where id = p_draw_order_id
      and star_order_id = p_star_order_id;
  end if;

  return jsonb_build_object(
    'star_order_id', v_invoice.star_order_id,
    'business_type', v_star_order.business_type,
    'business_id', v_star_order.business_id,
    'payload', v_invoice.payload,
    'status', v_invoice.status,
    'open_mode', v_invoice.open_mode,
    'bot_api_method', v_invoice.bot_api_method,
    'expires_at', v_invoice.expires_at
  );
end;
$$;

create or replace function api.payment_mark_order_invoice_created(
  p_star_order_id uuid,
  p_draw_order_id uuid,
  p_invoice_payload text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_star_order payments.star_orders%rowtype;
  v_payload text := nullif(trim(p_invoice_payload), '');
begin
  if p_star_order_id is null then
    raise exception 'star_order_id is required';
  end if;
  if p_draw_order_id is null then
    raise exception 'draw_order_id is required';
  end if;
  if v_payload is null then
    raise exception 'invoice payload is required';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  update payments.star_orders
  set status = case when status = 'created' then 'invoice_created' else status end,
      error_message = null,
      updated_at = now()
  where id = p_star_order_id
  returning * into v_star_order;

  if v_star_order.business_type = 'gacha_open' then
    update gacha.draw_orders
    set status = 'invoice_created',
        payment_status = 'pending',
        telegram_invoice_payload = v_payload,
        error_message = null,
        updated_at = now()
    where id = p_draw_order_id;
  elsif v_star_order.business_type = 'kcoin_topup' then
    update payments.kcoin_topup_orders
    set status = case when status = 'created' then 'invoice_created' else status end,
        error_message = null,
        updated_at = now()
    where id = p_draw_order_id
      and star_order_id = p_star_order_id;
  elsif v_star_order.business_type = 'vip_monthly' then
    update vip.vip_orders
    set status = case when status = 'created' then 'invoice_created' else status end,
        error_message = null,
        updated_at = now()
    where id = p_draw_order_id
      and star_order_id = p_star_order_id;
  end if;

  return jsonb_build_object(
    'star_order_id', p_star_order_id,
    'business_type', v_star_order.business_type,
    'business_id', v_star_order.business_id,
    'draw_order_id', case when v_star_order.business_type = 'gacha_open' then p_draw_order_id else null end,
    'vip_order_id', case when v_star_order.business_type = 'vip_monthly' then p_draw_order_id else null end,
    'topup_order_id', case when v_star_order.business_type = 'kcoin_topup' then p_draw_order_id else null end,
    'invoice_payload', v_payload
  );
end;
$$;

do $$
declare
  v_function_def text;
  v_updated_function_def text;
begin
  select pg_get_functiondef(
    'api.payment_mark_precheckout_checked(bigint,text,text,text,integer,bigint,jsonb,text,text,boolean)'::regprocedure
  )
  into v_function_def;

  v_updated_function_def := v_function_def;

  v_updated_function_def := replace(
    v_updated_function_def,
    E'  v_vip_order vip.vip_orders%rowtype;\n  v_plan vip.vip_plans%rowtype;',
    E'  v_vip_order vip.vip_orders%rowtype;\n  v_topup_order payments.kcoin_topup_orders%rowtype;\n  v_plan vip.vip_plans%rowtype;'
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    E'  v_target_vip_status text := null;\n',
    E'  v_target_vip_status text := null;\n  v_target_topup_status text := null;\n'
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    E'v_star_order.business_type not in (''gacha_open'', ''vip_monthly'')',
    E'v_star_order.business_type not in (''gacha_open'', ''vip_monthly'', ''kcoin_topup'')'
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    E'    v_target_vip_status := ''failed'';\n',
    E'    v_target_vip_status := ''failed'';\n    v_target_topup_status := ''failed'';\n'
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    E'    v_target_vip_status := ''expired'';\n',
    E'    v_target_vip_status := ''expired'';\n    v_target_topup_status := ''expired'';\n'
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    E'    end if;\n  end if;\n\n  v_duration_ms := greatest(',
    E'    end if;\n  elsif v_star_order.id is not null and v_star_order.business_type = ''kcoin_topup'' then\n    select * into v_topup_order\n    from payments.kcoin_topup_orders\n    where id = v_star_order.business_id\n      and star_order_id = v_star_order.id\n    for update;\n\n    if v_allowed and v_topup_order.id is null then\n      v_allowed := false;\n      v_reason_code := ''KCOIN_TOPUP_ORDER_NOT_FOUND'';\n      v_error_message := ''K-coin topup order not found.'';\n      v_target_payment_status := ''failed'';\n    end if;\n\n    if v_allowed and v_topup_order.user_id <> v_star_order.user_id then\n      v_allowed := false;\n      v_reason_code := ''KCOIN_TOPUP_ORDER_USER_MISMATCH'';\n      v_error_message := ''K-coin topup order user mismatch.'';\n      v_target_payment_status := ''failed'';\n      v_target_topup_status := ''failed'';\n    end if;\n\n    if v_allowed and v_topup_order.status not in (''created'', ''invoice_created'') then\n      v_allowed := false;\n      v_reason_code := ''KCOIN_TOPUP_ORDER_STATUS_NOT_PAYABLE'';\n      v_error_message := ''K-coin topup order is not payable.'';\n    end if;\n\n    if v_allowed and v_topup_order.xtr_amount <> p_total_amount then\n      v_allowed := false;\n      v_reason_code := ''KCOIN_TOPUP_ORDER_AMOUNT_MISMATCH'';\n      v_error_message := ''K-coin topup order amount mismatch.'';\n      v_target_payment_status := ''failed'';\n      v_target_topup_status := ''failed'';\n    end if;\n\n    if v_allowed and v_topup_order.kcoin_amount <> v_topup_order.xtr_amount then\n      v_allowed := false;\n      v_reason_code := ''KCOIN_TOPUP_EXCHANGE_MISMATCH'';\n      v_error_message := ''K-coin topup exchange amount mismatch.'';\n      v_target_payment_status := ''failed'';\n      v_target_topup_status := ''failed'';\n    end if;\n\n    if v_allowed and v_topup_order.invoice_payload <> v_normalized_payload then\n      v_allowed := false;\n      v_reason_code := ''KCOIN_TOPUP_ORDER_PAYLOAD_MISMATCH'';\n      v_error_message := ''K-coin topup order payload mismatch.'';\n      v_target_payment_status := ''failed'';\n      v_target_topup_status := ''failed'';\n    end if;\n  end if;\n\n  v_duration_ms := greatest('
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    E'    if v_vip_order.id is not null then\n      update vip.vip_orders\n      set status = case\n            when v_target_vip_status is not null\n             and status in (''created'', ''invoice_created'')\n              then v_target_vip_status\n            else status\n          end,\n          error_message = left(v_error_message, 1000),\n          updated_at = now()\n      where id = v_vip_order.id\n      returning * into v_vip_order;\n    end if;\n\n    update payments.telegram_webhook_events',
    E'    if v_vip_order.id is not null then\n      update vip.vip_orders\n      set status = case\n            when v_target_vip_status is not null\n             and status in (''created'', ''invoice_created'')\n              then v_target_vip_status\n            else status\n          end,\n          error_message = left(v_error_message, 1000),\n          updated_at = now()\n      where id = v_vip_order.id\n      returning * into v_vip_order;\n    end if;\n\n    if v_topup_order.id is not null then\n      update payments.kcoin_topup_orders\n      set status = case\n            when v_target_topup_status is not null\n             and status in (''created'', ''invoice_created'')\n              then v_target_topup_status\n            else status\n          end,\n          error_message = left(v_error_message, 1000),\n          updated_at = now()\n      where id = v_topup_order.id\n      returning * into v_topup_order;\n    end if;\n\n    update payments.telegram_webhook_events'
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    E'  elsif v_star_order.business_type = ''vip_monthly'' then\n    update vip.vip_orders\n    set status = case when status = ''created'' then ''invoice_created'' else status end,\n        error_message = null,\n        updated_at = now()\n    where id = v_vip_order.id\n    returning * into v_vip_order;\n  end if;\n\n  update payments.telegram_webhook_events',
    E'  elsif v_star_order.business_type = ''vip_monthly'' then\n    update vip.vip_orders\n    set status = case when status = ''created'' then ''invoice_created'' else status end,\n        error_message = null,\n        updated_at = now()\n    where id = v_vip_order.id\n    returning * into v_vip_order;\n  elsif v_star_order.business_type = ''kcoin_topup'' then\n    update payments.kcoin_topup_orders\n    set status = case when status = ''created'' then ''invoice_created'' else status end,\n        error_message = null,\n        updated_at = now()\n    where id = v_topup_order.id\n    returning * into v_topup_order;\n  end if;\n\n  update payments.telegram_webhook_events'
  );

  if position('kcoin_topup' in v_updated_function_def) = 0
     or position('v_topup_order payments.kcoin_topup_orders%rowtype' in v_updated_function_def) = 0 then
    raise exception 'failed to patch payment_mark_precheckout_checked for kcoin_topup';
  end if;

  execute v_updated_function_def;
end;
$$;

do $$
declare
  v_function_def text;
  v_updated_function_def text;
begin
  select pg_get_functiondef(
    'api.payment_record_successful_payment(bigint,text,text,integer,text,text,bigint,jsonb,text,text,boolean)'::regprocedure
  )
  into v_function_def;

  v_updated_function_def := replace(
    v_function_def,
    E'v_star_order.business_type not in (''gacha_open'', ''vip_monthly'')',
    E'v_star_order.business_type not in (''gacha_open'', ''vip_monthly'', ''kcoin_topup'')'
  );

  if v_updated_function_def = v_function_def
     or position('kcoin_topup' in v_updated_function_def) = 0 then
    raise exception 'failed to patch payment_record_successful_payment for kcoin_topup';
  end if;

  execute v_updated_function_def;
end;
$$;

create or replace function api.gacha_process_paid_order(
  p_star_order_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_raw_update jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_star_order payments.star_orders%rowtype;
  v_result jsonb;
  v_draw_order_id uuid;
  v_user_id uuid;
  v_draw_count integer;
  v_event_date date;
  v_progress_result jsonb;
begin
  if p_star_order_id is null then
    raise exception 'star_order_id is required';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id;

  if v_star_order.id is null then
    raise exception 'star order not found';
  end if;

  if v_star_order.business_type = 'vip_monthly' then
    return api.vip_process_paid_order(
      p_star_order_id,
      p_telegram_payment_charge_id,
      p_provider_payment_charge_id,
      p_raw_update
    );
  end if;

  if v_star_order.business_type = 'kcoin_topup' then
    return api.kcoin_topup_process_paid_order(
      p_star_order_id,
      p_telegram_payment_charge_id,
      p_provider_payment_charge_id,
      p_raw_update
    );
  end if;

  v_result := api.gacha_process_paid_order_without_task_progress(
    p_star_order_id,
    p_telegram_payment_charge_id,
    p_provider_payment_charge_id,
    p_raw_update
  );

  v_draw_order_id := nullif(v_result ->> 'draw_order_id', '')::uuid;

  if v_draw_order_id is not null then
    select
      user_id,
      greatest(coalesce(draw_count, quantity, 1), 1),
      coalesce(opened_at, updated_at, now())::date
    into v_user_id, v_draw_count, v_event_date
    from gacha.draw_orders
    where id = v_draw_order_id;

    if v_user_id is not null then
      v_progress_result := api.task_record_progress(
        v_user_id,
        'gacha_open_success',
        v_draw_count,
        v_draw_order_id,
        coalesce(v_event_date, current_date)::text
      );

      v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function api.gacha_open_with_kcoin_from_server_price(
  p_user_id uuid,
  p_box_slug text,
  p_quantity integer,
  p_idempotency_key text,
  p_unit_price_kcoin integer,
  p_discount_bps integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order gacha.draw_orders%rowtype;
  v_existing_box_slug text;
  v_existing_results_count integer := 0;
  v_user_status text;
  v_box gacha.blind_boxes%rowtype;
  v_pool gacha.drop_pool_versions%rowtype;
  v_unit_price integer;
  v_discount_bps integer;
  v_total_price integer;
  v_draw_order_id uuid := pg_catalog.gen_random_uuid();
  v_payload text;
  v_idempotency_key text;
  v_debit jsonb;
  v_pity record;
  v_use_pity boolean;
  v_reward record;
  v_total_weight numeric(38,8);
  v_roll numeric(38,8);
  v_form_id uuid;
  v_power integer;
  v_item_id uuid;
  v_should_reset boolean;
  v_reward_kcoin numeric(38,0);
  v_results jsonb := '[]'::jsonb;
  v_credit jsonb;
  v_referral_first_open jsonb;
  v_referral_commission jsonb;
  v_referral_commission_setting jsonb;
  v_referral_commission_bps integer;
  v_progress_result jsonb;
  v_draw_i integer;
  v_rows integer;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  v_idempotency_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_idempotency_key is null then
    raise exception 'idempotency_key is required';
  end if;

  if nullif(trim(coalesce(p_box_slug, '')), '') is null then
    raise exception 'box slug is required';
  end if;
  if p_quantity not in (1, 10) then
    raise exception 'quantity must be 1 or 10';
  end if;
  if p_unit_price_kcoin is null or p_unit_price_kcoin <= 0 then
    raise exception 'unit price kcoin must be positive';
  end if;
  if p_discount_bps is null or p_discount_bps < 0 or p_discount_bps > 10000 then
    raise exception 'discount bps must be between 0 and 10000';
  end if;
  if p_quantity = 1 and p_discount_bps <> 0 then
    raise exception 'single draw discount bps must be zero';
  end if;

  v_unit_price := p_unit_price_kcoin;
  v_discount_bps := p_discount_bps;
  v_total_price := ceil((v_unit_price * p_quantity)::numeric * (10000 - v_discount_bps)::numeric / 10000)::integer;

  if v_total_price <= 0 then
    raise exception 'total price kcoin must be positive';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('gacha_open_with_kcoin_from_server_price'),
    pg_catalog.hashtext(v_idempotency_key)
  );

  select status into v_user_status
  from core.users
  where id = p_user_id
  for update;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  select * into v_existing_order
  from gacha.draw_orders
  where idempotency_key = v_idempotency_key
  for update;

  if v_existing_order.id is not null then
    select b.slug into v_existing_box_slug
    from gacha.blind_boxes b
    where b.id = v_existing_order.box_id;

    if v_existing_order.user_id <> p_user_id
      or v_existing_box_slug <> nullif(trim(p_box_slug), '')
      or v_existing_order.quantity <> p_quantity
      or coalesce(v_existing_order.payment_provider, '') <> 'kcoin' then
      raise exception 'idempotency key conflict';
    end if;

    select count(*)::integer
    into v_existing_results_count
    from gacha.draw_results
    where draw_order_id = v_existing_order.id;

    if v_existing_order.status <> 'completed' then
      raise exception 'draw order already processed';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'draw_index', dr.draw_index,
      'template_id', dr.template_id,
      'form_id', dr.form_id,
      'rarity_code', dr.rarity_code,
      'item_instance_id', dr.item_instance_id,
      'was_pity', dr.was_pity
    ) order by dr.draw_index), '[]'::jsonb)
    into v_results
    from gacha.draw_results dr
    where dr.draw_order_id = v_existing_order.id;

    return jsonb_build_object(
      'fulfilled', true,
      'idempotent', true,
      'retryable', false,
      'draw_order_id', v_existing_order.id,
      'star_order_id', null,
      'invoice_payload', v_existing_order.invoice_payload,
      'status', v_existing_order.status,
      'payment_provider', v_existing_order.payment_provider,
      'payment_status', v_existing_order.payment_status,
      'paid_kcoin', v_existing_order.total_price_stars,
      'total_price_kcoin', v_existing_order.total_price_stars,
      'draw_count', v_existing_order.draw_count,
      'quantity', v_existing_order.quantity,
      'discount_bps', v_existing_order.discount_bps,
      'pool_version_id', v_existing_order.pool_version_id,
      'results', v_results,
      'result_count', v_existing_results_count,
      'payment_order_status', 'fulfilled',
      'result_ready', true
    );
  end if;

  select * into v_box
  from gacha.blind_boxes
  where slug = nullif(trim(p_box_slug), '')
  for update;

  if v_box.id is null then
    raise exception 'blind box not found';
  end if;
  if v_box.status <> 'active' then
    raise exception 'blind box is not active: %', v_box.status;
  end if;
  if v_box.starts_at is not null and v_box.starts_at > now() then
    raise exception 'blind box has not started';
  end if;
  if v_box.ends_at is not null and v_box.ends_at <= now() then
    raise exception 'blind box has ended';
  end if;

  select * into v_pool
  from gacha.drop_pool_versions
  where box_id = v_box.id
    and status = 'active'
    and (effective_from is null or effective_from <= now())
    and (effective_to is null or effective_to > now())
  order by version_no desc
  limit 1;

  if v_pool.id is null then
    raise exception 'active drop pool not found';
  end if;

  v_payload :=
    'kcoin_gacha_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

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
    payment_provider,
    payment_status,
    star_amount,
    telegram_invoice_payload,
    metadata
  ) values (
    v_draw_order_id,
    p_user_id,
    v_box.id,
    v_pool.id,
    null,
    'opening',
    p_quantity,
    p_quantity,
    v_unit_price,
    v_discount_bps,
    v_total_price,
    v_box.open_reward_kcoin,
    v_payload,
    v_idempotency_key,
    now(),
    'kcoin',
    'paid',
    0,
    v_payload,
    jsonb_build_object(
      'box_slug', v_box.slug,
      'box_tier', v_box.tier,
      'price_source', 'vercel_env',
      'currency_code', 'KCOIN',
      'unit_price_kcoin', v_unit_price,
      'discount_bps', v_discount_bps,
      'total_price_kcoin', v_total_price
    )
  )
  returning * into v_existing_order;

  v_debit := api._debit_balance(
    p_user_id,
    'KCOIN',
    v_total_price,
    'gacha_open',
    v_draw_order_id,
    null,
    'gacha_open:kcoin:' || v_draw_order_id::text,
    'Open box K-coin cost',
    jsonb_build_object(
      'draw_order_id', v_draw_order_id,
      'box_id', v_box.id,
      'box_slug', v_box.slug,
      'draw_count', p_quantity,
      'quantity', p_quantity,
      'unit_price_kcoin', v_unit_price,
      'discount_bps', v_discount_bps,
      'total_price_kcoin', v_total_price
    )
  );

  for v_draw_i in 1..p_quantity loop
    select null::uuid as id into v_reward;
    select null::uuid as id, 0::integer as current_count into v_pity;
    v_use_pity := false;

    select pr.*, coalesce(ups.current_count, 0) as current_count
    into v_pity
    from gacha.pity_rules pr
    left join gacha.user_pity_states ups
      on ups.pity_rule_id = pr.id and ups.user_id = p_user_id and ups.box_id = v_box.id
    where pr.box_id = v_box.id
      and pr.active = true
      and (pr.pool_version_id is null or pr.pool_version_id = v_pool.id)
    order by pr.priority asc, pr.created_at asc
    limit 1;

    if v_pity.id is not null then
      insert into gacha.user_pity_states (user_id, box_id, pity_rule_id, current_count, total_draws)
      values (p_user_id, v_box.id, v_pity.id, 0, 0)
      on conflict (user_id, box_id, pity_rule_id) do nothing;

      select pr.*, ups.current_count
      into v_pity
      from gacha.pity_rules pr
      join gacha.user_pity_states ups
        on ups.pity_rule_id = pr.id and ups.user_id = p_user_id and ups.box_id = v_box.id
      where pr.id = v_pity.id
      for update of ups;

      v_use_pity := (v_pity.current_count + 1 >= v_pity.threshold);
    end if;

    if v_use_pity and v_pity.guaranteed_template_id is not null then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = v_pool.id
        and dpi.template_id = v_pity.guaranteed_template_id
        and (v_pity.guaranteed_form_id is null or dpi.form_id = v_pity.guaranteed_form_id)
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by dpi.sort_order asc, random()
      limit 1
      for update of dpi;
    elsif v_use_pity then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      join catalog.rarities rr on rr.code = dpi.rarity_code
      join catalog.rarities target on target.code = v_pity.target_rarity_code
      where dpi.pool_version_id = v_pool.id
        and dpi.is_pity_eligible = true
        and rr.sort_order >= target.sort_order
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by rr.sort_order desc, dpi.drop_weight desc, random()
      limit 1
      for update of dpi;
    end if;

    if v_reward.id is null then
      select coalesce(sum(drop_weight), 0) into v_total_weight
      from gacha.drop_pool_items
      where pool_version_id = v_pool.id
        and (stock_remaining is null or stock_remaining > 0);

      if v_total_weight <= 0 then
        raise exception 'drop pool has no available rewards';
      end if;

      v_roll := (random()::numeric * v_total_weight);

      select x.* into v_reward
      from (
        select dpi.*,
               sum(dpi.drop_weight) over (order by dpi.sort_order asc, dpi.id asc) as running_weight
        from gacha.drop_pool_items dpi
        where dpi.pool_version_id = v_pool.id
          and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      ) x
      where x.running_weight >= v_roll
      order by x.running_weight asc
      limit 1;

      if v_reward.id is not null then
        perform 1
        from gacha.drop_pool_items dpi
        where dpi.id = v_reward.id
        for update;
      end if;
    else
      v_roll := null;
    end if;

    if v_reward.id is null then
      raise exception 'failed to select reward';
    end if;

    if v_reward.stock_remaining is not null then
      update gacha.drop_pool_items
      set stock_remaining = stock_remaining - 1,
          updated_at = now()
      where id = v_reward.id
        and stock_remaining > 0;

      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'drop pool item stock changed during fulfillment';
      end if;
    end if;

    v_form_id := v_reward.form_id;
    if v_form_id is null then
      select id into v_form_id
      from catalog.collectible_forms
      where template_id = v_reward.template_id
      order by is_default desc, form_index asc
      limit 1;
    end if;

    select ct.base_power + coalesce(cf.base_power_bonus, 0)
    into v_power
    from catalog.collectible_templates ct
    left join catalog.collectible_forms cf on cf.id = v_form_id
    where ct.id = v_reward.template_id;

    insert into inventory.item_instances (
      owner_user_id, template_id, form_id, level, power, status,
      source_type, source_id, metadata
    ) values (
      p_user_id, v_reward.template_id, v_form_id, 1, coalesce(v_power, 0), 'available',
      'gacha', v_draw_order_id,
      jsonb_build_object('box_id', v_box.id, 'draw_order_id', v_draw_order_id, 'drop_pool_item_id', v_reward.id)
    ) returning id into v_item_id;

    insert into inventory.item_instance_events (
      item_instance_id, user_id, event_type, source_type, source_id, after_state
    ) values (
      v_item_id, p_user_id, 'obtained_from_gacha', 'gacha', v_draw_order_id,
      jsonb_build_object('template_id', v_reward.template_id, 'form_id', v_form_id, 'rarity_code', v_reward.rarity_code)
    );

    insert into album.user_discoveries (
      user_id, template_id, first_item_instance_id, first_source_type, first_source_id
    ) values (
      p_user_id, v_reward.template_id, v_item_id, 'gacha', v_draw_order_id
    ) on conflict (user_id, template_id) do nothing;

    insert into gacha.draw_results (
      draw_order_id, user_id, box_id, pool_version_id, draw_index,
      drop_pool_item_id, item_instance_id, template_id, form_id, rarity_code,
      was_pity, random_roll, metadata
    ) values (
      v_draw_order_id, p_user_id, v_box.id, v_pool.id, v_draw_i,
      v_reward.id, v_item_id, v_reward.template_id, v_form_id, v_reward.rarity_code,
      v_use_pity, v_roll,
      jsonb_build_object('serial_item_id', v_item_id)
    );

    if v_pity.id is not null then
      select exists (
        select 1
        from catalog.rarities got
        join catalog.rarities target on target.code = coalesce(v_pity.reset_on_rarity_code, v_pity.target_rarity_code)
        where got.code = v_reward.rarity_code and got.sort_order >= target.sort_order
      ) into v_should_reset;

      update gacha.user_pity_states
      set current_count = case when v_should_reset then 0 else current_count + 1 end,
          total_draws = total_draws + 1,
          last_hit_at = case when v_should_reset then now() else last_hit_at end,
          updated_at = now()
      where user_id = p_user_id and box_id = v_box.id and pity_rule_id = v_pity.id;
    end if;
  end loop;

  v_reward_kcoin := v_box.open_reward_kcoin * p_quantity;
  if v_reward_kcoin > 0 then
    v_credit := api._credit_balance(
      p_user_id,
      'KCOIN',
      v_reward_kcoin,
      'open_box_rebate',
      v_draw_order_id,
      null,
      'open_box_rebate:' || v_draw_order_id::text,
      'Open box rebate',
      jsonb_build_object('draw_order_id', v_draw_order_id, 'draw_count', p_quantity, 'quantity', p_quantity)
    );
  end if;

  select value
  into v_referral_commission_setting
  from ops.system_settings
  where key = 'REFERRAL_COMMISSION_BPS';

  if v_referral_commission_setting is null then
    raise exception 'referral commission bps setting is required';
  elsif jsonb_typeof(v_referral_commission_setting) = 'object'
     and v_referral_commission_setting ? 'commission_bps'
     and (v_referral_commission_setting ->> 'commission_bps') ~ '^[0-9]+$' then
    v_referral_commission_bps := (v_referral_commission_setting ->> 'commission_bps')::integer;
  else
    raise exception 'invalid referral commission bps setting';
  end if;

  if v_referral_commission_bps < 0 or v_referral_commission_bps > 10000 then
    raise exception 'referral commission bps setting must be between 0 and 10000';
  end if;

  v_referral_first_open := api.referral_process_first_open(p_user_id, v_draw_order_id);
  if v_reward_kcoin > 0
     and not coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
    v_referral_commission := api.referral_create_commission(
      p_user_id,
      v_draw_order_id,
      v_reward_kcoin,
      v_referral_commission_bps
    );
  elsif coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
    v_referral_commission := jsonb_build_object(
      'processed', false,
      'reason', 'first_open_order_not_commissionable',
      'draw_order_id', v_draw_order_id
    );
  end if;

  insert into gacha.draw_audit (draw_order_id, user_id, pool_version_id, rules_snapshot)
  values (
    v_draw_order_id,
    p_user_id,
    v_pool.id,
    jsonb_build_object(
      'box_id', v_box.id,
      'draw_count', p_quantity,
      'quantity', p_quantity,
      'payment_provider', 'kcoin',
      'unit_price_kcoin', v_unit_price,
      'total_price_kcoin', v_total_price,
      'open_reward_kcoin', v_box.open_reward_kcoin,
      'referral_commission_bps', v_referral_commission_bps
    )
  );

  update gacha.draw_orders
  set status = 'completed',
      opened_at = now(),
      error_message = null,
      updated_at = now()
  where id = v_draw_order_id
  returning * into v_existing_order;

  v_progress_result := api.task_record_progress(
    p_user_id,
    'gacha_open_success',
    p_quantity,
    v_draw_order_id,
    coalesce(v_existing_order.opened_at, now())::date::text
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_index', dr.draw_index,
    'template_id', dr.template_id,
    'form_id', dr.form_id,
    'rarity_code', dr.rarity_code,
    'item_instance_id', dr.item_instance_id,
    'was_pity', dr.was_pity
  ) order by dr.draw_index), '[]'::jsonb)
  into v_results
  from gacha.draw_results dr
  where dr.draw_order_id = v_draw_order_id;

  return jsonb_build_object(
    'fulfilled', true,
    'idempotent', false,
    'retryable', false,
    'draw_order_id', v_draw_order_id,
    'star_order_id', null,
    'invoice_payload', v_payload,
    'status', v_existing_order.status,
    'payment_provider', 'kcoin',
    'payment_status', v_existing_order.payment_status,
    'payment_order_status', 'fulfilled',
    'paid_kcoin', v_total_price,
    'total_price_kcoin', v_total_price,
    'debit_ledger', v_debit,
    'draw_count', p_quantity,
    'quantity', p_quantity,
    'discount_bps', v_discount_bps,
    'pool_version_id', v_pool.id,
    'results', v_results,
    'result_count', jsonb_array_length(v_results),
    'kcoin_reward', v_reward_kcoin,
    'kcoin_ledger', v_credit,
    'referral_first_open', coalesce(v_referral_first_open, '{}'::jsonb),
    'referral_commission', coalesce(v_referral_commission, '{}'::jsonb),
    'task_progress', v_progress_result,
    'result_ready', true
  );
end;
$$;

comment on function api.kcoin_topup_create_order(uuid, integer, text) is
  'Creates a service-role-only KCOIN topup order and linked Telegram Stars order for one allowed recharge amount.';

comment on function api.kcoin_topup_process_paid_order(uuid, text, text, jsonb) is
  'Fulfills a paid KCOIN topup Stars order exactly once by crediting KCOIN through economy.currency_ledger.';

comment on function api.gacha_open_with_kcoin_from_server_price(uuid, text, integer, text, integer, integer) is
  'Debits KCOIN and opens a blind box in one trusted database transaction using a Vercel server-side price snapshot.';

comment on function api.gacha_process_paid_order(uuid, text, text, jsonb) is
  'Historical Stars fulfillment entrypoint. Routes vip_monthly and kcoin_topup orders to their fulfillment RPCs; gacha_open still uses gacha fulfillment.';

revoke execute on function api.kcoin_topup_create_order(uuid, integer, text)
  from public, anon, authenticated;
revoke execute on function api.kcoin_topup_process_paid_order(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function api.gacha_open_with_kcoin_from_server_price(uuid, text, integer, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function api.payment_record_star_invoice_failure(uuid, uuid, text, text, timestamptz, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke execute on function api.payment_mark_order_invoice_created(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function api.payment_mark_precheckout_checked(bigint, text, text, text, integer, bigint, jsonb, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function api.payment_record_successful_payment(bigint, text, text, integer, text, text, bigint, jsonb, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function api.gacha_process_paid_order(uuid, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function api.kcoin_topup_create_order(uuid, integer, text)
  to service_role;
grant execute on function api.kcoin_topup_process_paid_order(uuid, text, text, jsonb)
  to service_role;
grant execute on function api.gacha_open_with_kcoin_from_server_price(uuid, text, integer, text, integer, integer)
  to service_role;
grant execute on function api.payment_record_star_invoice_failure(uuid, uuid, text, text, timestamptz, jsonb, jsonb, text)
  to service_role;
grant execute on function api.payment_mark_order_invoice_created(uuid, uuid, text)
  to service_role;
grant execute on function api.payment_mark_precheckout_checked(bigint, text, text, text, integer, bigint, jsonb, text, text, boolean)
  to service_role;
grant execute on function api.payment_record_successful_payment(bigint, text, text, integer, text, text, bigint, jsonb, text, text, boolean)
  to service_role;
grant execute on function api.gacha_process_paid_order(uuid, text, text, jsonb)
  to service_role;

commit;
