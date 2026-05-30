-- Phase 6: expand drop pool version lifecycle statuses and enforce the
-- admin-facing edit / validate / publish state machine.

alter table gacha.drop_pool_versions
  drop constraint if exists drop_pool_versions_status_check;

alter table gacha.drop_pool_versions
  add constraint drop_pool_versions_status_check
  check (
    status in (
      'draft',
      'validating',
      'scheduled',
      'active',
      'archived',
      'disabled'
    )
  );

comment on column gacha.drop_pool_versions.status is
  'Drop pool lifecycle: draft editable, validating locked for validation, scheduled validated and waiting publish, active live, archived historical, disabled forcibly offline.';

create or replace function api._admin_get_completed_idempotency(
  p_key text,
  p_scope text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(trim(coalesce(p_key, '')), '');
  v_scope text := nullif(trim(coalesce(p_scope, '')), '');
  v_existing ops.idempotency_keys%rowtype;
begin
  if v_key is null or v_scope is null then
    return null;
  end if;

  select *
  into v_existing
  from ops.idempotency_keys
  where key = v_key
  for update;

  if not found then
    return null;
  end if;

  if v_existing.scope <> v_scope
     or coalesce(v_existing.request_hash, '') <> coalesce(p_request_hash, '') then
    raise exception 'ADMIN_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  if v_existing.status = 'completed' and v_existing.response is not null then
    return v_existing.response || jsonb_build_object('idempotent', true);
  end if;

  raise exception 'ADMIN_IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001';
end;
$$;

alter function api.admin_update_drop_pool_item(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  text,
  text,
  jsonb
) rename to _admin_update_drop_pool_item_unchecked_p6_status;

create or replace function api.admin_update_drop_pool_item(
  p_admin_user_id uuid,
  p_drop_pool_version_id uuid,
  p_box_id uuid default null,
  p_version_name text default null,
  p_items jsonb default '[]'::jsonb,
  p_pity_rules jsonb default '[]'::jsonb,
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
  v_status text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_version_name text := nullif(trim(coalesce(p_version_name, '')), '');
  v_scope text := 'admin.update_drop_pool_item';
  v_request_hash text;
  v_idempotent jsonb;
begin
  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'drop_pool_version_id', p_drop_pool_version_id,
    'box_id', p_box_id,
    'version_name', v_version_name,
    'items', coalesce(p_items, '[]'::jsonb),
    'pity_rules', coalesce(p_pity_rules, '[]'::jsonb),
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_get_completed_idempotency(
    p_idempotency_key,
    v_scope,
    v_request_hash
  );
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select status
  into v_status
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id
  for update;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_status <> 'draft' then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_EDITABLE' using errcode = 'P0001';
  end if;

  return api._admin_update_drop_pool_item_unchecked_p6_status(
    p_admin_user_id,
    p_drop_pool_version_id,
    p_box_id,
    p_version_name,
    p_items,
    p_pity_rules,
    p_reason,
    p_idempotency_key,
    p_request_context
  );
end;
$$;

alter function api.admin_validate_drop_pool(
  uuid,
  uuid,
  text,
  text,
  jsonb
) rename to _admin_validate_drop_pool_unchecked_p6_status;

create or replace function api.admin_validate_drop_pool(
  p_admin_user_id uuid,
  p_drop_pool_version_id uuid,
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
  v_status text;
  v_next_status text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_scope text := 'admin.validate_drop_pool';
  v_request_hash text;
  v_idempotent jsonb;
  v_result jsonb;
begin
  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'drop_pool_version_id', p_drop_pool_version_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_get_completed_idempotency(
    p_idempotency_key,
    v_scope,
    v_request_hash
  );
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select status
  into v_status
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id
  for update;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_status in ('active', 'archived', 'disabled') then
    v_result := api._admin_validate_drop_pool_unchecked_p6_status(
      p_admin_user_id,
      p_drop_pool_version_id,
      p_reason,
      p_idempotency_key,
      p_request_context
    );

    v_result := v_result || jsonb_build_object('status', v_status);

    update ops.idempotency_keys
    set response = v_result,
        updated_at = now()
    where key = trim(p_idempotency_key)
      and scope = v_scope
      and status = 'completed';

    return v_result;
  end if;

  if v_status not in ('draft', 'validating', 'scheduled') then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_VALIDATABLE' using errcode = 'P0001';
  end if;

  update gacha.drop_pool_versions
  set status = 'validating',
      updated_at = now()
  where id = p_drop_pool_version_id;

  v_result := api._admin_validate_drop_pool_unchecked_p6_status(
    p_admin_user_id,
    p_drop_pool_version_id,
    p_reason,
    p_idempotency_key,
    p_request_context
  );

  v_next_status := case
    when coalesce((v_result ->> 'valid')::boolean, false) then 'scheduled'
    else 'draft'
  end;

  update gacha.drop_pool_versions
  set status = v_next_status,
      config_snapshot = config_snapshot || jsonb_build_object(
        'validation_status',
        jsonb_build_object(
          'previous_status', v_status,
          'status', v_next_status,
          'valid', coalesce((v_result ->> 'valid')::boolean, false),
          'validated_by_admin_id', p_admin_user_id,
          'validated_at', now()
        )
      ),
      updated_at = now()
  where id = p_drop_pool_version_id;

  v_result := v_result || jsonb_build_object('status', v_next_status);

  update ops.idempotency_keys
  set response = v_result,
      updated_at = now()
  where key = trim(p_idempotency_key)
    and scope = v_scope
    and status = 'completed';

  return v_result;
end;
$$;

alter function api._admin_execute_publish_drop_pool_version(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb
) rename to _admin_execute_publish_drop_pool_unchecked_p6_status;

create or replace function api._admin_execute_publish_drop_pool_version(
  p_admin_user_id uuid,
  p_drop_pool_version_id uuid,
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
  v_status text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_scope text := 'admin.publish_drop_pool_version';
  v_request_hash text;
  v_idempotent jsonb;
begin
  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'drop_pool_version_id', p_drop_pool_version_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_get_completed_idempotency(
    p_idempotency_key,
    v_scope,
    v_request_hash
  );
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select status
  into v_status
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id
  for update;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_status not in ('draft', 'scheduled') then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_PUBLISHABLE' using errcode = 'P0001';
  end if;

  return api._admin_execute_publish_drop_pool_unchecked_p6_status(
    p_admin_user_id,
    p_drop_pool_version_id,
    p_reason,
    p_idempotency_key,
    p_request_context,
    p_approval_context
  );
end;
$$;

revoke all on function api._admin_get_completed_idempotency(text, text, text)
  from public, anon, authenticated;
revoke all on function api._admin_update_drop_pool_item_unchecked_p6_status(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function api._admin_validate_drop_pool_unchecked_p6_status(
  uuid,
  uuid,
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function api._admin_execute_publish_drop_pool_unchecked_p6_status(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function api.admin_update_drop_pool_item(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  text,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function api.admin_validate_drop_pool(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function api._admin_execute_publish_drop_pool_version(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function api._admin_get_completed_idempotency(text, text, text)
  to service_role;
grant execute on function api.admin_update_drop_pool_item(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  text,
  text,
  jsonb
) to service_role;
grant execute on function api.admin_validate_drop_pool(uuid, uuid, text, text, jsonb)
  to service_role;
grant execute on function api._admin_execute_publish_drop_pool_version(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb
) to service_role;

comment on function api.admin_update_drop_pool_item(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  text,
  text,
  jsonb
) is 'Replace drop pool draft items and pity rules. Only draft versions are editable.';

comment on function api.admin_validate_drop_pool(uuid, uuid, text, text, jsonb)
  is 'Validate a drop pool version; editable versions are locked as validating and valid versions move to scheduled.';

comment on function api._admin_execute_publish_drop_pool_version(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb
) is 'Publish draft or scheduled drop pool versions; validating, active, archived and disabled versions are not publishable.';
