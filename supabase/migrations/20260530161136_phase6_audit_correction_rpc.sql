-- Phase 6 audit correction RPC.
-- Audit logs are append-only. Corrections are represented by a new
-- audit.correction row that points at the original audit log.

create or replace function api.admin_append_audit_correction(
  p_admin_user_id uuid,
  p_audit_log_id uuid,
  p_correction text,
  p_reason text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original ops.admin_audit_logs%rowtype;
  v_context jsonb := coalesce(p_request_context, '{}'::jsonb);
  v_correction text := nullif(trim(coalesce(p_correction, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_audit jsonb;
begin
  if p_admin_user_id is null then
    raise exception 'AUDIT_ADMIN_USER_REQUIRED';
  end if;

  if p_audit_log_id is null then
    raise exception 'AUDIT_CORRECTION_TARGET_REQUIRED';
  end if;

  if v_correction is null then
    raise exception 'AUDIT_CORRECTION_REQUIRED';
  end if;

  if v_reason is null then
    raise exception 'AUDIT_CORRECTION_REASON_REQUIRED';
  end if;

  select *
  into v_original
  from ops.admin_audit_logs
  where id = p_audit_log_id;

  if v_original.id is null then
    raise exception 'AUDIT_CORRECTION_TARGET_NOT_FOUND';
  end if;

  if v_original.action = 'audit.correction' then
    raise exception 'AUDIT_CORRECTION_TARGET_INVALID';
  end if;

  v_audit := api.admin_write_audit_log(
    p_admin_user_id => p_admin_user_id,
    p_action => 'audit.correction',
    p_target_schema => 'ops',
    p_target_table => 'admin_audit_logs',
    p_target_id => v_original.id,
    p_before_state => jsonb_build_object(
      'corrected_audit_log',
      jsonb_build_object(
        'id', v_original.id,
        'admin_user_id', v_original.admin_user_id,
        'action', v_original.action,
        'target_schema', v_original.target_schema,
        'target_table', v_original.target_table,
        'target_id', v_original.target_id,
        'reason', v_original.reason,
        'created_at', v_original.created_at
      )
    ),
    p_after_state => jsonb_build_object(
      'correction',
      jsonb_build_object(
        'corrected_audit_log_id', v_original.id,
        'note', v_correction
      ),
      'request_context', v_context
    ),
    p_ip_hash => nullif(v_context ->> 'ip_hash', ''),
    p_user_agent => coalesce(
      nullif(v_context ->> 'user_agent_hash', ''),
      nullif(v_context ->> 'user_agent', '')
    ),
    p_reason => v_reason
  );

  return jsonb_build_object(
    'audit_log_id', v_audit ->> 'audit_log_id',
    'corrected_audit_log_id', v_original.id,
    'admin_user_id', p_admin_user_id,
    'action', 'audit.correction',
    'target_schema', 'ops',
    'target_table', 'admin_audit_logs',
    'target_id', v_original.id,
    'created_at', v_audit ->> 'created_at'
  );
end;
$$;

comment on function api.admin_append_audit_correction(uuid, uuid, text, text, jsonb)
  is 'Append-only correction entry for ops.admin_audit_logs. Never updates or deletes the original audit log.';

revoke all on function api.admin_append_audit_correction(uuid, uuid, text, text, jsonb)
from public, anon, authenticated;

grant execute on function api.admin_append_audit_correction(uuid, uuid, text, text, jsonb)
to service_role;
