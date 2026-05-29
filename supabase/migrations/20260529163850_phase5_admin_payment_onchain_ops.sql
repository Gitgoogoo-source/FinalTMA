-- Phase 5 step 15: admin payment/onchain operations.
-- Keep admin writes behind RPCs so the API layer can require admin auth while
-- database-side changes and audit logs stay in the same transaction.

create index if not exists mint_queue_status_attempt_next_created_idx
  on onchain.mint_queue (status, attempt_count, next_attempt_at, created_at desc);

comment on index onchain.mint_queue_status_attempt_next_created_idx is
  'Step 15 admin/ops query path for Mint status, attempt count and retry scheduling.';

create or replace function api.admin_write_audit_log(
  p_admin_user_id uuid,
  p_action text,
  p_target_schema text default null,
  p_target_table text default null,
  p_target_id uuid default null,
  p_before_state jsonb default '{}'::jsonb,
  p_after_state jsonb default '{}'::jsonb,
  p_ip_hash text default null,
  p_user_agent text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_audit_id uuid;
  v_created_at timestamptz;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_action, '')), '') is null then
    raise exception 'ADMIN_ACTION_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_admin
  from ops.admin_users
  where id = p_admin_user_id
  for update;

  if not found then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_admin.status <> 'active' then
    raise exception 'ADMIN_USER_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  insert into ops.admin_audit_logs (
    admin_user_id,
    action,
    target_schema,
    target_table,
    target_id,
    before_state,
    after_state,
    ip_hash,
    user_agent,
    reason
  )
  values (
    p_admin_user_id,
    trim(p_action),
    nullif(trim(coalesce(p_target_schema, '')), ''),
    nullif(trim(coalesce(p_target_table, '')), ''),
    p_target_id,
    coalesce(p_before_state, '{}'::jsonb),
    coalesce(p_after_state, '{}'::jsonb),
    nullif(trim(coalesce(p_ip_hash, '')), ''),
    nullif(trim(coalesce(p_user_agent, '')), ''),
    nullif(trim(coalesce(p_reason, '')), '')
  )
  returning id, created_at into v_audit_id, v_created_at;

  update ops.admin_users
  set last_login_at = coalesce(last_login_at, v_created_at),
      updated_at = v_created_at
  where id = p_admin_user_id;

  return jsonb_build_object(
    'audit_log_id', v_audit_id,
    'admin_user_id', p_admin_user_id,
    'action', trim(p_action),
    'target_schema', nullif(trim(coalesce(p_target_schema, '')), ''),
    'target_table', nullif(trim(coalesce(p_target_table, '')), ''),
    'target_id', p_target_id,
    'created_at', v_created_at
  );
end;
$$;

create or replace function api.admin_retry_mint_queue(
  p_admin_user_id uuid,
  p_mint_queue_id uuid,
  p_priority text,
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
  v_queue onchain.mint_queue%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_response jsonb;
  v_existing_idem ops.idempotency_keys%rowtype;
  v_inserted integer;
  v_priority integer;
  v_now timestamptz := now();
  v_audit jsonb;
  v_scope text := 'admin.retry_mint';
  v_request_hash text;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_mint_queue_id is null then
    raise exception 'MINT_QUEUE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from ops.admin_users au
    where au.id = p_admin_user_id
      and au.status = 'active'
  ) then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_priority := case coalesce(lower(nullif(trim(coalesce(p_priority, '')), '')), 'high')
    when 'low' then 200
    when 'normal' then 100
    when 'high' then 10
    else null
  end;

  if v_priority is null then
    raise exception 'ADMIN_PRIORITY_INVALID' using errcode = 'P0001';
  end if;

  v_request_hash := p_mint_queue_id::text || ':' || v_priority::text || ':' || trim(p_reason);

  insert into ops.idempotency_keys (key, scope, request_hash, status, locked_until)
  values (trim(p_idempotency_key), v_scope, v_request_hash, 'started', v_now + interval '5 minutes')
  on conflict (key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_existing_idem
    from ops.idempotency_keys
    where key = trim(p_idempotency_key)
    for update;

    if v_existing_idem.scope <> v_scope
       or coalesce(v_existing_idem.request_hash, '') <> v_request_hash then
      raise exception 'ADMIN_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;

    if v_existing_idem.status = 'completed' and v_existing_idem.response is not null then
      return v_existing_idem.response || jsonb_build_object('idempotent', true);
    end if;

    raise exception 'ADMIN_IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select *
  into v_queue
  from onchain.mint_queue
  where id = p_mint_queue_id
  for update;

  if not found then
    raise exception 'MINT_QUEUE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_queue.status in ('minted', 'cancelled') then
    raise exception 'MINT_QUEUE_NOT_RETRYABLE' using errcode = 'P0001';
  end if;

  if v_queue.status in ('processing', 'submitted', 'confirming') then
    raise exception 'MINT_QUEUE_NOT_RETRYABLE_ACTIVE' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_queue);

  if v_queue.status in ('failed', 'manual_review') then
    update onchain.mint_queue
    set status = 'retrying',
        priority = v_priority,
        next_attempt_at = v_now,
        error_message = null,
        completed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'admin_retry',
          jsonb_build_object(
            'admin_user_id', p_admin_user_id,
            'reason', trim(p_reason),
            'idempotency_key', trim(p_idempotency_key),
            'requested_at', v_now,
            'request_context', coalesce(p_request_context, '{}'::jsonb)
          )
        ),
        updated_at = v_now
    where id = p_mint_queue_id
    returning * into v_queue;

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
      v_queue.user_id,
      'admin_mint_retry',
      'medium',
      'reviewing',
      'mint_queue',
      v_queue.id,
      jsonb_build_object(
        'admin_user_id', p_admin_user_id,
        'previous_status', v_before ->> 'status',
        'reason', trim(p_reason),
        'idempotency_key', trim(p_idempotency_key)
      )
    );
  end if;

  v_after := to_jsonb(v_queue);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'mint.retry',
    'onchain',
    'mint_queue',
    v_queue.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    trim(p_reason)
  );

  v_response := jsonb_build_object(
    'mint_queue_id', v_queue.id,
    'status', v_queue.status,
    'previous_status', v_before ->> 'status',
    'priority', v_queue.priority,
    'next_attempt_at', v_queue.next_attempt_at,
    'audit_log_id', v_audit ->> 'audit_log_id'
  );

  update ops.idempotency_keys
  set status = 'completed',
      response = v_response,
      locked_until = null,
      updated_at = v_now
  where key = trim(p_idempotency_key);

  return v_response;
end;
$$;

create or replace function api.admin_update_feature_flag(
  p_admin_user_id uuid,
  p_key text,
  p_enabled boolean,
  p_description text default null,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_response jsonb;
  v_existing_idem ops.idempotency_keys%rowtype;
  v_inserted integer;
  v_flag ops.feature_flags%rowtype;
  v_now timestamptz := now();
  v_audit jsonb;
  v_scope text := 'admin.feature_flag';
  v_request_hash text;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_key, '')), '') is null then
    raise exception 'FEATURE_FLAG_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if p_enabled is null then
    raise exception 'FEATURE_FLAG_ENABLED_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from ops.admin_users au
    where au.id = p_admin_user_id
      and au.status = 'active'
  ) then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_request_hash := trim(p_key) || ':' || p_enabled::text || ':' || trim(p_reason);

  insert into ops.idempotency_keys (key, scope, request_hash, status, locked_until)
  values (trim(p_idempotency_key), v_scope, v_request_hash, 'started', v_now + interval '5 minutes')
  on conflict (key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_existing_idem
    from ops.idempotency_keys
    where key = trim(p_idempotency_key)
    for update;

    if v_existing_idem.scope <> v_scope
       or coalesce(v_existing_idem.request_hash, '') <> v_request_hash then
      raise exception 'ADMIN_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;

    if v_existing_idem.status = 'completed' and v_existing_idem.response is not null then
      return v_existing_idem.response || jsonb_build_object('idempotent', true);
    end if;

    raise exception 'ADMIN_IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select *
  into v_flag
  from ops.feature_flags
  where key = trim(p_key)
  for update;

  if found then
    v_before := to_jsonb(v_flag);

    update ops.feature_flags
    set enabled = p_enabled,
        description = coalesce(nullif(trim(coalesce(p_description, '')), ''), description),
        updated_by_admin_id = p_admin_user_id,
        updated_at = v_now
    where key = trim(p_key)
    returning * into v_flag;
  else
    insert into ops.feature_flags (
      key,
      enabled,
      description,
      rollout,
      updated_by_admin_id,
      updated_at
    )
    values (
      trim(p_key),
      p_enabled,
      nullif(trim(coalesce(p_description, '')), ''),
      '{}'::jsonb,
      p_admin_user_id,
      v_now
    )
    returning * into v_flag;
  end if;

  v_after := to_jsonb(v_flag);

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    detail
  )
  values (
    'admin_feature_flag_update',
    case
      when trim(p_key) in ('FEATURE_STARS_PAYMENT_ENABLED', 'FEATURE_TON_MINT_ENABLED', 'onchain.mint', 'gacha.open_box')
        then 'medium'
      else 'low'
    end,
    'reviewing',
    'feature_flag',
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'key', trim(p_key),
      'enabled', p_enabled,
      'reason', trim(p_reason),
      'idempotency_key', trim(p_idempotency_key)
    )
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'feature_flag.update',
    'ops',
    'feature_flags',
    null,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    trim(p_reason)
  );

  v_response := jsonb_build_object(
    'key', v_flag.key,
    'enabled', v_flag.enabled,
    'previous_enabled', case when v_before = '{}'::jsonb then null else v_before -> 'enabled' end,
    'audit_log_id', v_audit ->> 'audit_log_id'
  );

  update ops.idempotency_keys
  set status = 'completed',
      response = v_response,
      locked_until = null,
      updated_at = v_now
  where key = trim(p_idempotency_key);

  return v_response;
end;
$$;

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
  v_star_order payments.star_orders%rowtype;
  v_after_order payments.star_orders%rowtype;
  v_payment payments.star_payments%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_response jsonb;
  v_existing_idem ops.idempotency_keys%rowtype;
  v_inserted integer;
  v_now timestamptz := now();
  v_audit jsonb;
  v_scope text := 'admin.retry_fulfillment';
  v_request_hash text;
  v_raw_update jsonb;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_star_order_id is null then
    raise exception 'ADMIN_PAYMENT_ORDER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from ops.admin_users au
    where au.id = p_admin_user_id
      and au.status = 'active'
  ) then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_request_hash := p_star_order_id::text || ':' || trim(p_reason);

  insert into ops.idempotency_keys (key, scope, request_hash, status, locked_until)
  values (trim(p_idempotency_key), v_scope, v_request_hash, 'started', v_now + interval '5 minutes')
  on conflict (key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_existing_idem
    from ops.idempotency_keys
    where key = trim(p_idempotency_key)
    for update;

    if v_existing_idem.scope <> v_scope
       or coalesce(v_existing_idem.request_hash, '') <> v_request_hash then
      raise exception 'ADMIN_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;

    if v_existing_idem.status = 'completed' and v_existing_idem.response is not null then
      return v_existing_idem.response || jsonb_build_object('idempotent', true);
    end if;

    raise exception 'ADMIN_IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001';
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
    raise exception 'ADMIN_PAYMENT_ALREADY_FULFILLED' using errcode = 'P0001';
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
      'reason', trim(p_reason),
      'idempotency_key', trim(p_idempotency_key),
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
      'reason', trim(p_reason),
      'idempotency_key', trim(p_idempotency_key)
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
    trim(p_reason)
  );

  v_response := jsonb_build_object(
    'star_order_id', p_star_order_id,
    'status', coalesce(v_after_order.status, v_star_order.status),
    'previous_status', v_star_order.status,
    'fulfilled', coalesce((v_result ->> 'fulfilled')::boolean, false),
    'fulfillment_status', v_result ->> 'status',
    'reason_code', v_result ->> 'reason_code',
    'retryable', v_result ->> 'retryable',
    'payment_order_status', v_result ->> 'payment_order_status',
    'result_count', v_result ->> 'result_count',
    'audit_log_id', v_audit ->> 'audit_log_id'
  );

  update ops.idempotency_keys
  set status = 'completed',
      response = v_response,
      locked_until = null,
      updated_at = v_now
  where key = trim(p_idempotency_key);

  return v_response;
end;
$$;

revoke all on function api.admin_write_audit_log(
  uuid, text, text, text, uuid, jsonb, jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function api.admin_retry_mint_queue(
  uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function api.admin_update_feature_flag(
  uuid, text, boolean, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function api.admin_retry_payment_fulfillment(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_write_audit_log(
  uuid, text, text, text, uuid, jsonb, jsonb, text, text, text
) to service_role;
grant execute on function api.admin_retry_mint_queue(
  uuid, uuid, text, text, text, jsonb
) to service_role;
grant execute on function api.admin_update_feature_flag(
  uuid, text, boolean, text, text, text, jsonb
) to service_role;
grant execute on function api.admin_retry_payment_fulfillment(
  uuid, uuid, text, text, jsonb
) to service_role;
