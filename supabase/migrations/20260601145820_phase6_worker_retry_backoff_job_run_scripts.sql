-- Phase 6 worker hardening:
-- 1. Persist structured Star payment retry backoff state on orders.
-- 2. Make the payment retry candidate RPC return only due, non-exhausted work.
-- 3. Advance retry state from the audited admin retry RPC.

begin;

alter table payments.star_orders
  add column if not exists retry_count integer not null default 0,
  add column if not exists max_retry_count integer not null default 5,
  add column if not exists next_retry_at timestamptz,
  add column if not exists retry_exhausted_at timestamptz;

alter table payments.star_orders
  drop constraint if exists star_orders_retry_count_check,
  drop constraint if exists star_orders_max_retry_count_check,
  drop constraint if exists star_orders_retry_exhausted_next_check;

alter table payments.star_orders
  add constraint star_orders_retry_count_check
    check (retry_count >= 0),
  add constraint star_orders_max_retry_count_check
    check (max_retry_count between 1 and 100),
  add constraint star_orders_retry_exhausted_next_check
    check (retry_exhausted_at is null or next_retry_at is null);

create index if not exists star_orders_retry_due_idx
  on payments.star_orders (next_retry_at, updated_at, id)
  where status in ('paid', 'fulfilling', 'failed')
    and fulfilled_at is null
    and retry_exhausted_at is null;

create or replace function api.admin_list_retryable_payment_orders(
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(coalesce(p_limit, 10), 100);
  v_now timestamptz := now();
begin
  if v_limit <= 0 then
    raise exception 'PAYMENT_RETRY_LIMIT_INVALID' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'limit', v_limit,
    'statuses', to_jsonb(array['paid', 'fulfilling', 'failed']::text[]),
    'server_time', v_now,
    'orders', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'star_order_id', candidate.id,
            'status', candidate.status,
            'xtr_amount', candidate.xtr_amount,
            'paid_at', candidate.paid_at,
            'updated_at', candidate.updated_at,
            'fulfilled_at', candidate.fulfilled_at,
            'retry_count', candidate.retry_count,
            'max_retry_count', candidate.max_retry_count,
            'next_retry_at', candidate.next_retry_at,
            'retry_exhausted_at', candidate.retry_exhausted_at
          )
          order by coalesce(candidate.next_retry_at, candidate.updated_at) asc,
            candidate.updated_at asc,
            candidate.id asc
        )
        from (
          select
            so.id,
            so.status,
            so.xtr_amount,
            so.paid_at,
            so.updated_at,
            so.fulfilled_at,
            so.retry_count,
            so.max_retry_count,
            so.next_retry_at,
            so.retry_exhausted_at
          from payments.star_orders so
          where so.status in ('paid', 'fulfilling', 'failed')
            and so.fulfilled_at is null
            and so.retry_exhausted_at is null
            and so.retry_count < so.max_retry_count
            and (so.next_retry_at is null or so.next_retry_at <= v_now)
          order by coalesce(so.next_retry_at, so.updated_at) asc,
            so.updated_at asc,
            so.id asc
          limit v_limit
        ) candidate
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function api.admin_list_retryable_payment_orders(integer)
from public, anon, authenticated;

grant execute on function api.admin_list_retryable_payment_orders(integer)
to service_role;

comment on function api.admin_list_retryable_payment_orders(integer) is
  'Lists due paid/fulfilling/failed Star orders that have no fulfilled_at timestamp for the payment retry ops script. Service-role only.';

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
  v_fulfilled boolean := false;
  v_result_retryable boolean := false;
  v_effective_retryable boolean := false;
  v_retry_count integer := 0;
  v_max_retry_count integer := 5;
  v_next_retry_at timestamptz;
  v_retry_exhausted_at timestamptz;
  v_backoff_seconds integer;
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

    v_after_order := v_star_order;
    v_after := jsonb_build_object(
      'star_order', to_jsonb(v_after_order),
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
        'retryable', false,
        'idempotent', true,
        'result_count', v_result_count,
        'retry_count', v_after_order.retry_count,
        'max_retry_count', v_after_order.max_retry_count,
        'next_retry_at', v_after_order.next_retry_at,
        'retry_exhausted_at', v_after_order.retry_exhausted_at,
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
      'status', v_after_order.status,
      'previous_status', v_star_order.status,
      'fulfilled', true,
      'idempotent', true,
      'fulfillment_status', v_result ->> 'status',
      'reason_code', v_result ->> 'reason_code',
      'retryable', false,
      'payment_order_status', v_after_order.status,
      'draw_order_id', v_draw_order.id,
      'result_count', v_result_count,
      'retry_count', v_after_order.retry_count,
      'max_retry_count', v_after_order.max_retry_count,
      'next_retry_at', v_after_order.next_retry_at,
      'retry_exhausted_at', v_after_order.retry_exhausted_at,
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
  where id = p_star_order_id
  for update;

  v_fulfilled := coalesce((v_result ->> 'fulfilled')::boolean, false);
  v_result_retryable := coalesce((v_result ->> 'retryable')::boolean, false);
  v_retry_count := coalesce(v_after_order.retry_count, v_star_order.retry_count, 0);
  v_max_retry_count := greatest(coalesce(v_after_order.max_retry_count, v_star_order.max_retry_count, 5), 1);

  if v_fulfilled then
    v_retry_count := 0;
    v_next_retry_at := null;
    v_retry_exhausted_at := null;
    v_effective_retryable := false;
  else
    v_retry_count := v_retry_count + 1;
    v_effective_retryable := v_result_retryable and v_retry_count < v_max_retry_count;

    if v_effective_retryable then
      v_backoff_seconds := least(
        21600,
        (300 * power(2, least(greatest(v_retry_count - 1, 0), 6)))::integer
      );
      v_next_retry_at := v_now + make_interval(secs => v_backoff_seconds);
      v_retry_exhausted_at := null;
    else
      v_next_retry_at := null;
      v_retry_exhausted_at := v_now;
    end if;
  end if;

  update payments.star_orders
  set
    retry_count = v_retry_count,
    max_retry_count = v_max_retry_count,
    next_retry_at = v_next_retry_at,
    retry_exhausted_at = v_retry_exhausted_at,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'payment_retry',
      jsonb_build_object(
        'last_attempt_at', v_now,
        'last_idempotency_key', v_key,
        'last_reason', v_reason,
        'last_result_status', v_result ->> 'status',
        'last_reason_code', v_result ->> 'reason_code',
        'last_fulfilled', v_fulfilled,
        'last_retryable', v_effective_retryable,
        'retry_count', v_retry_count,
        'max_retry_count', v_max_retry_count,
        'next_retry_at', v_next_retry_at,
        'retry_exhausted_at', v_retry_exhausted_at
      )
    )
  where id = p_star_order_id
  returning *
  into v_after_order;

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
    case when v_fulfilled then 'medium' else 'high' end,
    'reviewing',
    'star_order',
    p_star_order_id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'previous_status', v_star_order.status,
      'result_status', v_result ->> 'status',
      'reason_code', v_result ->> 'reason_code',
      'retryable', v_effective_retryable,
      'idempotent', coalesce((v_result ->> 'idempotent')::boolean, false),
      'retry_count', v_after_order.retry_count,
      'max_retry_count', v_after_order.max_retry_count,
      'next_retry_at', v_after_order.next_retry_at,
      'retry_exhausted_at', v_after_order.retry_exhausted_at,
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
    'fulfilled', v_fulfilled,
    'idempotent', coalesce((v_result ->> 'idempotent')::boolean, false),
    'fulfillment_status', v_result ->> 'status',
    'reason_code', v_result ->> 'reason_code',
    'retryable', v_effective_retryable,
    'payment_order_status', v_result ->> 'payment_order_status',
    'draw_order_id', v_result ->> 'draw_order_id',
    'result_count', v_result ->> 'result_count',
    'retry_count', v_after_order.retry_count,
    'max_retry_count', v_after_order.max_retry_count,
    'next_retry_at', v_after_order.next_retry_at,
    'retry_exhausted_at', v_after_order.retry_exhausted_at,
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
) is 'Retries Telegram Stars fulfillment through the gacha fulfillment RPC. Already fulfilled orders return an audited idempotent no-op; failed retry attempts persist order-level backoff state.';

commit;
