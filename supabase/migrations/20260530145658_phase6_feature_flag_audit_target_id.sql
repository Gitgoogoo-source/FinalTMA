-- Phase 6 audit target IDs for feature flag admin writes.
-- Keep the text key as the public flag identifier, but give each row a stable
-- UUID so ops.admin_audit_logs.target_id can always point at a primary record.

alter table ops.feature_flags
  add column if not exists id uuid;

update ops.feature_flags
set id = gen_random_uuid()
where id is null;

alter table ops.feature_flags
  alter column id set default gen_random_uuid();

alter table ops.feature_flags
  alter column id set not null;

create unique index if not exists feature_flags_id_idx
  on ops.feature_flags (id);

comment on column ops.feature_flags.id is
  'Stable UUID used as ops.admin_audit_logs.target_id for feature flag writes.';

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
  v_before jsonb := 'null'::jsonb;
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
    source_id,
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
    v_flag.id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'key', trim(p_key),
      'feature_flag_id', v_flag.id,
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
    v_flag.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    trim(p_reason)
  );

  v_response := jsonb_build_object(
    'key', v_flag.key,
    'target_schema', 'ops',
    'target_table', 'feature_flags',
    'target_id', v_flag.id,
    'enabled', v_flag.enabled,
    'previous_enabled', case when jsonb_typeof(v_before) = 'object' then v_before -> 'enabled' else null end,
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

revoke all on function api.admin_update_feature_flag(
  uuid, text, boolean, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_update_feature_flag(
  uuid, text, boolean, text, text, text, jsonb
) to service_role;
