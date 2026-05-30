-- Phase 6 admin dangerous operations.
-- Adds transactional RPCs for payment pause follow-ups, probability publishing,
-- asset compensation, user bans, refund request records and inventory lock release.

create or replace function api._admin_require_active(
  p_admin_user_id uuid
)
returns ops.admin_users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
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

  return v_admin;
end;
$$;

create or replace function api._admin_start_idempotency(
  p_key text,
  p_scope text,
  p_request_hash text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(trim(coalesce(p_key, '')), '');
  v_scope text := nullif(trim(coalesce(p_scope, '')), '');
  v_request_hash text := coalesce(p_request_hash, '');
  v_existing ops.idempotency_keys%rowtype;
  v_inserted integer;
begin
  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if v_scope is null then
    raise exception 'ADMIN_IDEMPOTENCY_SCOPE_REQUIRED' using errcode = 'P0001';
  end if;

  insert into ops.idempotency_keys (key, scope, request_hash, status, locked_until)
  values (v_key, v_scope, v_request_hash, 'started', p_now + interval '5 minutes')
  on conflict (key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_existing
    from ops.idempotency_keys
    where key = v_key
    for update;

    if v_existing.scope <> v_scope
       or coalesce(v_existing.request_hash, '') <> v_request_hash then
      raise exception 'ADMIN_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;

    if v_existing.status = 'completed' and v_existing.response is not null then
      return v_existing.response || jsonb_build_object('idempotent', true);
    end if;

    raise exception 'ADMIN_IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001';
  end if;

  return null;
end;
$$;

create or replace function api._admin_complete_idempotency(
  p_key text,
  p_response jsonb,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update ops.idempotency_keys
  set status = 'completed',
      response = coalesce(p_response, '{}'::jsonb),
      locked_until = null,
      updated_at = p_now
  where key = trim(p_key);
end;
$$;

create or replace function api.admin_compensate_asset(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_currency_code text,
  p_amount numeric,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_user core.users%rowtype;
  v_currency text := upper(nullif(trim(coalesce(p_currency_code, '')), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_amount numeric := p_amount;
  v_now timestamptz := now();
  v_scope text := 'admin.compensate_asset';
  v_request_hash text;
  v_idempotent jsonb;
  v_before jsonb;
  v_after jsonb;
  v_credit jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_user_id is null then
    raise exception 'ADMIN_TARGET_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if v_currency is null then
    raise exception 'ADMIN_CURRENCY_REQUIRED' using errcode = 'P0001';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'ADMIN_COMPENSATION_AMOUNT_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from economy.currencies where code = v_currency) then
    raise exception 'ADMIN_CURRENCY_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into v_user
  from core.users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'ADMIN_TARGET_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_user.status = 'deleted' then
    raise exception 'ADMIN_TARGET_USER_DELETED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'user_id', p_user_id,
    'currency_code', v_currency,
    'amount', v_amount,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  v_before := jsonb_build_object(
    'user', to_jsonb(v_user),
    'balance', coalesce(
      (
        select to_jsonb(ub)
        from economy.user_balances ub
        where ub.user_id = p_user_id
          and ub.currency_code = v_currency
      ),
      'null'::jsonb
    )
  );

  v_credit := api.economy_credit(
    p_user_id => p_user_id,
    p_currency_code => v_currency,
    p_amount => v_amount,
    p_source_type => 'admin_compensation',
    p_source_id => p_admin_user_id,
    p_source_ref => 'admin_compensation:' || v_key,
    p_idempotency_key => 'admin_compensation:' || v_key,
    p_note => v_reason,
    p_metadata => coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'reason', v_reason,
      'request_context', coalesce(p_request_context, '{}'::jsonb),
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    )
  );

  v_after := jsonb_build_object(
    'user', to_jsonb(v_user),
    'balance', (
      select to_jsonb(ub)
      from economy.user_balances ub
      where ub.user_id = p_user_id
        and ub.currency_code = v_currency
    ),
    'credit_result', v_credit
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
    p_user_id,
    'admin_asset_compensation',
    'high',
    'reviewing',
    'currency_ledger',
    nullif(v_credit ->> 'ledger_id', '')::uuid,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'currency_code', v_currency,
      'amount', v_amount,
      'reason', v_reason,
      'idempotency_key', v_key,
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    )
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'asset.compensate',
    'economy',
    'currency_ledger',
    nullif(v_credit ->> 'ledger_id', '')::uuid,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'user_id', p_user_id,
    'currency_code', v_currency,
    'amount', v_amount,
    'ledger_id', v_credit ->> 'ledger_id',
    'available_after', v_credit ->> 'available',
    'locked_after', v_credit ->> 'locked',
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_ban_user(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_status text,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_user core.users%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_flag_code text;
  v_flag_level text;
  v_sessions_revoked integer := 0;
  v_now timestamptz := now();
  v_scope text := 'admin.ban_user';
  v_request_hash text;
  v_idempotent jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_user_id is null then
    raise exception 'ADMIN_TARGET_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status not in ('banned', 'restricted') then
    raise exception 'ADMIN_USER_BAN_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_user
  from core.users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'ADMIN_TARGET_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_user.status = 'deleted' then
    raise exception 'ADMIN_TARGET_USER_DELETED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'user_id', p_user_id,
    'status', v_status,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  v_before := jsonb_build_object(
    'user', to_jsonb(v_user),
    'active_flags', coalesce(
      (
        select jsonb_agg(to_jsonb(uf) order by uf.created_at)
        from core.user_flags uf
        where uf.user_id = p_user_id
          and uf.active
      ),
      '[]'::jsonb
    )
  );

  update core.users
  set status = v_status,
      risk_score = greatest(risk_score, case when v_status = 'banned' then 100 else 50 end),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_restriction', jsonb_build_object(
          'status', v_status,
          'admin_user_id', p_admin_user_id,
          'reason', v_reason,
          'idempotency_key', v_key,
          'applied_at', v_now,
          'approval_context', coalesce(p_approval_context, '{}'::jsonb)
        )
      ),
      updated_at = v_now
  where id = p_user_id
  returning * into v_user;

  update core.app_sessions
  set revoked_at = coalesce(revoked_at, v_now)
  where user_id = p_user_id
    and revoked_at is null
    and expires_at > v_now;
  get diagnostics v_sessions_revoked = row_count;

  v_flag_code := case when v_status = 'banned' then 'admin_ban' else 'admin_restriction' end;
  v_flag_level := case when v_status = 'banned' then 'ban' else 'restriction' end;

  insert into core.user_flags (
    user_id,
    flag_code,
    flag_level,
    reason,
    active,
    created_by_admin_id,
    metadata
  )
  values (
    p_user_id,
    v_flag_code,
    v_flag_level,
    v_reason,
    true,
    p_admin_user_id,
    jsonb_build_object(
      'idempotency_key', v_key,
      'request_context', coalesce(p_request_context, '{}'::jsonb),
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    )
  )
  on conflict (user_id, flag_code, active) do update
  set flag_level = excluded.flag_level,
      reason = excluded.reason,
      created_by_admin_id = excluded.created_by_admin_id,
      metadata = core.user_flags.metadata || excluded.metadata;

  insert into ops.risk_events (
    user_id,
    event_type,
    severity,
    status,
    source_type,
    source_id,
    score_delta,
    detail
  )
  values (
    p_user_id,
    'admin_user_ban',
    case when v_status = 'banned' then 'critical' else 'high' end,
    'reviewing',
    'core_user',
    p_user_id,
    case when v_status = 'banned' then 100 else 50 end,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'status', v_status,
      'reason', v_reason,
      'sessions_revoked', v_sessions_revoked,
      'idempotency_key', v_key,
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    )
  );

  v_after := jsonb_build_object(
    'user', to_jsonb(v_user),
    'active_flags', coalesce(
      (
        select jsonb_agg(to_jsonb(uf) order by uf.created_at)
        from core.user_flags uf
        where uf.user_id = p_user_id
          and uf.active
      ),
      '[]'::jsonb
    ),
    'sessions_revoked', v_sessions_revoked
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'user.ban',
    'core',
    'users',
    p_user_id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'user_id', p_user_id,
    'previous_status', v_before -> 'user' ->> 'status',
    'status', v_status,
    'sessions_revoked', v_sessions_revoked,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_request_star_refund(
  p_admin_user_id uuid,
  p_star_order_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_order payments.star_orders%rowtype;
  v_payment payments.star_payments%rowtype;
  v_refund payments.star_refunds%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.request_star_refund';
  v_request_hash text;
  v_idempotent jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_star_order_id is null then
    raise exception 'ADMIN_PAYMENT_ORDER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  if not found then
    raise exception 'ADMIN_PAYMENT_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_order.status in ('refunded', 'disputed') then
    raise exception 'ADMIN_PAYMENT_REFUND_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if v_order.status not in ('paid', 'fulfilling', 'fulfilled', 'failed') then
    raise exception 'ADMIN_PAYMENT_NOT_PAID' using errcode = 'P0001';
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

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'star_order_id', p_star_order_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if exists (
    select 1
    from payments.star_refunds sr
    where sr.star_order_id = p_star_order_id
      and sr.status in ('requested', 'approved', 'processed')
  ) then
    raise exception 'ADMIN_REFUND_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  v_before := jsonb_build_object(
    'star_order', to_jsonb(v_order),
    'star_payment', to_jsonb(v_payment),
    'existing_refunds', coalesce(
      (
        select jsonb_agg(to_jsonb(sr) order by sr.created_at)
        from payments.star_refunds sr
        where sr.star_order_id = p_star_order_id
      ),
      '[]'::jsonb
    )
  );

  insert into payments.star_refunds (
    star_payment_id,
    star_order_id,
    user_id,
    telegram_payment_charge_id,
    xtr_amount,
    status,
    reason,
    requested_by_admin_id,
    metadata
  )
  values (
    v_payment.id,
    v_order.id,
    v_order.user_id,
    v_payment.telegram_payment_charge_id,
    v_payment.xtr_amount,
    'requested',
    v_reason,
    p_admin_user_id,
    jsonb_build_object(
      'idempotency_key', v_key,
      'request_context', coalesce(p_request_context, '{}'::jsonb),
      'approval_context', coalesce(p_approval_context, '{}'::jsonb),
      'note', 'Actual Telegram Stars refund must be completed through the approved payment support flow.'
    )
  )
  returning * into v_refund;

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
    v_order.user_id,
    'admin_star_refund_requested',
    'high',
    'reviewing',
    'star_refund',
    v_refund.id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'star_order_id', p_star_order_id,
      'star_payment_id', v_payment.id,
      'xtr_amount', v_payment.xtr_amount,
      'reason', v_reason,
      'idempotency_key', v_key,
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    )
  );

  v_after := jsonb_build_object(
    'star_order', to_jsonb(v_order),
    'star_payment', to_jsonb(v_payment),
    'star_refund', to_jsonb(v_refund)
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'payment.refund.request',
    'payments',
    'star_refunds',
    v_refund.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'star_order_id', p_star_order_id,
    'star_payment_id', v_payment.id,
    'star_refund_id', v_refund.id,
    'status', v_refund.status,
    'xtr_amount', v_refund.xtr_amount,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_release_inventory_lock(
  p_admin_user_id uuid,
  p_lock_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_lock inventory.inventory_locks%rowtype;
  v_item inventory.item_instances%rowtype;
  v_after_lock inventory.inventory_locks%rowtype;
  v_after_item inventory.item_instances%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.release_inventory_lock';
  v_request_hash text;
  v_idempotent jsonb;
  v_market_result jsonb := null;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_lock_id is null then
    raise exception 'ADMIN_INVENTORY_LOCK_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_lock
  from inventory.inventory_locks
  where id = p_lock_id
  for update;

  if not found then
    raise exception 'ADMIN_INVENTORY_LOCK_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'lock_id', p_lock_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_lock.status <> 'active' then
    raise exception 'ADMIN_INVENTORY_LOCK_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  select *
  into v_item
  from inventory.item_instances
  where id = v_lock.item_instance_id
  for update;

  if not found then
    raise exception 'ADMIN_INVENTORY_ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_before := jsonb_build_object(
    'inventory_lock', to_jsonb(v_lock),
    'item_instance', to_jsonb(v_item),
    'listing', case
      when v_lock.source_type = 'market_listing' and v_lock.source_id is not null then
        coalesce((select to_jsonb(l) from market.listings l where l.id = v_lock.source_id), 'null'::jsonb)
      else 'null'::jsonb
    end
  );

  if v_lock.lock_type = 'market_listing'
     and v_lock.source_type = 'market_listing'
     and v_lock.source_id is not null then
    v_market_result := api.market_cancel_listing(
      v_lock.user_id,
      v_lock.source_id,
      v_key || ':market_cancel',
      'admin_release_inventory_lock:' || v_reason
    );
  else
    if v_item.status not in ('locked', 'listed') then
      raise exception 'ADMIN_INVENTORY_ITEM_STATUS_NOT_RELEASABLE' using errcode = 'P0001';
    end if;

    update inventory.inventory_locks
    set status = 'released',
        released_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'admin_release', jsonb_build_object(
            'admin_user_id', p_admin_user_id,
            'reason', v_reason,
            'idempotency_key', v_key,
            'released_at', v_now,
            'approval_context', coalesce(p_approval_context, '{}'::jsonb)
          )
        ),
        updated_at = v_now
    where id = p_lock_id
    returning * into v_after_lock;

    update inventory.item_instances
    set status = 'available',
        lock_version = lock_version + 1,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'admin_lock_release', jsonb_build_object(
            'admin_user_id', p_admin_user_id,
            'lock_id', p_lock_id,
            'reason', v_reason,
            'idempotency_key', v_key,
            'released_at', v_now
          )
        ),
        updated_at = v_now
    where id = v_lock.item_instance_id
    returning * into v_after_item;

    insert into inventory.item_instance_events (
      item_instance_id,
      user_id,
      event_type,
      source_type,
      source_id,
      before_state,
      after_state,
      metadata
    )
    values (
      v_lock.item_instance_id,
      v_lock.user_id,
      'admin_adjusted',
      'admin_release_inventory_lock',
      p_lock_id,
      to_jsonb(v_item),
      to_jsonb(v_after_item),
      jsonb_build_object(
        'admin_user_id', p_admin_user_id,
        'reason', v_reason,
        'idempotency_key', v_key,
        'approval_context', coalesce(p_approval_context, '{}'::jsonb)
      )
    );
  end if;

  select *
  into v_after_lock
  from inventory.inventory_locks
  where id = p_lock_id;

  select *
  into v_after_item
  from inventory.item_instances
  where id = v_lock.item_instance_id;

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
    v_lock.user_id,
    'admin_inventory_lock_released',
    'high',
    'reviewing',
    'inventory_lock',
    p_lock_id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'item_instance_id', v_lock.item_instance_id,
      'lock_type', v_lock.lock_type,
      'source_type', v_lock.source_type,
      'source_id', v_lock.source_id,
      'market_result', coalesce(v_market_result, '{}'::jsonb),
      'reason', v_reason,
      'idempotency_key', v_key,
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    )
  );

  v_after := jsonb_build_object(
    'inventory_lock', to_jsonb(v_after_lock),
    'item_instance', to_jsonb(v_after_item),
    'market_result', coalesce(v_market_result, '{}'::jsonb)
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'inventory.lock.release',
    'inventory',
    'inventory_locks',
    p_lock_id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'lock_id', p_lock_id,
    'item_instance_id', v_lock.item_instance_id,
    'status', v_after_lock.status,
    'item_status', v_after_item.status,
    'market_result', coalesce(v_market_result, '{}'::jsonb),
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_publish_drop_pool_version(
  p_admin_user_id uuid,
  p_box_id uuid,
  p_items jsonb,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_active_version gacha.drop_pool_versions%rowtype;
  v_new_version gacha.drop_pool_versions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.publish_drop_pool_version';
  v_request_hash text;
  v_idempotent jsonb;
  v_item_count integer;
  v_total_weight numeric;
  v_probability_count integer;
  v_probability_sum integer;
  v_next_version_no integer;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_box_id is null then
    raise exception 'ADMIN_BOX_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'ADMIN_DROP_POOL_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_box
  from gacha.blind_boxes
  where id = p_box_id
  for update;

  if not found then
    raise exception 'ADMIN_BOX_NOT_FOUND' using errcode = 'P0001';
  end if;

  select
    count(*)::int,
    coalesce(sum(drop_weight), 0),
    count(probability_bps)::int,
    coalesce(sum(probability_bps), 0)::int
  into v_item_count, v_total_weight, v_probability_count, v_probability_sum
  from jsonb_to_recordset(p_items) as item(
    template_id uuid,
    form_id uuid,
    rarity_code text,
    drop_weight numeric,
    probability_bps integer,
    stock_total integer,
    stock_remaining integer,
    is_pity_eligible boolean,
    is_featured boolean,
    sort_order integer,
    metadata jsonb
  );

  if v_item_count <= 0 then
    raise exception 'ADMIN_DROP_POOL_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  if v_total_weight <= 0 then
    raise exception 'ADMIN_DROP_POOL_WEIGHT_INVALID' using errcode = 'P0001';
  end if;

  if v_probability_count > 0 and v_probability_count <> v_item_count then
    raise exception 'ADMIN_DROP_POOL_PROBABILITY_INCOMPLETE' using errcode = 'P0001';
  end if;

  if v_probability_count = v_item_count and v_probability_sum <> 10000 then
    raise exception 'ADMIN_DROP_POOL_PROBABILITY_SUM_INVALID' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      template_id uuid,
      form_id uuid,
      rarity_code text,
      drop_weight numeric,
      probability_bps integer,
      stock_total integer,
      stock_remaining integer,
      is_pity_eligible boolean,
      is_featured boolean,
      sort_order integer,
      metadata jsonb
    )
    where item.template_id is null
       or nullif(trim(coalesce(item.rarity_code, '')), '') is null
       or item.drop_weight is null
       or item.drop_weight <= 0
       or (item.probability_bps is not null and (item.probability_bps < 0 or item.probability_bps > 10000))
       or (item.stock_total is not null and item.stock_total < 0)
       or (item.stock_remaining is not null and item.stock_remaining < 0)
       or (item.stock_total is not null and item.stock_remaining is not null and item.stock_remaining > item.stock_total)
       or not exists (select 1 from catalog.collectible_templates t where t.id = item.template_id)
       or (item.form_id is not null and not exists (select 1 from catalog.collectible_forms f where f.id = item.form_id))
       or not exists (select 1 from catalog.rarities r where r.code = upper(trim(item.rarity_code)))
  ) then
    raise exception 'ADMIN_DROP_POOL_ITEM_INVALID' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'box_id', p_box_id,
    'items', p_items,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_active_version
  from gacha.drop_pool_versions
  where box_id = p_box_id
    and status = 'active'
  for update;

  v_before := jsonb_build_object(
    'box', to_jsonb(v_box),
    'active_version', case
      when v_active_version.id is null then 'null'::jsonb
      else to_jsonb(v_active_version)
    end,
    'active_items', case
      when v_active_version.id is null then '[]'::jsonb
      else coalesce(
        (
          select jsonb_agg(to_jsonb(dpi) order by dpi.sort_order, dpi.created_at)
          from gacha.drop_pool_items dpi
          where dpi.pool_version_id = v_active_version.id
        ),
        '[]'::jsonb
      )
    end
  );

  select coalesce(max(version_no), 0) + 1
  into v_next_version_no
  from gacha.drop_pool_versions
  where box_id = p_box_id;

  update gacha.drop_pool_versions
  set status = 'archived',
      effective_to = coalesce(effective_to, v_now),
      updated_at = v_now
  where box_id = p_box_id
    and status = 'active';

  insert into gacha.drop_pool_versions (
    box_id,
    version_no,
    status,
    total_weight,
    published_at,
    effective_from,
    config_snapshot,
    created_by_admin_id
  )
  values (
    p_box_id,
    v_next_version_no,
    'active',
    v_total_weight,
    v_now,
    v_now,
    jsonb_build_object(
      'reason', v_reason,
      'idempotency_key', v_key,
      'previous_version_id', v_active_version.id,
      'item_count', v_item_count,
      'probability_sum_bps', v_probability_sum,
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    ),
    p_admin_user_id
  )
  returning * into v_new_version;

  insert into gacha.drop_pool_items (
    pool_version_id,
    template_id,
    form_id,
    rarity_code,
    drop_weight,
    probability_bps,
    stock_total,
    stock_remaining,
    is_pity_eligible,
    is_featured,
    sort_order,
    metadata
  )
  select
    v_new_version.id,
    item.template_id,
    item.form_id,
    upper(trim(item.rarity_code)),
    item.drop_weight,
    item.probability_bps,
    item.stock_total,
    item.stock_remaining,
    coalesce(item.is_pity_eligible, true),
    coalesce(item.is_featured, false),
    coalesce(item.sort_order, 100),
    coalesce(item.metadata, '{}'::jsonb) || jsonb_build_object(
      'admin_publish', jsonb_build_object(
        'admin_user_id', p_admin_user_id,
        'idempotency_key', v_key,
        'published_at', v_now
      )
    )
  from jsonb_to_recordset(p_items) as item(
    template_id uuid,
    form_id uuid,
    rarity_code text,
    drop_weight numeric,
    probability_bps integer,
    stock_total integer,
    stock_remaining integer,
    is_pity_eligible boolean,
    is_featured boolean,
    sort_order integer,
    metadata jsonb
  );

  select *
  into v_new_version
  from gacha.drop_pool_versions
  where id = v_new_version.id;

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    source_id,
    detail
  )
  values (
    'admin_drop_pool_published',
    'high',
    'reviewing',
    'drop_pool_version',
    v_new_version.id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'box_id', p_box_id,
      'previous_version_id', v_active_version.id,
      'new_version_id', v_new_version.id,
      'version_no', v_new_version.version_no,
      'item_count', v_item_count,
      'total_weight', v_total_weight,
      'probability_sum_bps', v_probability_sum,
      'reason', v_reason,
      'idempotency_key', v_key,
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    )
  );

  v_after := jsonb_build_object(
    'box', to_jsonb(v_box),
    'new_version', to_jsonb(v_new_version),
    'new_items', coalesce(
      (
        select jsonb_agg(to_jsonb(dpi) order by dpi.sort_order, dpi.created_at)
        from gacha.drop_pool_items dpi
        where dpi.pool_version_id = v_new_version.id
      ),
      '[]'::jsonb
    )
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'gacha.drop_pool.publish',
    'gacha',
    'drop_pool_versions',
    v_new_version.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'box_id', p_box_id,
    'previous_version_id', v_active_version.id,
    'drop_pool_version_id', v_new_version.id,
    'version_no', v_new_version.version_no,
    'status', v_new_version.status,
    'item_count', v_item_count,
    'total_weight', v_new_version.total_weight,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

update ops.admin_roles
set permissions = case
  when permissions ? 'users:ban' then permissions
  else permissions || '["users:ban"]'::jsonb
end,
updated_at = now()
where code = 'RISK';

revoke all on function api._admin_require_active(uuid) from public, anon, authenticated;
revoke all on function api._admin_start_idempotency(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function api._admin_complete_idempotency(text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function api.admin_compensate_asset(uuid, uuid, text, numeric, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_ban_user(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_request_star_refund(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_release_inventory_lock(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_publish_drop_pool_version(uuid, uuid, jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;

grant execute on function api._admin_require_active(uuid) to service_role;
grant execute on function api._admin_start_idempotency(text, text, text, timestamptz) to service_role;
grant execute on function api._admin_complete_idempotency(text, jsonb, timestamptz) to service_role;
grant execute on function api.admin_compensate_asset(uuid, uuid, text, numeric, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function api.admin_ban_user(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
grant execute on function api.admin_request_star_refund(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function api.admin_release_inventory_lock(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function api.admin_publish_drop_pool_version(uuid, uuid, jsonb, text, text, jsonb, jsonb) to service_role;
