-- admin_write_audit_log.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Writes an admin audit log entry for every high-risk operation.
-- Call this from admin API handlers after validating admin permissions.

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
begin
  if p_admin_user_id is null then
    raise exception 'admin_user_id is required';
  end if;
  if p_action is null or length(trim(p_action)) = 0 then
    raise exception 'action is required';
  end if;

  select * into v_admin
  from ops.admin_users
  where id = p_admin_user_id
  for update;

  if v_admin.id is null then
    raise exception 'admin user not found';
  end if;
  if v_admin.status <> 'active' then
    raise exception 'admin user is not active';
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
  ) values (
    p_admin_user_id,
    trim(p_action),
    nullif(trim(coalesce(p_target_schema, '')), ''),
    nullif(trim(coalesce(p_target_table, '')), ''),
    p_target_id,
    coalesce(p_before_state, '{}'::jsonb),
    coalesce(p_after_state, '{}'::jsonb),
    p_ip_hash,
    p_user_agent,
    p_reason
  ) returning id into v_audit_id;

  update ops.admin_users
  set last_login_at = coalesce(last_login_at, now()),
      updated_at = now()
  where id = p_admin_user_id;

  return jsonb_build_object(
    'audit_log_id', v_audit_id,
    'admin_user_id', p_admin_user_id,
    'action', trim(p_action),
    'target_schema', p_target_schema,
    'target_table', p_target_table,
    'target_id', p_target_id,
    'created_at', now()
  );
end;
$$;


-- ============================================================
