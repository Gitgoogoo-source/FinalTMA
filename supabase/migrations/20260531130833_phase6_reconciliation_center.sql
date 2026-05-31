-- Phase 6 step 2.6: reconciliation center.
-- Expands reconciliation run coverage and adds audited admin handling for
-- open risk findings. This migration is local-tested before remote apply.

begin;

alter table economy.reconciliation_runs
  drop constraint if exists reconciliation_runs_run_type_check;

alter table economy.reconciliation_runs
  add constraint reconciliation_runs_run_type_check
  check (
    run_type = any (
      array[
        'ledger_balance'::text,
        'market_settlement'::text,
        'payment'::text,
        'inventory'::text,
        'payment_fulfillment'::text,
        'mint_queue'::text,
        'wallet_sync'::text,
        'inventory_lock'::text,
        'gacha_stock'::text,
        'referral_commission'::text
      ]
    )
  );

alter table ops.risk_events
  drop constraint if exists risk_events_status_check;

alter table ops.risk_events
  add constraint risk_events_status_check
  check (
    status = any (
      array[
        'open'::text,
        'reviewing'::text,
        'resolved'::text,
        'ignored'::text,
        'fixed'::text,
        'false_positive'::text,
        'escalated'::text
      ]
    )
  );

create unique index if not exists reconciliation_runs_one_running_type_idx
  on economy.reconciliation_runs (run_type)
  where status = 'running';

comment on index economy.reconciliation_runs_one_running_type_idx is
  'Phase 6 reconciliation center: prevents two active jobs for the same run_type.';

drop index if exists ops.risk_events_open_reconciliation_source_idx;

create unique index risk_events_open_reconciliation_source_idx
  on ops.risk_events (event_type, source_type, source_id)
  where source_id is not null
    and status in ('open', 'reviewing')
    and detail ? 'reconciliation_run_id'
    and detail ? 'reconciliation_run_type';

comment on index ops.risk_events_open_reconciliation_source_idx is
  'Phase 6 reconciliation center: one open/reviewing reconciliation finding per business source.';

create index if not exists risk_events_reconciliation_findings_query_idx
  on ops.risk_events (
    status,
    severity,
    (detail ->> 'reconciliation_run_type'),
    (detail ->> 'reconciliation_run_id'),
    created_at desc
  )
  where detail ? 'reconciliation_run_id'
    and detail ? 'reconciliation_run_type';

comment on index ops.risk_events_reconciliation_findings_query_idx is
  'Phase 6 reconciliation center: supports read-only admin filtering of reconciliation-generated findings.';

create or replace function api._admin_require_any_permission(
  p_admin_user_id uuid,
  p_permissions text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if coalesce(array_length(p_permissions, 1), 0) = 0
     or not exists (
       select 1
       from unnest(p_permissions) as requested(permission)
       where nullif(trim(coalesce(requested.permission, '')), '') is not null
     ) then
    raise exception 'ADMIN_PERMISSION_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from ops.admin_user_roles aur
    join ops.admin_roles ar on ar.id = aur.role_id
    where aur.admin_user_id = p_admin_user_id
      and (
        ar.permissions ? '*'
        or exists (
          select 1
          from unnest(p_permissions) as requested(permission)
          cross join lateral (
            select trim(coalesce(requested.permission, '')) as permission
          ) normalized
          where normalized.permission <> ''
            and (
              ar.permissions ? normalized.permission
              or exists (
                select 1
                from jsonb_array_elements_text(
                  case
                    when jsonb_typeof(ar.permissions) = 'array' then ar.permissions
                    else '[]'::jsonb
                  end
                ) as owned(permission)
                where owned.permission like '%:*'
                  and normalized.permission like left(
                    owned.permission,
                    length(owned.permission) - 1
                  ) || '%'
              )
            )
        )
      )
  ) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function api.admin_resolve_reconciliation_finding(
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
  v_finding ops.risk_events%rowtype;
  v_updated ops.risk_events%rowtype;
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_scope text := 'admin.resolve_reconciliation_finding';
  v_request_hash text;
  v_idempotent jsonb;
  v_now timestamptz := now();
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_response jsonb;
  v_resolution jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['risk:write']);

  if p_risk_event_id is null then
    raise exception 'ADMIN_RECONCILIATION_FINDING_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status is null or v_status not in (
    'reviewing',
    'ignored',
    'fixed',
    'false_positive',
    'escalated'
  ) then
    raise exception 'ADMIN_RECONCILIATION_FINDING_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status = 'fixed'
     and nullif(trim(coalesce(p_resolution_detail ->> 'fix_method', '')), '') is null then
    raise exception 'ADMIN_RECONCILIATION_FIX_METHOD_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status = 'escalated'
     and nullif(trim(coalesce(p_resolution_detail ->> 'ticket_id', '')), '') is null
     and nullif(trim(coalesce(p_resolution_detail ->> 'escalation_owner', '')), '') is null then
    raise exception 'ADMIN_RECONCILIATION_ESCALATION_TARGET_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'risk_event_id', p_risk_event_id,
    'status', v_status,
    'reason', v_reason,
    'resolution_detail', coalesce(p_resolution_detail, '{}'::jsonb)
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
  into v_finding
  from ops.risk_events
  where id = p_risk_event_id
  for update;

  if not found then
    raise exception 'ADMIN_RECONCILIATION_FINDING_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    v_finding.detail ? 'reconciliation_run_id'
    and v_finding.detail ? 'reconciliation_run_type'
    and v_finding.detail ->> 'reconciliation_run_type' in (
      'payment_fulfillment',
      'mint_queue',
      'wallet_sync',
      'ledger_balance',
      'market_settlement',
      'inventory_lock',
      'gacha_stock',
      'referral_commission'
    )
  ) then
    raise exception 'ADMIN_RECONCILIATION_FINDING_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  if v_finding.status not in ('open', 'reviewing') then
    raise exception 'ADMIN_RECONCILIATION_FINDING_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_finding);
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
    'reconciliation.finding.resolve',
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
    'previous_status', v_finding.status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'resolved_at', v_updated.resolved_at,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$$;

revoke all on function api._admin_require_any_permission(
  uuid,
  text[]
) from public, anon, authenticated;

revoke all on function api.admin_resolve_reconciliation_finding(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function api._admin_require_any_permission(
  uuid,
  text[]
) to service_role;

grant execute on function api.admin_resolve_reconciliation_finding(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) to service_role;

comment on function api._admin_require_any_permission(
  uuid,
  text[]
) is
  'Phase 6 admin helper: requires at least one of the supplied admin permissions or wildcard.';

comment on function api.admin_resolve_reconciliation_finding(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) is
  'Phase 6 reconciliation center: audited/idempotent admin status transition for risk findings.';

commit;
