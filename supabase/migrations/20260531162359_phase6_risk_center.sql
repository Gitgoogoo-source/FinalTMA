-- Phase 6 step 2.7: risk center DB/RPC layer.
-- Keeps risk writes behind audited/idempotent RPCs and backend-only execute grants.

begin;

insert into ops.system_settings (key, value, description)
values (
  'risk.event_types',
  jsonb_build_object(
    'payment_duplicate_webhook', jsonb_build_object('category', 'payment', 'default_severity', 'medium', 'default_score_delta', 10),
    'payment_paid_not_fulfilled', jsonb_build_object('category', 'payment', 'default_severity', 'high', 'default_score_delta', 30),
    'payment_disputed', jsonb_build_object('category', 'payment', 'default_severity', 'critical', 'default_score_delta', 50),
    'gacha_high_frequency', jsonb_build_object('category', 'gacha', 'default_severity', 'medium', 'default_score_delta', 10),
    'gacha_stock_mismatch', jsonb_build_object('category', 'gacha', 'default_severity', 'high', 'default_score_delta', 30),
    'gacha_fulfillment_mismatch', jsonb_build_object('category', 'gacha', 'default_severity', 'high', 'default_score_delta', 25),
    'market_self_trade', jsonb_build_object('category', 'market', 'default_severity', 'high', 'default_score_delta', 30),
    'market_price_manipulation', jsonb_build_object('category', 'market', 'default_severity', 'high', 'default_score_delta', 25),
    'market_abnormal_cancel_rate', jsonb_build_object('category', 'market', 'default_severity', 'medium', 'default_score_delta', 10),
    'referral_abuse', jsonb_build_object('category', 'referral', 'default_severity', 'high', 'default_score_delta', 20),
    'referral_self_loop', jsonb_build_object('category', 'referral', 'default_severity', 'critical', 'default_score_delta', 40),
    'referral_multi_account', jsonb_build_object('category', 'referral', 'default_severity', 'high', 'default_score_delta', 25),
    'multi_account_wallet', jsonb_build_object('category', 'wallet', 'default_severity', 'high', 'default_score_delta', 20),
    'wallet_proof_replay', jsonb_build_object('category', 'wallet', 'default_severity', 'critical', 'default_score_delta', 40),
    'wallet_sync_stuck', jsonb_build_object('category', 'wallet', 'default_severity', 'medium', 'default_score_delta', 10),
    'mint_retry_exceeded', jsonb_build_object('category', 'mint', 'default_severity', 'high', 'default_score_delta', 25),
    'mint_confirmed_queue_not_minted', jsonb_build_object('category', 'mint', 'default_severity', 'high', 'default_score_delta', 30),
    'ledger_balance_mismatch', jsonb_build_object('category', 'ledger', 'default_severity', 'critical', 'default_score_delta', 50),
    'negative_balance_detected', jsonb_build_object('category', 'ledger', 'default_severity', 'critical', 'default_score_delta', 60)
  ),
  'Phase 6 risk center: stable risk event type defaults for payment, gacha, market, referral, wallet, mint and ledger signals.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

insert into ops.system_settings (key, value, description)
values (
  'risk.user_flag_whitelist',
  '[
    "gacha_blocked",
    "market_buy_blocked",
    "market_sell_blocked",
    "task_reward_blocked",
    "mint_blocked",
    "kcoin_frozen",
    "fgems_frozen",
    "support_review_required"
  ]'::jsonb,
  'Phase 6 risk center: user flag codes allowed through api.admin_apply_user_flag.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

insert into ops.system_settings (key, value, description)
values (
  'risk.score_thresholds',
  jsonb_build_object(
    'enabled', true,
    'auto_apply_enabled', false,
    'thresholds', jsonb_build_array(
      jsonb_build_object(
        'min_score', 80,
        'suggested_flag_code', 'support_review_required',
        'flag_level', 'warning',
        'reason', 'Risk score reached support review threshold.'
      ),
      jsonb_build_object(
        'min_score', 120,
        'suggested_flag_code', 'gacha_blocked',
        'flag_level', 'restriction',
        'reason', 'Risk score reached gacha restriction review threshold.'
      ),
      jsonb_build_object(
        'min_score', 160,
        'suggested_flag_code', 'market_sell_blocked',
        'flag_level', 'restriction',
        'reason', 'Risk score reached market restriction review threshold.'
      )
    )
  ),
  'Phase 6 risk center: score thresholds that suggest user flags; automatic execution is controlled by auto_apply_enabled.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

update ops.admin_roles
set permissions = case
  when permissions ? 'risk:read' then permissions
  when jsonb_typeof(permissions) = 'array' then permissions || '["risk:read"]'::jsonb
  else '["risk:read"]'::jsonb
end,
updated_at = now()
where code = 'SUPPORT';

alter table core.user_flags
  add column if not exists updated_at timestamptz not null default now();

alter table core.user_flags
  drop constraint if exists user_flags_user_id_flag_code_active_key;

create unique index if not exists user_flags_active_code_unique_idx
  on core.user_flags (user_id, flag_code)
  where active;

comment on index core.user_flags_active_code_unique_idx is
  'Phase 6 risk center: only one active flag per user/code while preserving inactive history.';

create or replace function api._admin_execute_ban_user(
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
  on conflict (user_id, flag_code) where active
  do update
  set flag_level = excluded.flag_level,
      reason = excluded.reason,
      created_by_admin_id = excluded.created_by_admin_id,
      metadata = coalesce(user_flags.metadata, '{}'::jsonb) || excluded.metadata;

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

create or replace function api._risk_user_flag_allowed(
  p_flag_code text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from ops.system_settings s
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(s.value) = 'array' then s.value
        else '[]'::jsonb
      end
    ) as allowed(flag_code)
    where s.key = 'risk.user_flag_whitelist'
      and allowed.flag_code = lower(nullif(trim(coalesce(p_flag_code, '')), ''))
  );
$$;

create or replace function api.risk_record_event(
  p_user_id uuid default null,
  p_event_type text default null,
  p_severity text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_score_delta integer default null,
  p_detail jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text := lower(nullif(trim(coalesce(p_event_type, '')), ''));
  v_severity text := lower(nullif(trim(coalesce(p_severity, '')), ''));
  v_source_type text := lower(nullif(trim(coalesce(p_source_type, '')), ''));
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'risk.record_event';
  v_request_hash text;
  v_idempotent jsonb;
  v_config jsonb;
  v_recent_count integer := 0;
  v_score_delta integer;
  v_user_risk_score integer := null;
  v_threshold_policy jsonb;
  v_threshold jsonb;
  v_flag_suggestion jsonb := null;
  v_event ops.risk_events%rowtype;
  v_response jsonb;
begin
  if v_event_type is null then
    raise exception 'RISK_EVENT_TYPE_REQUIRED' using errcode = 'P0001';
  end if;

  select s.value -> v_event_type
  into v_config
  from ops.system_settings s
  where s.key = 'risk.event_types';

  if v_config is null then
    raise exception 'RISK_EVENT_TYPE_INVALID' using errcode = 'P0001';
  end if;

  v_severity := coalesce(v_severity, v_config ->> 'default_severity');

  if v_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'RISK_EVENT_SEVERITY_INVALID' using errcode = 'P0001';
  end if;

  v_score_delta := coalesce(
    p_score_delta,
    nullif(v_config ->> 'default_score_delta', '')::integer,
    0
  );

  if v_score_delta < 0 then
    raise exception 'RISK_SCORE_DELTA_INVALID' using errcode = 'P0001';
  end if;

  if p_user_id is not null and not exists (select 1 from core.users where id = p_user_id) then
    raise exception 'RISK_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'user_id', p_user_id,
    'event_type', v_event_type,
    'severity', v_severity,
    'source_type', v_source_type,
    'source_id', p_source_id,
    'score_delta', v_score_delta,
    'detail', coalesce(p_detail, '{}'::jsonb)
  )::text;

  if v_key is not null then
    v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
    if v_idempotent is not null then
      return v_idempotent;
    end if;
  end if;

  if p_user_id is not null then
    select count(*)::integer
    into v_recent_count
    from ops.risk_events
    where user_id = p_user_id
      and created_at >= v_now - interval '1 hour';

    v_score_delta := v_score_delta + least(25, v_recent_count * 5);
  end if;

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
    v_event_type,
    v_severity,
    'open',
    v_source_type,
    p_source_id,
    v_score_delta,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object(
      'risk_event_type_category', v_config ->> 'category',
      'idempotency_key', v_key,
      'recorded_at', v_now
    )
  )
  returning * into v_event;

  if p_user_id is not null and v_score_delta <> 0 then
    update core.users
    set risk_score = greatest(0, risk_score + v_score_delta),
        updated_at = v_now
    where id = p_user_id
    returning risk_score into v_user_risk_score;
  elsif p_user_id is not null then
    select risk_score
    into v_user_risk_score
    from core.users
    where id = p_user_id;
  end if;

  if p_user_id is not null then
    select s.value
    into v_threshold_policy
    from ops.system_settings s
    where s.key = 'risk.score_thresholds';

    if coalesce((v_threshold_policy ->> 'enabled')::boolean, false)
       and jsonb_typeof(v_threshold_policy -> 'thresholds') = 'array' then
      select threshold.value
      into v_threshold
      from jsonb_array_elements(v_threshold_policy -> 'thresholds') as threshold(value)
      where coalesce(nullif(threshold.value ->> 'min_score', '')::integer, 2147483647)
        <= coalesce(v_user_risk_score, 0)
      order by coalesce(nullif(threshold.value ->> 'min_score', '')::integer, 0) desc
      limit 1;

      if v_threshold is not null
         and api._risk_user_flag_allowed(v_threshold ->> 'suggested_flag_code') then
        v_flag_suggestion := jsonb_build_object(
          'flag_code', v_threshold ->> 'suggested_flag_code',
          'flag_level', coalesce(v_threshold ->> 'flag_level', 'restriction'),
          'reason', v_threshold ->> 'reason',
          'risk_score', v_user_risk_score,
          'min_score', nullif(v_threshold ->> 'min_score', '')::integer,
          'auto_apply_enabled', coalesce((v_threshold_policy ->> 'auto_apply_enabled')::boolean, false)
        );

        update ops.risk_events
        set detail = detail || jsonb_build_object('flag_suggestion', v_flag_suggestion)
        where id = v_event.id
        returning * into v_event;
      end if;
    end if;
  end if;

  v_response := jsonb_build_object(
    'risk_event_id', v_event.id,
    'severity', v_event.severity,
    'score_delta', v_event.score_delta,
    'risk_score', v_user_risk_score,
    'flag_suggestion', v_flag_suggestion,
    'status', v_event.status,
    'server_time', v_now,
    'idempotent', false
  );

  if v_key is not null then
    perform api._admin_complete_idempotency(v_key, v_response, v_now);
  end if;

  return v_response;
end;
$$;

create or replace function api.admin_resolve_risk_event(
  p_admin_user_id uuid,
  p_risk_event_id uuid,
  p_status text,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_resolution_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_event ops.risk_events%rowtype;
  v_updated ops.risk_events%rowtype;
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.resolve_risk_event';
  v_request_hash text;
  v_idempotent jsonb;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_resolution jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['risk:write', 'admin:write']);

  if p_risk_event_id is null then
    raise exception 'ADMIN_RISK_EVENT_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status is null or v_status not in (
    'reviewing',
    'ignored',
    'fixed',
    'false_positive',
    'escalated',
    'resolved'
  ) then
    raise exception 'ADMIN_RISK_EVENT_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'risk_event_id', p_risk_event_id,
    'status', v_status,
    'reason', v_reason,
    'resolution_detail', coalesce(p_resolution_detail, '{}'::jsonb)
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_event
  from ops.risk_events
  where id = p_risk_event_id
  for update;

  if not found then
    raise exception 'ADMIN_RISK_EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_event.status not in ('open', 'reviewing') then
    raise exception 'ADMIN_RISK_EVENT_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_event);
  v_resolution := jsonb_build_object(
    'status', v_status,
    'reason', v_reason,
    'admin_user_id', p_admin_user_id,
    'request_id', p_request_context ->> 'request_id',
    'resolved_at', case when v_status = 'reviewing' then null else v_now end,
    'detail', coalesce(p_resolution_detail, '{}'::jsonb)
  );

  update ops.risk_events
  set status = v_status,
      resolved_by_admin_id = case
        when v_status = 'reviewing' then null
        else p_admin_user_id
      end,
      resolved_at = case
        when v_status = 'reviewing' then null
        else v_now
      end,
      detail = coalesce(detail, '{}'::jsonb)
        || jsonb_build_object('manual_resolution', v_resolution)
  where id = p_risk_event_id
  returning * into v_updated;

  v_after := to_jsonb(v_updated);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'risk.resolve_event',
    'ops',
    'risk_events',
    p_risk_event_id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'risk_event_id', p_risk_event_id,
    'status', v_updated.status,
    'previous_status', v_event.status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'resolved_at', v_updated.resolved_at,
    'server_time', v_now,
    'idempotent', false
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$$;

create or replace function api.admin_apply_user_flag(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_flag_code text,
  p_flag_level text default 'restriction',
  p_reason text default null,
  p_ends_at timestamptz default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_user core.users%rowtype;
  v_existing core.user_flags%rowtype;
  v_flag core.user_flags%rowtype;
  v_flag_code text := lower(nullif(trim(coalesce(p_flag_code, '')), ''));
  v_flag_level text := lower(nullif(trim(coalesce(p_flag_level, '')), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.apply_user_flag';
  v_request_hash text;
  v_idempotent jsonb;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['risk:write', 'admin:write']);

  if p_user_id is null then
    raise exception 'ADMIN_TARGET_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if v_flag_code is null or not api._risk_user_flag_allowed(v_flag_code) then
    raise exception 'ADMIN_USER_FLAG_CODE_INVALID' using errcode = 'P0001';
  end if;

  if v_flag_level is null then
    v_flag_level := 'restriction';
  end if;

  if v_flag_level not in ('info', 'warning', 'restriction', 'ban') then
    raise exception 'ADMIN_USER_FLAG_LEVEL_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_ends_at is not null and p_ends_at <= v_now then
    raise exception 'ADMIN_USER_FLAG_ENDS_AT_INVALID' using errcode = 'P0001';
  end if;

  select *
  into v_user
  from core.users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'ADMIN_TARGET_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'user_id', p_user_id,
    'flag_code', v_flag_code,
    'flag_level', v_flag_level,
    'reason', v_reason,
    'ends_at', p_ends_at,
    'metadata', coalesce(p_metadata, '{}'::jsonb)
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_existing
  from core.user_flags
  where user_id = p_user_id
    and flag_code = v_flag_code
    and active
  for update;

  v_before := case when found then to_jsonb(v_existing) else 'null'::jsonb end;

  insert into core.user_flags (
    user_id,
    flag_code,
    flag_level,
    reason,
    active,
    starts_at,
    ends_at,
    created_by_admin_id,
    metadata
  )
  values (
    p_user_id,
    v_flag_code,
    v_flag_level,
    v_reason,
    true,
    v_now,
    p_ends_at,
    p_admin_user_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'applied_by_admin_id', p_admin_user_id,
      'applied_at', v_now,
      'idempotency_key', v_key
    )
  )
  on conflict (user_id, flag_code) where active
  do update
  set flag_level = excluded.flag_level,
      reason = excluded.reason,
      ends_at = excluded.ends_at,
      created_by_admin_id = excluded.created_by_admin_id,
      metadata = coalesce(user_flags.metadata, '{}'::jsonb)
        || coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'updated_by_admin_id', p_admin_user_id,
          'updated_reason', v_reason,
          'updated_at', v_now,
          'idempotency_key', v_key
        )
  returning * into v_flag;

  v_after := to_jsonb(v_flag);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'risk.apply_user_flag',
    'core',
    'user_flags',
    v_flag.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'user_flag_id', v_flag.id,
    'user_id', v_flag.user_id,
    'flag_code', v_flag.flag_code,
    'flag_level', v_flag.flag_level,
    'active', v_flag.active,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'server_time', v_now,
    'idempotent', false
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$$;

create or replace function api.admin_clear_user_flag(
  p_admin_user_id uuid,
  p_user_flag_id uuid default null,
  p_user_id uuid default null,
  p_flag_code text default null,
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
  v_admin ops.admin_users%rowtype;
  v_flag core.user_flags%rowtype;
  v_updated core.user_flags%rowtype;
  v_flag_code text := lower(nullif(trim(coalesce(p_flag_code, '')), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.clear_user_flag';
  v_request_hash text;
  v_idempotent jsonb;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['risk:write', 'admin:write']);

  if p_user_flag_id is null and (p_user_id is null or v_flag_code is null) then
    raise exception 'ADMIN_USER_FLAG_TARGET_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'user_flag_id', p_user_flag_id,
    'user_id', p_user_id,
    'flag_code', v_flag_code,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_flag
  from core.user_flags
  where active
    and (
      (p_user_flag_id is not null and id = p_user_flag_id)
      or (
        p_user_flag_id is null
        and user_id = p_user_id
        and flag_code = v_flag_code
      )
    )
  for update;

  if not found then
    raise exception 'ADMIN_USER_FLAG_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_flag);

  update core.user_flags
  set active = false,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cleared_reason', v_reason,
        'cleared_by_admin_id', p_admin_user_id,
        'cleared_at', v_now,
        'idempotency_key', v_key
      )
  where id = v_flag.id
    and active
  returning * into v_updated;

  if not found then
    raise exception 'ADMIN_USER_FLAG_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  v_after := to_jsonb(v_updated);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'risk.clear_user_flag',
    'core',
    'user_flags',
    v_updated.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'user_flag_id', v_updated.id,
    'user_id', v_updated.user_id,
    'flag_code', v_updated.flag_code,
    'active', v_updated.active,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'server_time', v_now,
    'idempotent', false
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$$;

revoke all on function api._risk_user_flag_allowed(text)
  from public, anon, authenticated;

revoke all on function api.risk_record_event(
  uuid,
  text,
  text,
  text,
  uuid,
  integer,
  jsonb,
  text
) from public, anon, authenticated;

revoke all on function api.admin_resolve_risk_event(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;

revoke all on function api.admin_apply_user_flag(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;

revoke all on function api.admin_clear_user_flag(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function api._risk_user_flag_allowed(text)
  to service_role;

grant execute on function api.risk_record_event(
  uuid,
  text,
  text,
  text,
  uuid,
  integer,
  jsonb,
  text
) to service_role;

grant execute on function api.admin_resolve_risk_event(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) to service_role;

grant execute on function api.admin_apply_user_flag(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  text,
  jsonb,
  jsonb
) to service_role;

grant execute on function api.admin_clear_user_flag(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) to service_role;

comment on function api.risk_record_event(
  uuid,
  text,
  text,
  text,
  uuid,
  integer,
  jsonb,
  text
) is
  'Phase 6 risk center: records normalized risk events, applies defaults and updates user risk score.';

comment on function api.admin_resolve_risk_event(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) is
  'Phase 6 risk center: audited/idempotent admin status transition for risk events.';

comment on function api.admin_apply_user_flag(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  text,
  jsonb,
  jsonb
) is
  'Phase 6 risk center: audited/idempotent admin application of whitelisted active user flags.';

comment on function api.admin_clear_user_flag(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) is
  'Phase 6 risk center: audited/idempotent admin clearing of active user flags.';

commit;
