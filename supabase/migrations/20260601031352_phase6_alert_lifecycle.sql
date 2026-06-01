-- Phase 6 step 2.8 alert lifecycle.
-- Alerts are separate from ops.risk_events so risk-center event/status
-- semantics remain stable.

create table if not exists ops.alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  title text not null,
  message text,
  source_type text not null,
  source_id uuid not null,
  detail jsonb not null default '{}'::jsonb,
  occurrence_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_by_admin_id uuid references ops.admin_users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by_admin_id uuid references ops.admin_users(id) on delete set null,
  resolved_at timestamptz,
  ignored_by_admin_id uuid references ops.admin_users(id) on delete set null,
  ignored_at timestamptz,
  status_reason text,
  resolution_result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alerts_alert_type_present_check
    check (nullif(trim(alert_type), '') is not null),
  constraint alerts_title_present_check
    check (nullif(trim(title), '') is not null),
  constraint alerts_source_type_present_check
    check (nullif(trim(source_type), '') is not null),
  constraint alerts_severity_check
    check (severity = any (array['info'::text, 'warning'::text, 'critical'::text])),
  constraint alerts_status_check
    check (status = any (array['open'::text, 'acknowledged'::text, 'resolved'::text, 'ignored'::text])),
  constraint alerts_occurrence_count_check
    check (occurrence_count >= 1),
  constraint alerts_detail_object_check
    check (jsonb_typeof(detail) = 'object'),
  constraint alerts_status_reason_check
    check (status = 'open' or nullif(trim(coalesce(status_reason, '')), '') is not null),
  constraint alerts_resolution_result_check
    check (status <> 'resolved' or nullif(trim(coalesce(resolution_result, '')), '') is not null)
);

create index if not exists alerts_status_severity_last_seen_idx
  on ops.alerts (status, severity, last_seen_at desc, id desc);

create index if not exists alerts_source_idx
  on ops.alerts (source_type, source_id, last_seen_at desc);

create index if not exists alerts_created_at_idx
  on ops.alerts (created_at desc, id desc);

create unique index if not exists alerts_active_source_unique_idx
  on ops.alerts (alert_type, source_type, source_id)
  where status in ('open', 'acknowledged');

alter table ops.alerts enable row level security;

revoke all privileges on table ops.alerts from public, anon, authenticated;
grant all privileges on table ops.alerts to service_role;

drop policy if exists ops_alerts_deny_client_access on ops.alerts;
create policy ops_alerts_deny_client_access on ops.alerts
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

comment on table ops.alerts is
  'Business monitoring alerts with acknowledged/resolved/ignored lifecycle.';

comment on column ops.alerts.detail is
  'Sanitized alert detail. source_type and source_id are duplicated here for admin navigation.';

create or replace function api._alert_sanitize_detail(p_detail jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_type text := jsonb_typeof(coalesce(p_detail, '{}'::jsonb));
  v_key text;
  v_value jsonb;
  v_result jsonb;
  v_string text;
begin
  if v_type = 'object' then
    v_result := '{}'::jsonb;

    for v_key, v_value in
      select key, value
      from jsonb_each(coalesce(p_detail, '{}'::jsonb))
    loop
      if v_key ~* '(^|[_-])(initdata|init_data|authorization|cookie|token|privatekey|private_key|secret|service_role|bot_token|mnemonic|seed|proof|signature)([_-]|$)'
         or v_key ~* '(^|[_-])(ip|client_ip|remote_ip|ip_address|remote_addr|x_forwarded_for)([_-]|$)' then
        v_result := v_result || jsonb_build_object(v_key, '[REDACTED]');
      else
        v_result := v_result || jsonb_build_object(v_key, api._alert_sanitize_detail(v_value));
      end if;
    end loop;

    return v_result;
  end if;

  if v_type = 'array' then
    select coalesce(jsonb_agg(api._alert_sanitize_detail(value)), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(coalesce(p_detail, '[]'::jsonb)) as item(value);

    return coalesce(v_result, '[]'::jsonb);
  end if;

  if v_type = 'string' then
    v_string := p_detail #>> '{}';

    if length(v_string) > 2000 then
      return to_jsonb(left(v_string, 2000) || '...');
    end if;
  end if;

  return coalesce(p_detail, 'null'::jsonb);
end;
$function$;

create or replace function api.alert_record_event(
  p_alert_type text default null,
  p_severity text default null,
  p_title text default null,
  p_message text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_detail jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_alert_type text := lower(nullif(trim(coalesce(p_alert_type, '')), ''));
  v_severity text := lower(nullif(trim(coalesce(p_severity, '')), ''));
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_source_type text := lower(nullif(trim(coalesce(p_source_type, '')), ''));
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'alert.record_event';
  v_request_hash text;
  v_idempotent jsonb;
  v_sanitized_detail jsonb;
  v_detail jsonb;
  v_alert ops.alerts%rowtype;
  v_response jsonb;
begin
  if v_alert_type is null then
    raise exception 'ALERT_TYPE_REQUIRED' using errcode = 'P0001';
  end if;

  v_severity := coalesce(v_severity, 'warning');
  if v_severity not in ('info', 'warning', 'critical') then
    raise exception 'ALERT_SEVERITY_INVALID' using errcode = 'P0001';
  end if;

  if v_title is null then
    raise exception 'ALERT_TITLE_REQUIRED' using errcode = 'P0001';
  end if;

  if v_source_type is null then
    raise exception 'ALERT_SOURCE_TYPE_REQUIRED' using errcode = 'P0001';
  end if;

  if p_source_id is null then
    raise exception 'ALERT_SOURCE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_sanitized_detail := api._alert_sanitize_detail(coalesce(p_detail, '{}'::jsonb));
  v_detail := case
      when jsonb_typeof(v_sanitized_detail) = 'object' then v_sanitized_detail
      else jsonb_build_object('value', v_sanitized_detail)
    end
    || jsonb_build_object(
      'source_type', v_source_type,
      'source_id', p_source_id,
      'alert_type', v_alert_type,
      'severity', v_severity
    );

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'alert_type', v_alert_type,
    'severity', v_severity,
    'title', v_title,
    'message', v_message,
    'source_type', v_source_type,
    'source_id', p_source_id,
    'detail', v_detail
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  insert into ops.alerts (
    alert_type,
    severity,
    status,
    title,
    message,
    source_type,
    source_id,
    detail,
    occurrence_count,
    first_seen_at,
    last_seen_at,
    created_at,
    updated_at
  )
  values (
    v_alert_type,
    v_severity,
    'open',
    v_title,
    v_message,
    v_source_type,
    p_source_id,
    v_detail,
    1,
    v_now,
    v_now,
    v_now,
    v_now
  )
  on conflict (alert_type, source_type, source_id)
    where status in ('open', 'acknowledged')
  do update
  set severity = case
        when ops.alerts.severity = 'critical' or excluded.severity = 'critical' then 'critical'
        when ops.alerts.severity = 'warning' or excluded.severity = 'warning' then 'warning'
        else excluded.severity
      end,
      title = excluded.title,
      message = coalesce(excluded.message, ops.alerts.message),
      detail = ops.alerts.detail || excluded.detail || jsonb_build_object(
        'source_type', excluded.source_type,
        'source_id', excluded.source_id
      ),
      occurrence_count = ops.alerts.occurrence_count + 1,
      last_seen_at = v_now,
      updated_at = v_now
  returning * into v_alert;

  v_response := jsonb_build_object(
    'alert_id', v_alert.id,
    'status', v_alert.status,
    'severity', v_alert.severity,
    'source_type', v_alert.source_type,
    'source_id', v_alert.source_id,
    'occurrence_count', v_alert.occurrence_count,
    'server_time', v_now,
    'idempotent', false
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$function$;

create or replace function api.admin_list_alerts(
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'last_seen_at'::text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_sort text := lower(nullif(trim(coalesce(p_sort, '')), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_severity text := nullif(trim(v_filters ->> 'severity'), '');
  v_alert_type text := nullif(trim(v_filters ->> 'alertType'), '');
  v_source_type text := nullif(trim(v_filters ->> 'sourceType'), '');
  v_source_id uuid := nullif(trim(v_filters ->> 'sourceId'), '')::uuid;
  v_from timestamptz := nullif(trim(v_filters ->> 'from'), '')::timestamptz;
  v_to timestamptz := nullif(trim(v_filters ->> 'to'), '')::timestamptz;
  v_statuses text[];
  v_rows jsonb;
  v_total_count integer;
begin
  if v_sort is null then
    v_sort := 'last_seen_at';
  end if;

  if v_sort not in ('severity', 'created_at', 'last_seen_at') then
    raise exception 'ADMIN_ALERT_SORT_INVALID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_filters -> 'statuses') = 'array' then
    select array_agg(status_value)
    into v_statuses
    from (
      select lower(nullif(trim(value), '')) as status_value
      from jsonb_array_elements_text(v_filters -> 'statuses') as statuses(value)
    ) normalized
    where status_value is not null;
  elsif nullif(trim(v_filters ->> 'status'), '') is not null
        and lower(nullif(trim(v_filters ->> 'status'), '')) <> 'all' then
    v_statuses := array[lower(nullif(trim(v_filters ->> 'status'), ''))];
  end if;

  if v_statuses is not null
     and exists (
       select 1
       from unnest(v_statuses) as status_value(value)
       where value not in ('open', 'acknowledged', 'resolved', 'ignored')
     ) then
    raise exception 'ADMIN_ALERT_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_severity is not null and v_severity not in ('info', 'warning', 'critical') then
    raise exception 'ADMIN_ALERT_SEVERITY_INVALID' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_total_count
  from ops.alerts a
  where (v_statuses is null or a.status = any (v_statuses))
    and (v_severity is null or a.severity = v_severity)
    and (v_alert_type is null or a.alert_type = v_alert_type)
    and (v_source_type is null or a.source_type = v_source_type)
    and (v_source_id is null or a.source_id = v_source_id)
    and (v_from is null or a.created_at >= v_from)
    and (v_to is null or a.created_at <= v_to);

  select coalesce(jsonb_agg(to_jsonb(page_rows) - 'sort_index' order by page_rows.sort_index), '[]'::jsonb)
  into v_rows
  from (
    select
      row_number() over () as sort_index,
      ordered.id,
      ordered.alert_type,
      ordered.severity,
      ordered.status,
      ordered.title,
      ordered.message,
      ordered.source_type,
      ordered.source_id,
      ordered.detail,
      ordered.occurrence_count,
      ordered.first_seen_at,
      ordered.last_seen_at,
      ordered.acknowledged_by_admin_id,
      ordered.acknowledged_at,
      ordered.resolved_by_admin_id,
      ordered.resolved_at,
      ordered.ignored_by_admin_id,
      ordered.ignored_at,
      ordered.status_reason,
      ordered.resolution_result,
      ordered.created_at,
      ordered.updated_at
    from (
      select *
      from ops.alerts a
      where (v_statuses is null or a.status = any (v_statuses))
        and (v_severity is null or a.severity = v_severity)
        and (v_alert_type is null or a.alert_type = v_alert_type)
        and (v_source_type is null or a.source_type = v_source_type)
        and (v_source_id is null or a.source_id = v_source_id)
        and (v_from is null or a.created_at >= v_from)
        and (v_to is null or a.created_at <= v_to)
      order by
        case
          when v_sort = 'severity' then
            case a.severity
              when 'critical' then 1
              when 'warning' then 2
              when 'info' then 3
              else 4
            end
          else 0
        end asc,
        case when v_sort = 'last_seen_at' then a.last_seen_at end desc,
        case when v_sort = 'created_at' then a.created_at end desc,
        a.created_at desc,
        a.id desc
      limit v_limit + 1
      offset v_offset
    ) ordered
  ) page_rows;

  return jsonb_build_object(
    'total_count', coalesce(v_total_count, 0),
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$function$;

create or replace function api.admin_update_alert_status(
  p_admin_user_id uuid,
  p_alert_id uuid,
  p_status text,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_resolution_result text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin ops.admin_users%rowtype;
  v_alert ops.alerts%rowtype;
  v_updated ops.alerts%rowtype;
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_resolution_result text := nullif(trim(coalesce(p_resolution_result, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.update_alert_status';
  v_action text;
  v_request_hash text;
  v_idempotent jsonb;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['ops:write', 'admin:write', 'risk:write']);

  if p_alert_id is null then
    raise exception 'ADMIN_ALERT_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status not in ('acknowledged', 'resolved', 'ignored') then
    raise exception 'ADMIN_ALERT_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status = 'resolved' and v_resolution_result is null then
    raise exception 'ADMIN_ALERT_RESOLUTION_RESULT_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'alert_id', p_alert_id,
    'status', v_status,
    'reason', v_reason,
    'resolution_result', v_resolution_result
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_alert
  from ops.alerts
  where id = p_alert_id
  for update;

  if not found then
    raise exception 'ADMIN_ALERT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_alert.status in ('resolved', 'ignored') then
    raise exception 'ADMIN_ALERT_NOT_OPEN' using errcode = 'P0001';
  end if;

  if v_status = 'acknowledged' and v_alert.status <> 'open' then
    raise exception 'ADMIN_ALERT_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_alert);

  update ops.alerts
  set status = v_status,
      status_reason = v_reason,
      resolution_result = case
        when v_status = 'resolved' then v_resolution_result
        else resolution_result
      end,
      acknowledged_by_admin_id = case
        when v_status = 'acknowledged' then v_admin.id
        else acknowledged_by_admin_id
      end,
      acknowledged_at = case
        when v_status = 'acknowledged' then v_now
        else acknowledged_at
      end,
      resolved_by_admin_id = case
        when v_status = 'resolved' then v_admin.id
        else resolved_by_admin_id
      end,
      resolved_at = case
        when v_status = 'resolved' then v_now
        else resolved_at
      end,
      ignored_by_admin_id = case
        when v_status = 'ignored' then v_admin.id
        else ignored_by_admin_id
      end,
      ignored_at = case
        when v_status = 'ignored' then v_now
        else ignored_at
      end,
      updated_at = v_now
  where id = p_alert_id
  returning * into v_updated;

  v_after := to_jsonb(v_updated);
  v_action := case v_status
    when 'acknowledged' then 'alert.acknowledge'
    when 'resolved' then 'alert.resolve'
    when 'ignored' then 'alert.ignore'
  end;

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    v_action,
    'ops',
    'alerts',
    p_alert_id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'alert_id', p_alert_id,
    'status', v_updated.status,
    'previous_status', v_alert.status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'server_time', v_now,
    'idempotent', false
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$function$;

revoke all on function api._alert_sanitize_detail(jsonb) from public, anon, authenticated;

revoke all on function api.alert_record_event(
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text
) from public, anon, authenticated;

revoke all on function api.admin_list_alerts(jsonb, text, integer, integer)
from public, anon, authenticated;

revoke all on function api.admin_update_alert_status(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated;

grant execute on function api.alert_record_event(
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text
) to service_role;

grant execute on function api.admin_list_alerts(jsonb, text, integer, integer)
to service_role;

grant execute on function api.admin_update_alert_status(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  text
) to service_role;

comment on function api.alert_record_event(
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text
) is
  'Service-role alert recording RPC. Sanitizes detail and stores source_type/source_id in detail.';

comment on function api.admin_list_alerts(jsonb, text, integer, integer) is
  'Service-role alert list RPC for admin APIs.';

comment on function api.admin_update_alert_status(uuid, uuid, text, text, text, jsonb, text) is
  'Audited admin alert lifecycle transition RPC for acknowledged/resolved/ignored statuses.';
