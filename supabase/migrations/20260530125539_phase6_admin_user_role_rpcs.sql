-- Phase 6: admin user and role mutation RPCs.
--
-- Keep privileged admin identity changes behind service_role-only RPCs so the
-- API layer can perform permission checks while the database keeps mutation,
-- idempotency and audit writes in one transaction.

begin;

create or replace function api.admin_create_user(
  p_admin_user_id uuid,
  p_core_user_id uuid default null,
  p_telegram_user_id bigint default null,
  p_email text default null,
  p_display_name text default null,
  p_status text default 'active',
  p_metadata jsonb default '{}'::jsonb,
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
  v_actor ops.admin_users%rowtype;
  v_core_user core.users%rowtype;
  v_telegram_core_user core.users%rowtype;
  v_existing_admin ops.admin_users%rowtype;
  v_target_admin ops.admin_users%rowtype;
  v_before jsonb := jsonb_build_object('admin_user', null);
  v_after jsonb;
  v_response jsonb;
  v_existing_idem ops.idempotency_keys%rowtype;
  v_inserted integer;
  v_now timestamptz := now();
  v_audit jsonb;
  v_scope text := 'admin.create_user';
  v_request_hash text;
  v_key text;
  v_reason text;
  v_email text;
  v_display_name text;
  v_status text;
  v_metadata jsonb;
  v_core_user_id uuid;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_actor
  from ops.admin_users
  where id = p_admin_user_id
  for update;

  if not found then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_actor.status <> 'active' then
    raise exception 'ADMIN_USER_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  v_email := nullif(trim(coalesce(p_email, '')), '');
  v_display_name := nullif(trim(coalesce(p_display_name, '')), '');
  v_status := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_status := coalesce(v_status, 'active');
  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  v_core_user_id := p_core_user_id;

  if v_status not in ('active', 'disabled', 'locked') then
    raise exception 'ADMIN_USER_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_telegram_user_id is not null and p_telegram_user_id <= 0 then
    raise exception 'ADMIN_TELEGRAM_USER_ID_INVALID' using errcode = 'P0001';
  end if;

  if v_core_user_id is null and p_telegram_user_id is null and v_email is null then
    raise exception 'ADMIN_BINDING_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  if v_core_user_id is not null then
    select *
    into v_core_user
    from core.users
    where id = v_core_user_id;

    if not found then
      raise exception 'ADMIN_CORE_USER_NOT_FOUND' using errcode = 'P0001';
    end if;

    if p_telegram_user_id is not null
       and v_core_user.telegram_user_id <> p_telegram_user_id then
      raise exception 'ADMIN_CORE_TELEGRAM_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if p_telegram_user_id is not null then
    select *
    into v_telegram_core_user
    from core.users
    where telegram_user_id = p_telegram_user_id;

    if found then
      if v_core_user_id is not null and v_core_user_id <> v_telegram_core_user.id then
        raise exception 'ADMIN_CORE_TELEGRAM_MISMATCH' using errcode = 'P0001';
      end if;

      v_core_user_id := v_telegram_core_user.id;
    end if;
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'actor_admin_user_id', p_admin_user_id,
    'core_user_id', v_core_user_id,
    'telegram_user_id', p_telegram_user_id,
    'email', v_email,
    'display_name', v_display_name,
    'status', v_status,
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  insert into ops.idempotency_keys (key, scope, request_hash, status, locked_until)
  values (v_key, v_scope, v_request_hash, 'started', v_now + interval '5 minutes')
  on conflict (key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_existing_idem
    from ops.idempotency_keys
    where key = v_key
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
  into v_existing_admin
  from ops.admin_users
  where (v_core_user_id is not null and core_user_id = v_core_user_id)
     or (p_telegram_user_id is not null and telegram_user_id = p_telegram_user_id)
     or (v_email is not null and email = v_email)
  for update;

  if found then
    raise exception 'ADMIN_USER_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  begin
    insert into ops.admin_users (
      core_user_id,
      telegram_user_id,
      email,
      display_name,
      status,
      metadata,
      updated_at
    )
    values (
      v_core_user_id,
      p_telegram_user_id,
      v_email,
      v_display_name,
      v_status,
      v_metadata,
      v_now
    )
    returning *
    into v_target_admin;
  exception
    when unique_violation then
      raise exception 'ADMIN_USER_ALREADY_EXISTS' using errcode = 'P0001';
  end;

  select *
  into v_target_admin
  from ops.admin_users
  where id = v_target_admin.id;

  v_after := to_jsonb(v_target_admin);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'admin.create_user',
    'ops',
    'admin_users',
    v_target_admin.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'admin_user_id', v_target_admin.id,
    'core_user_id', v_target_admin.core_user_id,
    'telegram_user_id', v_target_admin.telegram_user_id,
    'email', v_target_admin.email,
    'display_name', v_target_admin.display_name,
    'status', v_target_admin.status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  update ops.idempotency_keys
  set status = 'completed',
      response = v_response,
      locked_until = null,
      updated_at = v_now
  where key = v_key;

  return v_response;
end;
$$;

create or replace function api.admin_update_user_status(
  p_admin_user_id uuid,
  p_target_admin_user_id uuid,
  p_status text,
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
  v_actor ops.admin_users%rowtype;
  v_target_admin ops.admin_users%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_response jsonb;
  v_existing_idem ops.idempotency_keys%rowtype;
  v_inserted integer;
  v_now timestamptz := now();
  v_audit jsonb;
  v_scope text := 'admin.update_status';
  v_request_hash text;
  v_key text;
  v_reason text;
  v_status text;
  v_active_super_admin_count integer;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_target_admin_user_id is null then
    raise exception 'ADMIN_TARGET_USER_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_actor
  from ops.admin_users
  where id = p_admin_user_id
  for update;

  if not found then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_actor.status <> 'active' then
    raise exception 'ADMIN_USER_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  v_status := lower(nullif(trim(coalesce(p_status, '')), ''));
  if v_status not in ('active', 'disabled', 'locked') then
    raise exception 'ADMIN_USER_STATUS_INVALID' using errcode = 'P0001';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'actor_admin_user_id', p_admin_user_id,
    'target_admin_user_id', p_target_admin_user_id,
    'status', v_status,
    'reason', v_reason
  )::text;

  insert into ops.idempotency_keys (key, scope, request_hash, status, locked_until)
  values (v_key, v_scope, v_request_hash, 'started', v_now + interval '5 minutes')
  on conflict (key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_existing_idem
    from ops.idempotency_keys
    where key = v_key
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
  into v_target_admin
  from ops.admin_users
  where id = p_target_admin_user_id
  for update;

  if not found then
    raise exception 'ADMIN_TARGET_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_target_admin);

  if v_target_admin.status = 'active'
     and v_status <> 'active'
     and exists (
       select 1
       from ops.admin_user_roles aur
       join ops.admin_roles ar on ar.id = aur.role_id
       where aur.admin_user_id = v_target_admin.id
         and ar.code = 'SUPER_ADMIN'
     ) then
    select count(*)::int
    into v_active_super_admin_count
    from ops.admin_user_roles aur
    join ops.admin_roles ar on ar.id = aur.role_id
    join ops.admin_users au on au.id = aur.admin_user_id
    where ar.code = 'SUPER_ADMIN'
      and au.status = 'active';

    if v_active_super_admin_count <= 1 then
      raise exception 'ADMIN_LAST_SUPER_ADMIN_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if v_target_admin.status <> v_status then
    update ops.admin_users
    set status = v_status,
        updated_at = v_now
    where id = p_target_admin_user_id
    returning *
    into v_target_admin;
  end if;

  select *
  into v_target_admin
  from ops.admin_users
  where id = p_target_admin_user_id;

  v_after := to_jsonb(v_target_admin);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'admin.update_status',
    'ops',
    'admin_users',
    v_target_admin.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'admin_user_id', v_target_admin.id,
    'previous_status', v_before ->> 'status',
    'status', v_target_admin.status,
    'status_changed', (v_before ->> 'status') is distinct from v_target_admin.status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  update ops.idempotency_keys
  set status = 'completed',
      response = v_response,
      locked_until = null,
      updated_at = v_now
  where key = v_key;

  return v_response;
end;
$$;

create or replace function api.admin_grant_role(
  p_admin_user_id uuid,
  p_target_admin_user_id uuid,
  p_role_id uuid,
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
  v_actor ops.admin_users%rowtype;
  v_target_admin ops.admin_users%rowtype;
  v_role ops.admin_roles%rowtype;
  v_existing_link ops.admin_user_roles%rowtype;
  v_after_link ops.admin_user_roles%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_response jsonb;
  v_existing_idem ops.idempotency_keys%rowtype;
  v_inserted integer;
  v_now timestamptz := now();
  v_audit jsonb;
  v_scope text := 'admin.grant_role';
  v_request_hash text;
  v_key text;
  v_reason text;
  v_role_granted boolean := false;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_target_admin_user_id is null then
    raise exception 'ADMIN_TARGET_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_role_id is null then
    raise exception 'ADMIN_ROLE_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_actor
  from ops.admin_users
  where id = p_admin_user_id
  for update;

  if not found then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_actor.status <> 'active' then
    raise exception 'ADMIN_USER_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'actor_admin_user_id', p_admin_user_id,
    'target_admin_user_id', p_target_admin_user_id,
    'role_id', p_role_id,
    'reason', v_reason
  )::text;

  insert into ops.idempotency_keys (key, scope, request_hash, status, locked_until)
  values (v_key, v_scope, v_request_hash, 'started', v_now + interval '5 minutes')
  on conflict (key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_existing_idem
    from ops.idempotency_keys
    where key = v_key
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
  into v_role
  from ops.admin_roles
  where id = p_role_id;

  if not found then
    raise exception 'ADMIN_ROLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into v_target_admin
  from ops.admin_users
  where id = p_target_admin_user_id
  for update;

  if not found then
    raise exception 'ADMIN_TARGET_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_target_admin.status = 'disabled' then
    raise exception 'ADMIN_TARGET_USER_DISABLED' using errcode = 'P0001';
  end if;

  select *
  into v_existing_link
  from ops.admin_user_roles
  where admin_user_id = p_target_admin_user_id
    and role_id = p_role_id
  for update;

  v_before := jsonb_build_object(
    'admin_user', to_jsonb(v_target_admin),
    'role', to_jsonb(v_role),
    'role_link', case
      when v_existing_link.admin_user_id is null then null::jsonb
      else to_jsonb(v_existing_link)
    end
  );

  insert into ops.admin_user_roles (
    admin_user_id,
    role_id,
    granted_by_admin_id,
    granted_at
  )
  values (
    p_target_admin_user_id,
    p_role_id,
    p_admin_user_id,
    v_now
  )
  on conflict (admin_user_id, role_id) do nothing;

  get diagnostics v_inserted = row_count;
  v_role_granted := v_inserted > 0;

  select *
  into v_after_link
  from ops.admin_user_roles
  where admin_user_id = p_target_admin_user_id
    and role_id = p_role_id;

  v_after := jsonb_build_object(
    'admin_user', to_jsonb(v_target_admin),
    'role', to_jsonb(v_role),
    'role_link', to_jsonb(v_after_link),
    'role_granted', v_role_granted
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'admin.grant_role',
    'ops',
    'admin_user_roles',
    p_target_admin_user_id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'admin_user_id', p_target_admin_user_id,
    'role_id', p_role_id,
    'role_code', v_role.code,
    'role_granted', v_role_granted,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  update ops.idempotency_keys
  set status = 'completed',
      response = v_response,
      locked_until = null,
      updated_at = v_now
  where key = v_key;

  return v_response;
end;
$$;

create or replace function api.admin_revoke_role(
  p_admin_user_id uuid,
  p_target_admin_user_id uuid,
  p_role_id uuid,
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
  v_actor ops.admin_users%rowtype;
  v_target_admin ops.admin_users%rowtype;
  v_role ops.admin_roles%rowtype;
  v_existing_link ops.admin_user_roles%rowtype;
  v_after_link ops.admin_user_roles%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_response jsonb;
  v_existing_idem ops.idempotency_keys%rowtype;
  v_inserted integer;
  v_deleted integer;
  v_now timestamptz := now();
  v_audit jsonb;
  v_scope text := 'admin.revoke_role';
  v_request_hash text;
  v_key text;
  v_reason text;
  v_active_super_admin_count integer;
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_target_admin_user_id is null then
    raise exception 'ADMIN_TARGET_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_role_id is null then
    raise exception 'ADMIN_ROLE_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_actor
  from ops.admin_users
  where id = p_admin_user_id
  for update;

  if not found then
    raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_actor.status <> 'active' then
    raise exception 'ADMIN_USER_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'actor_admin_user_id', p_admin_user_id,
    'target_admin_user_id', p_target_admin_user_id,
    'role_id', p_role_id,
    'reason', v_reason
  )::text;

  insert into ops.idempotency_keys (key, scope, request_hash, status, locked_until)
  values (v_key, v_scope, v_request_hash, 'started', v_now + interval '5 minutes')
  on conflict (key) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
    into v_existing_idem
    from ops.idempotency_keys
    where key = v_key
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
  into v_role
  from ops.admin_roles
  where id = p_role_id;

  if not found then
    raise exception 'ADMIN_ROLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into v_target_admin
  from ops.admin_users
  where id = p_target_admin_user_id
  for update;

  if not found then
    raise exception 'ADMIN_TARGET_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into v_existing_link
  from ops.admin_user_roles
  where admin_user_id = p_target_admin_user_id
    and role_id = p_role_id
  for update;

  if v_role.code = 'SUPER_ADMIN' and v_existing_link.admin_user_id is not null then
    select count(*)::int
    into v_active_super_admin_count
    from ops.admin_user_roles aur
    join ops.admin_roles ar on ar.id = aur.role_id
    join ops.admin_users au on au.id = aur.admin_user_id
    where ar.code = 'SUPER_ADMIN'
      and au.status = 'active';

    if v_target_admin.status = 'active' and v_active_super_admin_count <= 1 then
      raise exception 'ADMIN_LAST_SUPER_ADMIN_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  v_before := jsonb_build_object(
    'admin_user', to_jsonb(v_target_admin),
    'role', to_jsonb(v_role),
    'role_link', case
      when v_existing_link.admin_user_id is null then null::jsonb
      else to_jsonb(v_existing_link)
    end
  );

  delete from ops.admin_user_roles
  where admin_user_id = p_target_admin_user_id
    and role_id = p_role_id;

  get diagnostics v_deleted = row_count;

  select *
  into v_after_link
  from ops.admin_user_roles
  where admin_user_id = p_target_admin_user_id
    and role_id = p_role_id;

  v_after := jsonb_build_object(
    'admin_user', to_jsonb(v_target_admin),
    'role', to_jsonb(v_role),
    'role_link', case
      when v_after_link.admin_user_id is null then null::jsonb
      else to_jsonb(v_after_link)
    end,
    'role_revoked', v_deleted > 0
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'admin.revoke_role',
    'ops',
    'admin_user_roles',
    p_target_admin_user_id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'admin_user_id', p_target_admin_user_id,
    'role_id', p_role_id,
    'role_code', v_role.code,
    'role_revoked', v_deleted > 0,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  update ops.idempotency_keys
  set status = 'completed',
      response = v_response,
      locked_until = null,
      updated_at = v_now
  where key = v_key;

  return v_response;
end;
$$;

revoke all on function api.admin_create_user(
  uuid, uuid, bigint, text, text, text, jsonb, text, text, jsonb
) from public, anon, authenticated;
revoke all on function api.admin_update_user_status(
  uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function api.admin_grant_role(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
revoke all on function api.admin_revoke_role(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_create_user(
  uuid, uuid, bigint, text, text, text, jsonb, text, text, jsonb
) to service_role;
grant execute on function api.admin_update_user_status(
  uuid, uuid, text, text, text, jsonb
) to service_role;
grant execute on function api.admin_grant_role(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;
grant execute on function api.admin_revoke_role(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

commit;
