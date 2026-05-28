-- Phase 5 step 06: Telegram Stars successful_payment record and idempotency.
--
-- This RPC deliberately stops at payment recording. It records the raw webhook
-- event first, validates the Stars order, writes the successful payment row,
-- and marks the application payment order paid. Fulfillment stays in the next
-- step and must call api.gacha_process_paid_order separately.

begin;

create or replace function api.payment_record_successful_payment(
  p_update_id bigint,
  p_invoice_payload text,
  p_currency text,
  p_total_amount integer,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_telegram_user_id bigint default null,
  p_raw_update jsonb default '{}'::jsonb,
  p_request_headers_hash text default null,
  p_request_id text default null,
  p_webhook_secret_verified boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_event payments.telegram_webhook_events%rowtype;
  v_star_order payments.star_orders%rowtype;
  v_star_payment payments.star_payments%rowtype;
  v_existing_charge_payment payments.star_payments%rowtype;
  v_existing_order_payment payments.star_payments%rowtype;
  v_draw_order_id uuid;
  v_event_inserted boolean := false;
  v_normalized_payload text := nullif(trim(coalesce(p_invoice_payload, '')), '');
  v_normalized_currency text := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_telegram_payment_charge_id text := nullif(trim(coalesce(p_telegram_payment_charge_id, '')), '');
  v_provider_payment_charge_id text := nullif(trim(coalesce(p_provider_payment_charge_id, '')), '');
  v_reason_code text := null;
  v_error_message text := null;
  v_duration_ms integer := 0;
begin
  if p_update_id is null then
    raise exception 'update_id is required';
  end if;

  insert into payments.telegram_webhook_events (
    update_id,
    event_type,
    telegram_user_id,
    invoice_payload,
    payload,
    process_status,
    request_headers_hash,
    webhook_secret_verified
  )
  values (
    p_update_id,
    'successful_payment',
    p_telegram_user_id,
    v_normalized_payload,
    coalesce(p_raw_update, '{}'::jsonb),
    'processing',
    nullif(trim(coalesce(p_request_headers_hash, '')), ''),
    p_webhook_secret_verified
  )
  on conflict (update_id) do nothing
  returning * into v_event;

  v_event_inserted := v_event.id is not null;

  if not v_event_inserted then
    select * into v_event
    from payments.telegram_webhook_events
    where update_id = p_update_id
    for update;

    if v_event.id is null then
      raise exception 'telegram webhook event not found after update_id conflict';
    end if;

    if v_event.event_type = 'successful_payment'
       and v_event.process_status in ('processed', 'ignored') then
      if v_telegram_payment_charge_id is not null then
        select * into v_star_payment
        from payments.star_payments
        where telegram_payment_charge_id = v_telegram_payment_charge_id;
      end if;

      if v_star_payment.id is null and coalesce(v_event.invoice_payload, v_normalized_payload) is not null then
        select * into v_star_payment
        from payments.star_payments
        where invoice_payload = coalesce(v_event.invoice_payload, v_normalized_payload)
        order by paid_at desc, created_at desc
        limit 1;
      end if;

      if v_star_payment.id is not null then
        select * into v_star_order
        from payments.star_orders
        where id = v_star_payment.star_order_id;
      elsif coalesce(v_event.invoice_payload, v_normalized_payload) is not null then
        select * into v_star_order
        from payments.star_orders
        where telegram_invoice_payload = coalesce(v_event.invoice_payload, v_normalized_payload);
      end if;

      return jsonb_build_object(
        'payment_recorded', false,
        'idempotent', true,
        'duplicate_update', true,
        'duplicate_charge', false,
        'event_id', v_event.id,
        'star_order_id', v_star_order.id,
        'star_payment_id', v_star_payment.id,
        'draw_order_id', v_star_order.business_id,
        'invoice_payload', coalesce(v_event.invoice_payload, v_normalized_payload),
        'telegram_payment_charge_id', v_telegram_payment_charge_id,
        'reason_code', null,
        'error_message', null,
        'payment_order_status', v_star_order.status,
        'process_status', v_event.process_status
      );
    end if;

    if v_event.event_type <> 'successful_payment' then
      return jsonb_build_object(
        'payment_recorded', false,
        'idempotent', true,
        'duplicate_update', true,
        'duplicate_charge', false,
        'event_id', v_event.id,
        'star_order_id', null,
        'star_payment_id', null,
        'draw_order_id', null,
        'invoice_payload', coalesce(v_event.invoice_payload, v_normalized_payload),
        'telegram_payment_charge_id', v_telegram_payment_charge_id,
        'reason_code', 'UPDATE_ID_EVENT_TYPE_CONFLICT',
        'error_message', 'Telegram update_id 已被其他事件类型占用。',
        'payment_order_status', null,
        'process_status', v_event.process_status
      );
    end if;

    update payments.telegram_webhook_events
    set telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
        invoice_payload = coalesce(v_normalized_payload, invoice_payload),
        payload = coalesce(p_raw_update, payload),
        process_status = 'processing',
        request_headers_hash = coalesce(nullif(trim(coalesce(p_request_headers_hash, '')), ''), request_headers_hash),
        webhook_secret_verified = webhook_secret_verified or p_webhook_secret_verified,
        processed_at = null,
        processing_duration_ms = null,
        error_message = null
    where id = v_event.id
    returning * into v_event;
  end if;

  if v_telegram_payment_charge_id is null then
    v_reason_code := 'TELEGRAM_PAYMENT_CHARGE_ID_REQUIRED';
    v_error_message := 'Telegram payment charge id 缺失。';
  elsif v_normalized_payload is null then
    v_reason_code := 'PAYLOAD_REQUIRED';
    v_error_message := '支付订单 payload 无效。';
  elsif v_normalized_currency is distinct from 'XTR' then
    v_reason_code := 'CURRENCY_INVALID';
    v_error_message := 'Stars 支付币种无效。';
  elsif p_total_amount is null or p_total_amount <= 0 then
    v_reason_code := 'AMOUNT_INVALID';
    v_error_message := 'Stars 支付金额无效。';
  end if;

  if v_normalized_payload is not null then
    select * into v_star_order
    from payments.star_orders
    where telegram_invoice_payload = v_normalized_payload
    for update;
  end if;

  if v_reason_code is null and v_star_order.id is null then
    v_reason_code := 'ORDER_NOT_FOUND';
    v_error_message := '支付订单不存在或已失效。';
  end if;

  if v_reason_code is null and p_telegram_user_id is null then
    v_reason_code := 'TELEGRAM_USER_REQUIRED';
    v_error_message := '支付用户无效。';
  end if;

  if v_reason_code is null and not exists (
    select 1
    from core.users u
    where u.id = v_star_order.user_id
      and u.telegram_user_id = p_telegram_user_id
  ) then
    v_reason_code := 'TELEGRAM_USER_MISMATCH';
    v_error_message := '支付用户与订单不匹配。';
  end if;

  if v_reason_code is null and v_star_order.business_type <> 'gacha_open' then
    v_reason_code := 'BUSINESS_TYPE_INVALID';
    v_error_message := '支付订单类型无效。';
  end if;

  if v_reason_code is null and v_star_order.xtr_amount <> p_total_amount then
    v_reason_code := 'AMOUNT_MISMATCH';
    v_error_message := 'Stars 支付金额不一致。';
  end if;

  if v_telegram_payment_charge_id is not null then
    select * into v_existing_charge_payment
    from payments.star_payments
    where telegram_payment_charge_id = v_telegram_payment_charge_id
    for update;
  end if;

  if v_reason_code is null and v_existing_charge_payment.id is not null then
    if v_star_order.id is not null
       and v_existing_charge_payment.star_order_id = v_star_order.id
       and v_existing_charge_payment.invoice_payload = v_normalized_payload then
      update payments.telegram_webhook_events
      set user_id = v_star_order.user_id,
          telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
          invoice_payload = v_normalized_payload,
          process_status = 'ignored',
          processed_at = now(),
          processing_duration_ms = greatest(
            floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
            0
          ),
          error_message = null
      where id = v_event.id
      returning * into v_event;

      return jsonb_build_object(
        'payment_recorded', false,
        'idempotent', true,
        'duplicate_update', not v_event_inserted,
        'duplicate_charge', true,
        'event_id', v_event.id,
        'star_order_id', v_star_order.id,
        'star_payment_id', v_existing_charge_payment.id,
        'draw_order_id', v_star_order.business_id,
        'invoice_payload', v_normalized_payload,
        'telegram_payment_charge_id', v_telegram_payment_charge_id,
        'reason_code', null,
        'error_message', null,
        'payment_order_status', v_star_order.status,
        'process_status', v_event.process_status
      );
    else
      v_reason_code := 'PAYMENT_CHARGE_CONFLICT';
      v_error_message := 'Telegram payment charge id 已绑定到其他订单。';
    end if;
  end if;

  if v_reason_code is null and v_star_order.status in (
    'fulfilled',
    'fulfilling',
    'refunded',
    'disputed',
    'cancelled',
    'expired',
    'failed'
  ) then
    v_reason_code := case
      when v_star_order.status = 'fulfilled' then 'ORDER_ALREADY_FULFILLED'
      else 'ORDER_STATUS_NOT_PAYABLE'
    end;
    v_error_message := '支付订单当前状态不可记录成功支付。';
  end if;

  if v_reason_code is null and v_star_order.id is not null then
    select * into v_existing_order_payment
    from payments.star_payments
    where star_order_id = v_star_order.id
    order by paid_at desc, created_at desc
    limit 1
    for update;

    if v_existing_order_payment.id is not null then
      v_reason_code := 'ORDER_ALREADY_PAID';
      v_error_message := '支付订单已存在成功支付流水。';
    end if;
  end if;

  if v_reason_code is not null then
    v_duration_ms := greatest(
      floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
      0
    );

    if v_star_order.id is not null
       and v_reason_code in ('CURRENCY_INVALID', 'AMOUNT_INVALID', 'AMOUNT_MISMATCH', 'BUSINESS_TYPE_INVALID')
       and v_star_order.status in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked') then
      update payments.star_orders
      set status = 'failed',
          error_message = left(v_error_message, 1000),
          updated_at = now()
      where id = v_star_order.id
      returning * into v_star_order;
    end if;

    update payments.telegram_webhook_events
    set user_id = coalesce(v_star_order.user_id, user_id),
        telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
        invoice_payload = coalesce(v_normalized_payload, invoice_payload),
        process_status = 'failed',
        processed_at = now(),
        processing_duration_ms = v_duration_ms,
        error_message = left(v_error_message, 1000)
    where id = v_event.id
    returning * into v_event;

    return jsonb_build_object(
      'payment_recorded', false,
      'idempotent', not v_event_inserted,
      'duplicate_update', not v_event_inserted,
      'duplicate_charge', false,
      'event_id', v_event.id,
      'star_order_id', v_star_order.id,
      'star_payment_id', null,
      'draw_order_id', v_star_order.business_id,
      'invoice_payload', v_normalized_payload,
      'telegram_payment_charge_id', v_telegram_payment_charge_id,
      'reason_code', v_reason_code,
      'error_message', v_error_message,
      'payment_order_status', v_star_order.status,
      'process_status', v_event.process_status
    );
  end if;

  insert into payments.star_payments (
    star_order_id,
    user_id,
    telegram_payment_charge_id,
    provider_payment_charge_id,
    xtr_amount,
    currency,
    invoice_payload,
    raw_update
  )
  values (
    v_star_order.id,
    v_star_order.user_id,
    v_telegram_payment_charge_id,
    v_provider_payment_charge_id,
    v_star_order.xtr_amount,
    'XTR',
    v_normalized_payload,
    coalesce(p_raw_update, '{}'::jsonb)
  )
  on conflict (telegram_payment_charge_id) do nothing
  returning * into v_star_payment;

  if v_star_payment.id is null then
    select * into v_existing_charge_payment
    from payments.star_payments
    where telegram_payment_charge_id = v_telegram_payment_charge_id
    for update;

    if v_existing_charge_payment.id is not null
       and v_existing_charge_payment.star_order_id = v_star_order.id
       and v_existing_charge_payment.invoice_payload = v_normalized_payload then
      update payments.telegram_webhook_events
      set user_id = v_star_order.user_id,
          telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
          invoice_payload = v_normalized_payload,
          process_status = 'ignored',
          processed_at = now(),
          processing_duration_ms = greatest(
            floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
            0
          ),
          error_message = null
      where id = v_event.id
      returning * into v_event;

      return jsonb_build_object(
        'payment_recorded', false,
        'idempotent', true,
        'duplicate_update', not v_event_inserted,
        'duplicate_charge', true,
        'event_id', v_event.id,
        'star_order_id', v_star_order.id,
        'star_payment_id', v_existing_charge_payment.id,
        'draw_order_id', v_star_order.business_id,
        'invoice_payload', v_normalized_payload,
        'telegram_payment_charge_id', v_telegram_payment_charge_id,
        'reason_code', null,
        'error_message', null,
        'payment_order_status', v_star_order.status,
        'process_status', v_event.process_status
      );
    end if;

    raise exception 'successful payment insert conflicted without matching payment row';
  end if;

  update payments.star_orders
  set status = 'paid',
      paid_at = coalesce(paid_at, v_star_payment.paid_at, now()),
      error_message = null,
      updated_at = now()
  where id = v_star_order.id
  returning * into v_star_order;

  v_duration_ms := greatest(
    floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
    0
  );

  update payments.telegram_webhook_events
  set user_id = v_star_order.user_id,
      telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
      invoice_payload = v_normalized_payload,
      process_status = 'processed',
      processed_at = now(),
      processing_duration_ms = v_duration_ms,
      error_message = null
  where id = v_event.id
  returning * into v_event;

  v_draw_order_id := v_star_order.business_id;

  return jsonb_build_object(
    'payment_recorded', true,
    'idempotent', false,
    'duplicate_update', false,
    'duplicate_charge', false,
    'event_id', v_event.id,
    'star_order_id', v_star_order.id,
    'star_payment_id', v_star_payment.id,
    'draw_order_id', v_draw_order_id,
    'invoice_payload', v_normalized_payload,
    'telegram_payment_charge_id', v_telegram_payment_charge_id,
    'reason_code', null,
    'error_message', null,
    'payment_order_status', v_star_order.status,
    'process_status', v_event.process_status,
    'paid_at', v_star_order.paid_at
  );
end;
$$;

comment on function api.payment_record_successful_payment(
  bigint,
  text,
  text,
  integer,
  text,
  text,
  bigint,
  jsonb,
  text,
  text,
  boolean
) is 'Records Telegram Stars successful_payment webhooks and marks star_orders paid without fulfilling gacha orders.';

revoke execute on function api.payment_record_successful_payment(
  bigint,
  text,
  text,
  integer,
  text,
  text,
  bigint,
  jsonb,
  text,
  text,
  boolean
) from public, anon, authenticated;

grant execute on function api.payment_record_successful_payment(
  bigint,
  text,
  text,
  integer,
  text,
  text,
  bigint,
  jsonb,
  text,
  text,
  boolean
) to service_role;

commit;
