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
    when 'user.compensate' then
      v_result := api.admin_compensate_user(
        p_admin_user_id => p_admin_user_id,
        p_target_user_id => nullif(v_payload ->> 'target_user_id', '')::uuid,
        p_compensation_type => v_payload ->> 'compensation_type',
        p_currency_code => nullif(v_payload ->> 'currency_code', ''),
        p_amount => nullif(v_payload ->> 'amount', '')::numeric,
        p_item_template_id => nullif(v_payload ->> 'item_template_id', '')::uuid,
        p_reason => v_before.reason,
        p_idempotency_key => concat('execute:', v_before.operation_idempotency_key),
        p_request_context =>
          (coalesce(v_payload -> 'request_context', '{}'::jsonb) - 'approval_context')
          || coalesce(p_request_context, '{}'::jsonb)
          || jsonb_build_object('approval_context', v_approval_context)
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
        p_drop_pool_version_id => nullif(v_payload ->> 'drop_pool_version_id', '')::uuid,
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

revoke all on function api.admin_execute_approval_request(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_execute_approval_request(
  uuid, uuid, text, jsonb
) to service_role;

comment on function api.admin_execute_approval_request(
  uuid, uuid, text, jsonb
) is
  'Executes approved admin operations, including phase 6 user/support compensation requests.';
