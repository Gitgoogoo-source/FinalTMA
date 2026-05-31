-- Phase 6 payment support configuration.
-- Stores non-sensitive payment support contacts in ops.system_settings with
-- transactional admin audit logging and idempotency.

begin;

create or replace function api.admin_update_payment_support_config(
  p_admin_user_id uuid,
  p_support_url text default null,
  p_support_email text default null,
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
  v_before_row ops.system_settings%rowtype;
  v_after_row ops.system_settings%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_support_url text := nullif(trim(coalesce(p_support_url, '')), '');
  v_support_email text := nullif(lower(trim(coalesce(p_support_email, ''))), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.payment_support_config';
  v_request_hash text;
  v_idempotent jsonb;
  v_configured boolean;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if v_support_url is not null and v_support_url !~* '^https://[^[:space:]]+$' then
    raise exception 'ADMIN_PAYMENT_SUPPORT_URL_INVALID' using errcode = 'P0001';
  end if;

  if v_support_email is not null
     and v_support_email !~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' then
    raise exception 'ADMIN_PAYMENT_SUPPORT_EMAIL_INVALID' using errcode = 'P0001';
  end if;

  v_configured := v_support_url is not null or v_support_email is not null;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'support_url', v_support_url,
    'support_email', v_support_email,
    'configured', v_configured,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(
    v_key,
    v_scope,
    v_request_hash,
    v_now
  );
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_before_row
  from ops.system_settings
  where key = 'PAYMENT_SUPPORT_CONFIG'
  for update;

  if found then
    v_before := to_jsonb(v_before_row);
  end if;

  insert into ops.system_settings (
    key,
    value,
    description,
    updated_by_admin_id,
    updated_at
  )
  values (
    'PAYMENT_SUPPORT_CONFIG',
    jsonb_build_object(
      'support_url', v_support_url,
      'support_email', v_support_email,
      'configured', v_configured,
      'updated_at', v_now
    ),
    'Non-sensitive payment support contact configuration. Real secrets must stay in server env.',
    p_admin_user_id,
    v_now
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_by_admin_id = excluded.updated_by_admin_id,
      updated_at = excluded.updated_at
  returning * into v_after_row;

  v_after := to_jsonb(v_after_row);

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    detail
  )
  values (
    'admin_payment_support_config_update',
    case when v_configured then 'low' else 'medium' end,
    'reviewing',
    'system_setting',
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'key', 'PAYMENT_SUPPORT_CONFIG',
      'configured', v_configured,
      'support_url_configured', v_support_url is not null,
      'support_email_configured', v_support_email is not null,
      'reason', v_reason,
      'idempotency_key', v_key
    )
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'payment.support_config.update',
    'ops',
    'system_settings',
    null,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'key', 'PAYMENT_SUPPORT_CONFIG',
    'configured', v_configured,
    'support_url', v_support_url,
    'support_email', v_support_email,
    'updated_at', v_after_row.updated_at,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$$;

revoke all on function api.admin_update_payment_support_config(
  uuid, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_update_payment_support_config(
  uuid, text, text, text, text, jsonb
) to service_role;

commit;
