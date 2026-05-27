-- Phase 5 step 05: Telegram Stars pre_checkout_query validation.
--
-- The webhook handler calls this RPC after verifying the Telegram webhook
-- secret. The RPC records the raw webhook event first, validates the linked
-- Stars/gacha order under row locks, and marks only the payment pre-check
-- state. It does not fulfill an order or create draw_results.

create or replace function api.payment_mark_precheckout_checked(
  p_update_id bigint,
  p_pre_checkout_query_id text,
  p_invoice_payload text,
  p_currency text,
  p_total_amount integer,
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
  v_draw_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_event_inserted boolean := false;
  v_allowed boolean := true;
  v_reason_code text := null;
  v_error_message text := null;
  v_target_payment_status text := null;
  v_target_draw_status text := null;
  v_normalized_payload text := nullif(trim(coalesce(p_invoice_payload, '')), '');
  v_normalized_currency text := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_pre_checkout_query_id text := nullif(trim(coalesce(p_pre_checkout_query_id, '')), '');
  v_duration_ms integer;
begin
  if p_update_id is null then
    raise exception 'update_id is required';
  end if;

  if v_pre_checkout_query_id is null then
    raise exception 'pre_checkout_query_id is required';
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
    'pre_checkout_query',
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

    if v_event.event_type = 'pre_checkout_query'
       and v_event.process_status = 'processed' then
      return jsonb_build_object(
        'allowed', true,
        'idempotent', true,
        'event_id', v_event.id,
        'invoice_payload', coalesce(v_event.invoice_payload, v_normalized_payload),
        'reason_code', null,
        'error_message', null
      );
    end if;

    update payments.telegram_webhook_events
    set event_type = 'pre_checkout_query',
        telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
        invoice_payload = coalesce(v_normalized_payload, invoice_payload),
        process_status = 'processing',
        request_headers_hash = coalesce(nullif(trim(coalesce(p_request_headers_hash, '')), ''), request_headers_hash),
        webhook_secret_verified = webhook_secret_verified or p_webhook_secret_verified,
        processed_at = null,
        processing_duration_ms = null,
        error_message = null
    where id = v_event.id
    returning * into v_event;
  end if;

  if v_normalized_payload is null then
    v_allowed := false;
    v_reason_code := 'PAYLOAD_REQUIRED';
    v_error_message := '支付订单 payload 无效，请重新下单。';
  end if;

  if v_allowed and v_normalized_currency <> 'XTR' then
    v_allowed := false;
    v_reason_code := 'CURRENCY_INVALID';
    v_error_message := 'Stars 支付币种无效，请重新下单。';
    v_target_payment_status := 'failed';
    v_target_draw_status := 'failed';
  end if;

  if v_allowed and (p_total_amount is null or p_total_amount <= 0) then
    v_allowed := false;
    v_reason_code := 'AMOUNT_INVALID';
    v_error_message := 'Stars 支付金额无效，请重新下单。';
    v_target_payment_status := 'failed';
    v_target_draw_status := 'failed';
  end if;

  if v_normalized_payload is not null then
    select * into v_star_order
    from payments.star_orders
    where telegram_invoice_payload = v_normalized_payload
    for update;
  end if;

  if v_allowed and v_star_order.id is null then
    v_allowed := false;
    v_reason_code := 'ORDER_NOT_FOUND';
    v_error_message := '支付订单不存在或已失效，请重新下单。';
  end if;

  if v_allowed and p_telegram_user_id is null then
    v_allowed := false;
    v_reason_code := 'TELEGRAM_USER_REQUIRED';
    v_error_message := '支付用户无效，请重新下单。';
  end if;

  if v_allowed and not exists (
    select 1
    from core.users u
    where u.id = v_star_order.user_id
      and u.telegram_user_id = p_telegram_user_id
  ) then
    v_allowed := false;
    v_reason_code := 'TELEGRAM_USER_MISMATCH';
    v_error_message := '支付用户与订单不匹配，请重新下单。';
  end if;

  if v_allowed and v_star_order.business_type <> 'gacha_open' then
    v_allowed := false;
    v_reason_code := 'BUSINESS_TYPE_INVALID';
    v_error_message := '支付订单类型无效，请重新下单。';
    v_target_payment_status := 'failed';
  end if;

  if v_allowed and v_star_order.xtr_amount <> p_total_amount then
    v_allowed := false;
    v_reason_code := 'AMOUNT_MISMATCH';
    v_error_message := 'Stars 支付金额不一致，请重新下单。';
    v_target_payment_status := 'failed';
    v_target_draw_status := 'failed';
  end if;

  if v_allowed and v_star_order.status not in (
    'created',
    'invoice_created',
    'precheckout_ok',
    'precheckout_checked'
  ) then
    v_allowed := false;
    v_reason_code := 'ORDER_STATUS_NOT_PAYABLE';
    v_error_message := '支付订单当前状态不可支付，请重新下单。';
  end if;

  if v_allowed and v_star_order.expires_at is not null and v_star_order.expires_at <= now() then
    v_allowed := false;
    v_reason_code := 'ORDER_EXPIRED';
    v_error_message := '支付订单已过期，请重新下单。';
    v_target_payment_status := 'expired';
    v_target_draw_status := 'expired';
  end if;

  if v_star_order.id is not null then
    select * into v_draw_order
    from gacha.draw_orders
    where id = v_star_order.business_id
      and payment_star_order_id = v_star_order.id
    for update;
  end if;

  if v_allowed and v_draw_order.id is null then
    v_allowed := false;
    v_reason_code := 'DRAW_ORDER_NOT_FOUND';
    v_error_message := '开盒订单不存在或已失效，请重新下单。';
    v_target_payment_status := 'failed';
  end if;

  if v_allowed and v_draw_order.user_id <> v_star_order.user_id then
    v_allowed := false;
    v_reason_code := 'DRAW_ORDER_USER_MISMATCH';
    v_error_message := '开盒订单用户不匹配，请重新下单。';
    v_target_payment_status := 'failed';
    v_target_draw_status := 'failed';
  end if;

  if v_allowed and v_draw_order.status not in ('created', 'invoice_created') then
    v_allowed := false;
    v_reason_code := 'DRAW_ORDER_STATUS_NOT_PAYABLE';
    v_error_message := '开盒订单当前状态不可支付，请重新下单。';
  end if;

  if v_allowed and coalesce(v_draw_order.payment_status, 'pending') not in ('created', 'pending') then
    v_allowed := false;
    v_reason_code := 'DRAW_ORDER_PAYMENT_STATUS_NOT_PAYABLE';
    v_error_message := '开盒订单支付状态不可支付，请重新下单。';
  end if;

  if v_allowed and v_draw_order.total_price_stars <> p_total_amount then
    v_allowed := false;
    v_reason_code := 'DRAW_ORDER_AMOUNT_MISMATCH';
    v_error_message := '开盒订单金额不一致，请重新下单。';
    v_target_payment_status := 'failed';
    v_target_draw_status := 'failed';
  end if;

  if v_allowed then
    select * into v_box
    from gacha.blind_boxes
    where id = v_draw_order.box_id
    for update;

    if v_box.id is null then
      v_allowed := false;
      v_reason_code := 'BLIND_BOX_NOT_FOUND';
      v_error_message := '盲盒不存在或已下架，请重新下单。';
      v_target_payment_status := 'failed';
      v_target_draw_status := 'failed';
    elsif v_box.status <> 'active'
       or (v_box.starts_at is not null and v_box.starts_at > now())
       or (v_box.ends_at is not null and v_box.ends_at <= now()) then
      v_allowed := false;
      v_reason_code := 'BLIND_BOX_UNAVAILABLE';
      v_error_message := '盲盒当前不可购买，请重新选择。';
      v_target_payment_status := 'failed';
      v_target_draw_status := 'failed';
    elsif v_box.remaining_stock is not null
       and v_box.remaining_stock < greatest(coalesce(v_draw_order.draw_count, v_draw_order.quantity, 1), 1) then
      v_allowed := false;
      v_reason_code := 'STOCK_INSUFFICIENT';
      v_error_message := '盲盒库存不足，请重新选择。';
      v_target_payment_status := 'failed';
      v_target_draw_status := 'failed';
    end if;
  end if;

  v_duration_ms := greatest(
    floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
    0
  );

  if not v_allowed then
    if v_star_order.id is not null then
      update payments.star_orders
      set status = case
            when v_target_payment_status is not null
             and status in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked')
              then v_target_payment_status
            else status
          end,
          error_message = left(v_error_message, 1000),
          updated_at = now()
      where id = v_star_order.id
      returning * into v_star_order;
    end if;

    if v_draw_order.id is not null then
      update gacha.draw_orders
      set status = case
            when v_target_draw_status is not null
             and status in ('created', 'invoice_created')
              then v_target_draw_status
            else status
          end,
          payment_status = case
            when v_target_draw_status is not null
             and coalesce(payment_status, 'pending') in ('created', 'pending')
              then v_target_draw_status
            else payment_status
          end,
          error_message = left(v_error_message, 1000),
          updated_at = now()
      where id = v_draw_order.id;
    end if;

    update payments.telegram_webhook_events
    set user_id = coalesce(v_star_order.user_id, user_id),
        process_status = 'failed',
        processed_at = now(),
        processing_duration_ms = v_duration_ms,
        error_message = left(v_error_message, 1000)
    where id = v_event.id
    returning * into v_event;

    return jsonb_build_object(
      'allowed', false,
      'idempotent', not v_event_inserted,
      'event_id', v_event.id,
      'star_order_id', v_star_order.id,
      'draw_order_id', v_draw_order.id,
      'invoice_payload', v_normalized_payload,
      'reason_code', v_reason_code,
      'error_message', v_error_message,
      'payment_order_status', v_star_order.status
    );
  end if;

  update payments.star_orders
  set status = 'precheckout_checked',
      precheckout_at = coalesce(precheckout_at, now()),
      error_message = null,
      updated_at = now()
  where id = v_star_order.id
  returning * into v_star_order;

  update gacha.draw_orders
  set payment_status = case
        when payment_status is null or payment_status = 'created' then 'pending'
        else payment_status
      end,
      error_message = null,
      updated_at = now()
  where id = v_draw_order.id
  returning * into v_draw_order;

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

  return jsonb_build_object(
    'allowed', true,
    'idempotent', not v_event_inserted,
    'event_id', v_event.id,
    'star_order_id', v_star_order.id,
    'draw_order_id', v_draw_order.id,
    'user_id', v_star_order.user_id,
    'telegram_user_id', p_telegram_user_id,
    'invoice_payload', v_normalized_payload,
    'reason_code', null,
    'error_message', null,
    'payment_order_status', v_star_order.status,
    'precheckout_at', v_star_order.precheckout_at
  );
end;
$$;

comment on function api.payment_mark_precheckout_checked(
  bigint,
  text,
  text,
  text,
  integer,
  bigint,
  jsonb,
  text,
  text,
  boolean
) is 'Records and validates Telegram Stars pre_checkout_query events. It only marks payment pre-check state and never fulfills gacha orders.';

revoke execute on function api.payment_mark_precheckout_checked(
  bigint,
  text,
  text,
  text,
  integer,
  bigint,
  jsonb,
  text,
  text,
  boolean
) from public, anon, authenticated;

grant execute on function api.payment_mark_precheckout_checked(
  bigint,
  text,
  text,
  text,
  integer,
  bigint,
  jsonb,
  text,
  text,
  boolean
) to service_role;
