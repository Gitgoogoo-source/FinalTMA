-- Phase 5: service-role RPC facade for server idempotency records.
--
-- The local Data API intentionally does not expose the private ops schema.
-- Vercel Functions still need to reserve and complete idempotency records
-- through Supabase REST/RPC, so this exposes narrow service_role-only
-- functions in the api schema without granting direct ops table access.

begin;

create or replace function api.idempotency_insert_started(
  p_scope text,
  p_key text,
  p_user_id uuid,
  p_request_hash text,
  p_locked_until timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record ops.idempotency_keys%rowtype;
begin
  insert into ops.idempotency_keys (
    key,
    user_id,
    scope,
    request_hash,
    response,
    status,
    locked_until,
    updated_at
  )
  values (
    p_key,
    p_user_id,
    p_scope,
    p_request_hash,
    null,
    'started',
    p_locked_until,
    now()
  )
  returning *
  into v_record;

  return to_jsonb(v_record);
end;
$$;

create or replace function api.idempotency_get(
  p_scope text,
  p_key text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_record ops.idempotency_keys%rowtype;
begin
  select *
  into v_record
  from ops.idempotency_keys
  where scope = p_scope
    and key = p_key
  limit 1;

  if v_record.key is null then
    return null;
  end if;

  return to_jsonb(v_record);
end;
$$;

create or replace function api.idempotency_update_status(
  p_scope text,
  p_key text,
  p_request_hash text,
  p_expected_status text,
  p_expected_locked_until timestamptz,
  p_next_status text,
  p_next_locked_until timestamptz,
  p_response jsonb default null,
  p_replace_response boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record ops.idempotency_keys%rowtype;
begin
  if p_expected_status not in ('started', 'completed', 'failed') then
    raise exception 'invalid expected idempotency status';
  end if;

  if p_next_status not in ('started', 'completed', 'failed') then
    raise exception 'invalid next idempotency status';
  end if;

  update ops.idempotency_keys
  set status = p_next_status,
      response = case
        when p_replace_response then p_response
        else response
      end,
      locked_until = p_next_locked_until,
      updated_at = now()
  where scope = p_scope
    and key = p_key
    and request_hash = p_request_hash
    and status = p_expected_status
    and (
      (p_expected_locked_until is null and locked_until is null)
      or locked_until = p_expected_locked_until
    )
  returning *
  into v_record;

  if v_record.key is null then
    return null;
  end if;

  return to_jsonb(v_record);
end;
$$;

revoke execute on function api.idempotency_insert_started(text, text, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function api.idempotency_get(text, text)
  from public, anon, authenticated;
revoke execute on function api.idempotency_update_status(text, text, text, text, timestamptz, text, timestamptz, jsonb, boolean)
  from public, anon, authenticated;

grant execute on function api.idempotency_insert_started(text, text, uuid, text, timestamptz)
  to service_role;
grant execute on function api.idempotency_get(text, text)
  to service_role;
grant execute on function api.idempotency_update_status(text, text, text, text, timestamptz, text, timestamptz, jsonb, boolean)
  to service_role;

commit;
