-- Phase 6 payment compensation idempotency hardening.
-- Admin retry on an already fulfilled order must be a no-op success that still
-- records the admin action for audit and risk review.

begin;

create or replace function api.admin_retry_payment_fulfillment(
  p_admin_user_id uuid,
  p_star_order_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_star_order payments.star_orders%rowtype;
  v_after_order payments.star_orders%rowtype;
  v_payment payments.star_payments%rowtype;
  v_draw_order gacha.draw_orders%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_response jsonb;
  v_now timestamptz := now();
  v_audit jsonb;
  v_scope text := 'admin.retry_fulfillment';
  v_request_hash text;
  v_idempotent jsonb;
  v_raw_update jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_result_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_star_order_id is null then
    raise exception 'ADMIN_PAYMENT_ORDER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  -- Keep the historical request_hash format so existing idempotency rows do not
  -- conflict after this migration.
  v_request_hash := p_star_order_id::text || ':' || v_reason;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_star_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  if not found then
    raise exception 'ADMIN_PAYMENT_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_star_order.status in ('refunded', 'disputed') then
    raise exception 'ADMIN_PAYMENT_NOT_RETRYABLE' using errcode = 'P0001';
  end if;

  if v_star_order.status = 'fulfilled' then
    select *
    into v_draw_order
    from gacha.draw_orders
    where payment_star_order_id = p_star_order_id
    order by created_at desc
    limit 1
    for update;

    if v_draw_order.id is not null then
      select count(*)::integer
      into v_result_count
      from gacha.draw_results
      where draw_order_id = v_draw_order.id;
    end if;

    v_before := jsonb_build_object(
      'star_order', to_jsonb(v_star_order),
      'draw_order', case when v_draw_order.id is null then null else to_jsonb(v_draw_order) end,
      'result_count', v_result_count
    );

    v_result := jsonb_build_object(
      'fulfilled', true,
      'idempotent', true,
      'retryable', false,
      'status', 'already_fulfilled',
      'reason_code', 'ORDER_ALREADY_FULFILLED',
      'star_order_id', p_star_order_id,
      'draw_order_id', v_draw_order.id,
      'result_count', v_result_count,
      'payment_order_status', v_star_order.status
    );

    v_after := jsonb_build_object(
      'star_order', to_jsonb(v_star_order),
      'draw_order', case when v_draw_order.id is null then null else to_jsonb(v_draw_order) end,
      'fulfillment_result', v_result
    );

    insert into ops.risk_events (
      user_id,
      event_type,
      severity,
      status,
      source_type,
      source_id,
      detail
    )
    values (
      v_star_order.user_id,
      'admin_payment_fulfillment_retry',
      'medium',
      'reviewing',
      'star_order',
      p_star_order_id,
      jsonb_build_object(
        'admin_user_id', p_admin_user_id,
        'previous_status', v_star_order.status,
        'result_status', v_result ->> 'status',
        'reason_code', v_result ->> 'reason_code',
        'retryable', v_result ->> 'retryable',
        'idempotent', true,
        'result_count', v_result_count,
        'reason', v_reason,
        'idempotency_key', v_key
      )
    );

    v_audit := api.admin_write_audit_log(
      p_admin_user_id,
      'payment.fulfillment.retry',
      'payments',
      'star_orders',
      p_star_order_id,
      v_before,
      v_after,
      p_request_context ->> 'ip_hash',
      p_request_context ->> 'user_agent_hash',
      v_reason
    );

    v_response := jsonb_build_object(
      'star_order_id', p_star_order_id,
      'status', v_star_order.status,
      'previous_status', v_star_order.status,
      'fulfilled', true,
      'idempotent', true,
      'fulfillment_status', v_result ->> 'status',
      'reason_code', v_result ->> 'reason_code',
      'retryable', v_result ->> 'retryable',
      'payment_order_status', v_star_order.status,
      'draw_order_id', v_draw_order.id,
      'result_count', v_result_count,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'server_time', v_now
    );

    perform api._admin_complete_idempotency(v_key, v_response, v_now);
    return v_response;
  end if;

  select *
  into v_payment
  from payments.star_payments
  where star_order_id = p_star_order_id
  order by paid_at desc, created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'ADMIN_PAYMENT_RECORD_NOT_FOUND' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(v_payment.telegram_payment_charge_id, '')), '') is null then
    raise exception 'ADMIN_PAYMENT_CHARGE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_before := jsonb_build_object(
    'star_order', to_jsonb(v_star_order),
    'star_payment', jsonb_build_object(
      'id', v_payment.id,
      'telegram_payment_charge_id', v_payment.telegram_payment_charge_id,
      'provider_payment_charge_id', v_payment.provider_payment_charge_id,
      'paid_at', v_payment.paid_at
    )
  );

  v_raw_update := coalesce(v_payment.raw_update, '{}'::jsonb) || jsonb_build_object(
    'admin_retry',
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'reason', v_reason,
      'idempotency_key', v_key,
      'requested_at', v_now,
      'request_context', coalesce(p_request_context, '{}'::jsonb)
    )
  );

  v_result := api.gacha_process_paid_order(
    p_star_order_id,
    v_payment.telegram_payment_charge_id,
    v_payment.provider_payment_charge_id,
    v_raw_update
  );

  select *
  into v_after_order
  from payments.star_orders
  where id = p_star_order_id;

  v_after := jsonb_build_object(
    'star_order', to_jsonb(v_after_order),
    'fulfillment_result', v_result
  );

  insert into ops.risk_events (
    user_id,
    event_type,
    severity,
    status,
    source_type,
    source_id,
    detail
  )
  values (
    v_star_order.user_id,
    'admin_payment_fulfillment_retry',
    case when coalesce((v_result ->> 'fulfilled')::boolean, false) then 'medium' else 'high' end,
    'reviewing',
    'star_order',
    p_star_order_id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'previous_status', v_star_order.status,
      'result_status', v_result ->> 'status',
      'reason_code', v_result ->> 'reason_code',
      'retryable', v_result ->> 'retryable',
      'idempotent', coalesce((v_result ->> 'idempotent')::boolean, false),
      'reason', v_reason,
      'idempotency_key', v_key
    )
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'payment.fulfillment.retry',
    'payments',
    'star_orders',
    p_star_order_id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'star_order_id', p_star_order_id,
    'status', coalesce(v_after_order.status, v_star_order.status),
    'previous_status', v_star_order.status,
    'fulfilled', coalesce((v_result ->> 'fulfilled')::boolean, false),
    'idempotent', coalesce((v_result ->> 'idempotent')::boolean, false),
    'fulfillment_status', v_result ->> 'status',
    'reason_code', v_result ->> 'reason_code',
    'retryable', v_result ->> 'retryable',
    'payment_order_status', v_result ->> 'payment_order_status',
    'draw_order_id', v_result ->> 'draw_order_id',
    'result_count', v_result ->> 'result_count',
    'audit_log_id', v_audit ->> 'audit_log_id',
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function api.admin_retry_payment_fulfillment(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_retry_payment_fulfillment(
  uuid, uuid, text, text, jsonb
) to service_role;

comment on function api.admin_retry_payment_fulfillment(
  uuid, uuid, text, text, jsonb
) is 'Retries Telegram Stars fulfillment through the gacha fulfillment RPC. Already fulfilled orders return an audited idempotent no-op.';

commit;
