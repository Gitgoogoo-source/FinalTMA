-- Phase 6 admin approval requests.
-- Adds a persisted two-person review state machine for high-risk admin RPCs.

create table if not exists ops.admin_approval_requests (
  id uuid primary key default gen_random_uuid(),
  requester_admin_user_id uuid not null references ops.admin_users(id) on delete restrict,
  approver_admin_user_id uuid references ops.admin_users(id) on delete restrict,
  executed_by_admin_user_id uuid references ops.admin_users(id) on delete restrict,
  action text not null,
  target_schema text,
  target_table text,
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  operation_idempotency_key text not null,
  status text not null default 'pending_approval' check (
    status in ('pending_approval', 'approved', 'executed', 'rejected')
  ),
  reason text not null,
  review_reason text,
  request_audit_log_id uuid references ops.admin_audit_logs(id) on delete set null,
  review_audit_log_id uuid references ops.admin_audit_logs(id) on delete set null,
  execute_audit_log_id uuid references ops.admin_audit_logs(id) on delete set null,
  execution_result jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  executed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (reviewed_at is null or approver_admin_user_id is not null),
  check (executed_at is null or executed_by_admin_user_id is not null),
  check (approver_admin_user_id is null or approver_admin_user_id <> requester_admin_user_id)
);

comment on table ops.admin_approval_requests is
  'Two-person review queue for high-risk admin operations. Business writes happen only after approval and execution.';

create unique index if not exists admin_approval_requests_operation_key_uidx
  on ops.admin_approval_requests (operation_idempotency_key);

create index if not exists admin_approval_requests_status_created_idx
  on ops.admin_approval_requests (status, created_at desc);

create index if not exists admin_approval_requests_requester_created_idx
  on ops.admin_approval_requests (requester_admin_user_id, created_at desc);

create index if not exists admin_approval_requests_approver_created_idx
  on ops.admin_approval_requests (approver_admin_user_id, created_at desc)
  where approver_admin_user_id is not null;

alter table ops.admin_approval_requests enable row level security;

revoke all on table ops.admin_approval_requests from public, anon, authenticated;
grant select, insert, update on table ops.admin_approval_requests to service_role;

create or replace function api._admin_requires_approval(
  p_approval_context jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := coalesce(p_approval_context, '{}'::jsonb);
  v_requires text;
  v_status text;
begin
  if jsonb_typeof(v_context) <> 'object' then
    return false;
  end if;

  v_requires := lower(coalesce(
    v_context ->> 'requires_approval',
    v_context ->> 'requiresApproval',
    ''
  ));
  v_status := lower(coalesce(
    v_context ->> 'approval_status',
    v_context ->> 'approvalStatus',
    ''
  ));

  return v_requires in ('true', '1', 'yes', 'required')
    or v_status in ('pending_approval', 'required');
end;
$$;

create or replace function api.admin_create_approval_request(
  p_admin_user_id uuid,
  p_action text,
  p_target_schema text,
  p_target_table text,
  p_target_id uuid,
  p_payload jsonb,
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
  v_admin ops.admin_users%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_action text := nullif(trim(coalesce(p_action, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_operation_key text;
  v_scope text := 'admin.approval.request';
  v_request_hash text;
  v_idempotent jsonb;
  v_now timestamptz := now();
  v_request ops.admin_approval_requests%rowtype;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if v_action is null then
    raise exception 'ADMIN_APPROVAL_ACTION_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'ADMIN_APPROVAL_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_operation_key := nullif(trim(coalesce(v_payload ->> 'idempotency_key', '')), '');
  if v_operation_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_action,
    'requester_admin_user_id', p_admin_user_id,
    'target_schema', nullif(trim(coalesce(p_target_schema, '')), ''),
    'target_table', nullif(trim(coalesce(p_target_table, '')), ''),
    'target_id', p_target_id,
    'payload', v_payload,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  insert into ops.admin_approval_requests (
    requester_admin_user_id,
    action,
    target_schema,
    target_table,
    target_id,
    payload,
    operation_idempotency_key,
    status,
    reason,
    updated_at
  )
  values (
    p_admin_user_id,
    v_action,
    nullif(trim(coalesce(p_target_schema, '')), ''),
    nullif(trim(coalesce(p_target_table, '')), ''),
    p_target_id,
    v_payload,
    v_operation_key,
    'pending_approval',
    v_reason,
    v_now
  )
  returning * into v_request;

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'approval.request',
    'ops',
    'admin_approval_requests',
    v_request.id,
    '{}'::jsonb,
    to_jsonb(v_request),
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  update ops.admin_approval_requests
  set request_audit_log_id = nullif(v_audit ->> 'audit_log_id', '')::uuid,
      updated_at = v_now
  where id = v_request.id
  returning * into v_request;

  v_response := jsonb_build_object(
    'approval_request_id', v_request.id,
    'status', v_request.status,
    'action', v_request.action,
    'target_schema', v_request.target_schema,
    'target_table', v_request.target_table,
    'target_id', v_request.target_id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_review_approval_request(
  p_admin_user_id uuid,
  p_approval_request_id uuid,
  p_decision text,
  p_review_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_before ops.admin_approval_requests%rowtype;
  v_after ops.admin_approval_requests%rowtype;
  v_decision text := lower(nullif(trim(coalesce(p_decision, '')), ''));
  v_review_reason text := nullif(trim(coalesce(p_review_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_scope text := 'admin.approval.review';
  v_request_hash text;
  v_idempotent jsonb;
  v_now timestamptz := now();
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_approval_request_id is null then
    raise exception 'ADMIN_APPROVAL_REQUEST_REQUIRED' using errcode = 'P0001';
  end if;

  if v_decision in ('approve', 'approved') then
    v_decision := 'approved';
  elsif v_decision in ('reject', 'rejected') then
    v_decision := 'rejected';
  else
    raise exception 'ADMIN_APPROVAL_DECISION_INVALID' using errcode = 'P0001';
  end if;

  if v_review_reason is null then
    raise exception 'ADMIN_APPROVAL_REVIEW_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'approval_request_id', p_approval_request_id,
    'reviewer_admin_user_id', p_admin_user_id,
    'decision', v_decision,
    'review_reason', v_review_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_before
  from ops.admin_approval_requests
  where id = p_approval_request_id
  for update;

  if not found then
    raise exception 'ADMIN_APPROVAL_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_before.requester_admin_user_id = p_admin_user_id then
    raise exception 'ADMIN_APPROVER_SELF_REVIEW_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if v_before.status <> 'pending_approval' then
    raise exception 'ADMIN_APPROVAL_STATUS_INVALID' using errcode = 'P0001';
  end if;

  update ops.admin_approval_requests
  set approver_admin_user_id = p_admin_user_id,
      status = v_decision,
      review_reason = v_review_reason,
      reviewed_at = v_now,
      updated_at = v_now
  where id = p_approval_request_id
  returning * into v_after;

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    case when v_decision = 'approved' then 'approval.approve' else 'approval.reject' end,
    'ops',
    'admin_approval_requests',
    v_after.id,
    to_jsonb(v_before),
    to_jsonb(v_after),
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_review_reason
  );

  update ops.admin_approval_requests
  set review_audit_log_id = nullif(v_audit ->> 'audit_log_id', '')::uuid,
      updated_at = v_now
  where id = v_after.id
  returning * into v_after;

  v_response := jsonb_build_object(
    'approval_request_id', v_after.id,
    'status', v_after.status,
    'action', v_after.action,
    'approver_admin_user_id', v_after.approver_admin_user_id,
    'reviewed_at', v_after.reviewed_at,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

alter function api.admin_compensate_asset(
  uuid, uuid, text, numeric, text, text, jsonb, jsonb, jsonb
) rename to _admin_execute_compensate_asset;

alter function api.admin_ban_user(
  uuid, uuid, text, text, text, jsonb, jsonb
) rename to _admin_execute_ban_user;

alter function api.admin_request_star_refund(
  uuid, uuid, text, text, jsonb, jsonb
) rename to _admin_execute_request_star_refund;

alter function api.admin_release_inventory_lock(
  uuid, uuid, text, text, jsonb, jsonb
) rename to _admin_execute_release_inventory_lock;

alter function api.admin_publish_drop_pool_version(
  uuid, uuid, jsonb, text, text, jsonb, jsonb
) rename to _admin_execute_publish_drop_pool_version;

create or replace function api.admin_execute_approval_request(
  p_admin_user_id uuid,
  p_approval_request_id uuid,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_before ops.admin_approval_requests%rowtype;
  v_after ops.admin_approval_requests%rowtype;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_scope text := 'admin.approval.execute';
  v_request_hash text;
  v_idempotent jsonb;
  v_now timestamptz := now();
  v_approval_context jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_approval_request_id is null then
    raise exception 'ADMIN_APPROVAL_REQUEST_REQUIRED' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_before
  from ops.admin_approval_requests
  where id = p_approval_request_id
  for update;

  if not found then
    raise exception 'ADMIN_APPROVAL_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_before.status = 'executed' and v_before.execution_result is not null then
    return v_before.execution_result || jsonb_build_object('idempotent', true);
  end if;

  if v_before.status <> 'approved' then
    raise exception 'ADMIN_APPROVAL_NOT_APPROVED' using errcode = 'P0001';
  end if;

  if v_before.approver_admin_user_id is null then
    raise exception 'ADMIN_APPROVER_REQUIRED' using errcode = 'P0001';
  end if;

  if v_before.approver_admin_user_id <> p_admin_user_id then
    raise exception 'ADMIN_APPROVAL_EXECUTOR_MUST_BE_APPROVER' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'approval_request_id', p_approval_request_id,
    'executor_admin_user_id', p_admin_user_id,
    'action', v_before.action,
    'operation_idempotency_key', v_before.operation_idempotency_key
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  v_payload := coalesce(v_before.payload, '{}'::jsonb);
  v_approval_context := jsonb_build_object(
    'approvalStatus', 'approved',
    'approvalRequestId', v_before.id,
    'requestedByAdminId', v_before.requester_admin_user_id,
    'approvedByAdminId', v_before.approver_admin_user_id,
    'executedByAdminId', p_admin_user_id,
    'reviewReason', v_before.review_reason,
    'originalRequestContext', coalesce(v_payload -> 'request_context', '{}'::jsonb)
  );

  case v_before.action
    when 'asset.compensate' then
      v_result := api._admin_execute_compensate_asset(
        p_admin_user_id => p_admin_user_id,
        p_user_id => nullif(v_payload ->> 'user_id', '')::uuid,
        p_currency_code => v_payload ->> 'currency_code',
        p_amount => nullif(v_payload ->> 'amount', '')::numeric,
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_metadata => coalesce(v_payload -> 'metadata', '{}'::jsonb),
        p_approval_context => v_approval_context
      );
    when 'user.ban' then
      v_result := api._admin_execute_ban_user(
        p_admin_user_id => p_admin_user_id,
        p_user_id => nullif(v_payload ->> 'user_id', '')::uuid,
        p_status => v_payload ->> 'status',
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_approval_context => v_approval_context
      );
    when 'payment.refund.request' then
      v_result := api._admin_execute_request_star_refund(
        p_admin_user_id => p_admin_user_id,
        p_star_order_id => nullif(v_payload ->> 'star_order_id', '')::uuid,
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_approval_context => v_approval_context
      );
    when 'inventory.lock.release' then
      v_result := api._admin_execute_release_inventory_lock(
        p_admin_user_id => p_admin_user_id,
        p_lock_id => nullif(v_payload ->> 'lock_id', '')::uuid,
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_approval_context => v_approval_context
      );
    when 'gacha.drop_pool.publish' then
      v_result := api._admin_execute_publish_drop_pool_version(
        p_admin_user_id => p_admin_user_id,
        p_box_id => nullif(v_payload ->> 'box_id', '')::uuid,
        p_items => coalesce(v_payload -> 'items', '[]'::jsonb),
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_approval_context => v_approval_context
      );
    else
      raise exception 'ADMIN_APPROVAL_ACTION_UNSUPPORTED' using errcode = 'P0001';
  end case;

  update ops.admin_approval_requests
  set status = 'executed',
      executed_by_admin_user_id = p_admin_user_id,
      executed_at = v_now,
      execution_result = v_result,
      updated_at = v_now
  where id = v_before.id
  returning * into v_after;

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'approval.execute',
    'ops',
    'admin_approval_requests',
    v_after.id,
    to_jsonb(v_before),
    to_jsonb(v_after) || jsonb_build_object('business_result', v_result),
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    coalesce(v_before.review_reason, v_before.reason)
  );

  update ops.admin_approval_requests
  set execute_audit_log_id = nullif(v_audit ->> 'audit_log_id', '')::uuid,
      updated_at = v_now
  where id = v_after.id
  returning * into v_after;

  v_response := jsonb_build_object(
    'approval_request_id', v_after.id,
    'status', v_after.status,
    'action', v_after.action,
    'business_result', v_result,
    'business_audit_log_id', v_result ->> 'audit_log_id',
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  update ops.admin_approval_requests
  set execution_result = v_response,
      updated_at = v_now
  where id = v_after.id;

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_compensate_asset(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_currency_code text,
  p_amount numeric,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if api._admin_requires_approval(p_approval_context) then
    return api.admin_create_approval_request(
      p_admin_user_id => p_admin_user_id,
      p_action => 'asset.compensate',
      p_target_schema => 'core',
      p_target_table => 'users',
      p_target_id => p_user_id,
      p_payload => jsonb_build_object(
        'rpc', 'admin_compensate_asset',
        'user_id', p_user_id,
        'currency_code', p_currency_code,
        'amount', p_amount,
        'metadata', coalesce(p_metadata, '{}'::jsonb),
        'request_context', coalesce(p_request_context, '{}'::jsonb),
        'idempotency_key', p_idempotency_key
      ),
      p_reason => p_reason,
      p_idempotency_key => 'approval_request:' || nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_request_context => p_request_context
    );
  end if;

  return api._admin_execute_compensate_asset(
    p_admin_user_id,
    p_user_id,
    p_currency_code,
    p_amount,
    p_reason,
    p_idempotency_key,
    p_request_context,
    p_metadata,
    p_approval_context
  );
end;
$$;

create or replace function api.admin_ban_user(
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
begin
  if api._admin_requires_approval(p_approval_context) then
    return api.admin_create_approval_request(
      p_admin_user_id => p_admin_user_id,
      p_action => 'user.ban',
      p_target_schema => 'core',
      p_target_table => 'users',
      p_target_id => p_user_id,
      p_payload => jsonb_build_object(
        'rpc', 'admin_ban_user',
        'user_id', p_user_id,
        'status', p_status,
        'request_context', coalesce(p_request_context, '{}'::jsonb),
        'idempotency_key', p_idempotency_key
      ),
      p_reason => p_reason,
      p_idempotency_key => 'approval_request:' || nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_request_context => p_request_context
    );
  end if;

  return api._admin_execute_ban_user(
    p_admin_user_id,
    p_user_id,
    p_status,
    p_reason,
    p_idempotency_key,
    p_request_context,
    p_approval_context
  );
end;
$$;

create or replace function api.admin_request_star_refund(
  p_admin_user_id uuid,
  p_star_order_id uuid,
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
begin
  if api._admin_requires_approval(p_approval_context) then
    return api.admin_create_approval_request(
      p_admin_user_id => p_admin_user_id,
      p_action => 'payment.refund.request',
      p_target_schema => 'payments',
      p_target_table => 'star_orders',
      p_target_id => p_star_order_id,
      p_payload => jsonb_build_object(
        'rpc', 'admin_request_star_refund',
        'star_order_id', p_star_order_id,
        'request_context', coalesce(p_request_context, '{}'::jsonb),
        'idempotency_key', p_idempotency_key
      ),
      p_reason => p_reason,
      p_idempotency_key => 'approval_request:' || nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_request_context => p_request_context
    );
  end if;

  return api._admin_execute_request_star_refund(
    p_admin_user_id,
    p_star_order_id,
    p_reason,
    p_idempotency_key,
    p_request_context,
    p_approval_context
  );
end;
$$;

create or replace function api.admin_release_inventory_lock(
  p_admin_user_id uuid,
  p_lock_id uuid,
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
begin
  if api._admin_requires_approval(p_approval_context) then
    return api.admin_create_approval_request(
      p_admin_user_id => p_admin_user_id,
      p_action => 'inventory.lock.release',
      p_target_schema => 'inventory',
      p_target_table => 'inventory_locks',
      p_target_id => p_lock_id,
      p_payload => jsonb_build_object(
        'rpc', 'admin_release_inventory_lock',
        'lock_id', p_lock_id,
        'request_context', coalesce(p_request_context, '{}'::jsonb),
        'idempotency_key', p_idempotency_key
      ),
      p_reason => p_reason,
      p_idempotency_key => 'approval_request:' || nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_request_context => p_request_context
    );
  end if;

  return api._admin_execute_release_inventory_lock(
    p_admin_user_id,
    p_lock_id,
    p_reason,
    p_idempotency_key,
    p_request_context,
    p_approval_context
  );
end;
$$;

create or replace function api.admin_publish_drop_pool_version(
  p_admin_user_id uuid,
  p_box_id uuid,
  p_items jsonb,
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
begin
  if api._admin_requires_approval(p_approval_context) then
    return api.admin_create_approval_request(
      p_admin_user_id => p_admin_user_id,
      p_action => 'gacha.drop_pool.publish',
      p_target_schema => 'gacha',
      p_target_table => 'blind_boxes',
      p_target_id => p_box_id,
      p_payload => jsonb_build_object(
        'rpc', 'admin_publish_drop_pool_version',
        'box_id', p_box_id,
        'items', coalesce(p_items, '[]'::jsonb),
        'request_context', coalesce(p_request_context, '{}'::jsonb),
        'idempotency_key', p_idempotency_key
      ),
      p_reason => p_reason,
      p_idempotency_key => 'approval_request:' || nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_request_context => p_request_context
    );
  end if;

  return api._admin_execute_publish_drop_pool_version(
    p_admin_user_id,
    p_box_id,
    p_items,
    p_reason,
    p_idempotency_key,
    p_request_context,
    p_approval_context
  );
end;
$$;

revoke all on function api._admin_requires_approval(jsonb) from public, anon, authenticated;
revoke all on function api.admin_create_approval_request(uuid, text, text, text, uuid, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_review_approval_request(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_execute_approval_request(uuid, uuid, text, jsonb) from public, anon, authenticated;

revoke all on function api._admin_execute_compensate_asset(uuid, uuid, text, numeric, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api._admin_execute_ban_user(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api._admin_execute_request_star_refund(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api._admin_execute_release_inventory_lock(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api._admin_execute_publish_drop_pool_version(uuid, uuid, jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;

revoke all on function api.admin_compensate_asset(uuid, uuid, text, numeric, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_ban_user(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_request_star_refund(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_release_inventory_lock(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_publish_drop_pool_version(uuid, uuid, jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;

grant execute on function api._admin_requires_approval(jsonb) to service_role;
grant execute on function api.admin_create_approval_request(uuid, text, text, text, uuid, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_review_approval_request(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function api.admin_execute_approval_request(uuid, uuid, text, jsonb) to service_role;

grant execute on function api._admin_execute_compensate_asset(uuid, uuid, text, numeric, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function api._admin_execute_ban_user(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
grant execute on function api._admin_execute_request_star_refund(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function api._admin_execute_release_inventory_lock(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function api._admin_execute_publish_drop_pool_version(uuid, uuid, jsonb, text, text, jsonb, jsonb) to service_role;

grant execute on function api.admin_compensate_asset(uuid, uuid, text, numeric, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function api.admin_ban_user(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
grant execute on function api.admin_request_star_refund(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function api.admin_release_inventory_lock(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function api.admin_publish_drop_pool_version(uuid, uuid, jsonb, text, text, jsonb, jsonb) to service_role;
