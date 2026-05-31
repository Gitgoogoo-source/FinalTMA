-- Phase 6 refund context tracking.
-- This records internal refund workflow state only. Telegram Stars refunds are
-- executed through the approved external support flow, not by this RPC.

begin;

drop function if exists api.admin_create_refund_record(
  uuid, uuid, uuid, text, integer, text, text, jsonb, jsonb
);

create or replace function api.admin_create_refund_record(
  p_admin_user_id uuid,
  p_star_payment_id uuid,
  p_star_order_id uuid,
  p_reason text,
  p_xtr_amount integer,
  p_status text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb,
  p_refund_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_order payments.star_orders%rowtype;
  v_after_order payments.star_orders%rowtype;
  v_payment payments.star_payments%rowtype;
  v_refund payments.star_refunds%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.create_refund_record';
  v_request_hash text;
  v_idempotent jsonb;
  v_audit jsonb;
  v_response jsonb;
  v_raw_refund_context jsonb := coalesce(p_refund_context, '{}'::jsonb);
  v_refund_context jsonb;
  v_external_ticket_id text;
  v_asset_handling_strategy text;
  v_asset_handling_note text;
  v_risk_restriction_raw text;
  v_risk_restriction_required boolean := false;
  v_risk_restriction_reason text;
  v_external_refund_completed_raw text;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if jsonb_typeof(v_raw_refund_context) <> 'object' then
    raise exception 'ADMIN_REFUND_CONTEXT_INVALID' using errcode = 'P0001';
  end if;

  v_external_ticket_id := nullif(
    trim(
      coalesce(
        v_raw_refund_context ->> 'external_ticket_id',
        v_raw_refund_context ->> 'externalTicketId',
        ''
      )
    ),
    ''
  );
  v_asset_handling_strategy := lower(
    nullif(
      trim(
        coalesce(
          v_raw_refund_context ->> 'asset_handling_strategy',
          v_raw_refund_context ->> 'assetHandlingStrategy',
          'manual_review'
        )
      ),
      ''
    )
  );
  v_asset_handling_note := nullif(
    trim(
      coalesce(
        v_raw_refund_context ->> 'asset_handling_note',
        v_raw_refund_context ->> 'assetHandlingNote',
        ''
      )
    ),
    ''
  );
  v_risk_restriction_raw := lower(
    nullif(
      trim(
        coalesce(
          v_raw_refund_context ->> 'risk_restriction_required',
          v_raw_refund_context ->> 'riskRestrictionRequired',
          v_raw_refund_context ->> 'riskRestriction',
          'false'
        )
      ),
      ''
    )
  );
  v_risk_restriction_reason := nullif(
    trim(
      coalesce(
        v_raw_refund_context ->> 'risk_restriction_reason',
        v_raw_refund_context ->> 'riskRestrictionReason',
        ''
      )
    ),
    ''
  );
  v_external_refund_completed_raw := lower(
    nullif(
      trim(
        coalesce(
          v_raw_refund_context ->> 'external_refund_completed',
          v_raw_refund_context ->> 'externalRefundCompleted',
          'false'
        )
      ),
      ''
    )
  );

  if v_asset_handling_strategy = 'retain' then
    v_asset_handling_strategy := 'keep';
  elsif v_asset_handling_strategy = 'manual' then
    v_asset_handling_strategy := 'manual_review';
  end if;

  if v_external_ticket_id is not null and length(v_external_ticket_id) > 256 then
    raise exception 'ADMIN_REFUND_EXTERNAL_TICKET_INVALID' using errcode = 'P0001';
  end if;

  if v_asset_handling_strategy not in ('keep', 'freeze', 'reclaim', 'manual_review') then
    raise exception 'ADMIN_REFUND_ASSET_HANDLING_INVALID' using errcode = 'P0001';
  end if;

  if v_asset_handling_note is not null and length(v_asset_handling_note) > 1000 then
    raise exception 'ADMIN_REFUND_ASSET_HANDLING_NOTE_INVALID' using errcode = 'P0001';
  end if;

  if v_risk_restriction_raw is null then
    v_risk_restriction_raw := 'false';
  end if;

  if v_risk_restriction_raw not in ('true', 'false', '1', '0', 'yes', 'no', 'on', 'off') then
    raise exception 'ADMIN_REFUND_RISK_RESTRICTION_INVALID' using errcode = 'P0001';
  end if;

  v_risk_restriction_required := v_risk_restriction_raw in ('true', '1', 'yes', 'on');

  if v_risk_restriction_required and v_risk_restriction_reason is null then
    raise exception 'ADMIN_REFUND_RISK_RESTRICTION_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_risk_restriction_reason is not null and length(v_risk_restriction_reason) > 1000 then
    raise exception 'ADMIN_REFUND_RISK_RESTRICTION_REASON_INVALID' using errcode = 'P0001';
  end if;

  if v_external_refund_completed_raw not in ('false', '0', 'no', 'off') then
    raise exception 'ADMIN_EXTERNAL_REFUND_COMPLETION_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  v_refund_context := jsonb_build_object(
    'external_ticket_id', v_external_ticket_id,
    'asset_handling_strategy', v_asset_handling_strategy,
    'asset_handling_note', v_asset_handling_note,
    'risk_restriction_required', v_risk_restriction_required,
    'risk_restriction_reason', v_risk_restriction_reason,
    'external_refund_completed', false,
    'telegram_stars_refund_flow', 'external_support',
    'recorded_by_rpc', 'admin_create_refund_record'
  );

  if p_star_payment_id is null then
    raise exception 'ADMIN_PAYMENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_star_order_id is null then
    raise exception 'ADMIN_PAYMENT_ORDER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_xtr_amount is null or p_xtr_amount <= 0 then
    raise exception 'ADMIN_REFUND_AMOUNT_INVALID' using errcode = 'P0001';
  end if;

  if v_status is null or v_status not in ('requested', 'processing', 'completed', 'rejected', 'failed') then
    raise exception 'ADMIN_REFUND_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if api._admin_requires_approval(p_approval_context) then
    return api.admin_create_approval_request(
      p_admin_user_id => p_admin_user_id,
      p_action => 'payment.refund.create_record',
      p_target_schema => 'payments',
      p_target_table => 'star_orders',
      p_target_id => p_star_order_id,
      p_payload => jsonb_build_object(
        'rpc', 'admin_create_refund_record',
        'star_payment_id', p_star_payment_id,
        'star_order_id', p_star_order_id,
        'xtr_amount', p_xtr_amount,
        'status', v_status,
        'refund_context', v_refund_context,
        'request_context', coalesce(p_request_context, '{}'::jsonb),
        'idempotency_key', v_key
      ),
      p_reason => v_reason,
      p_idempotency_key => 'approval_request:' || v_key,
      p_request_context => p_request_context
    );
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'star_payment_id', p_star_payment_id,
    'star_order_id', p_star_order_id,
    'xtr_amount', p_xtr_amount,
    'status', v_status,
    'reason', v_reason,
    'refund_context', v_refund_context
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  if not found then
    raise exception 'ADMIN_PAYMENT_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_order.status not in ('paid', 'fulfilling', 'fulfilled', 'failed', 'refunded', 'disputed') then
    raise exception 'ADMIN_PAYMENT_REFUND_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  select *
  into v_payment
  from payments.star_payments
  where id = p_star_payment_id
  for update;

  if not found then
    raise exception 'ADMIN_PAYMENT_RECORD_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_payment.star_order_id <> p_star_order_id or v_payment.user_id <> v_order.user_id then
    raise exception 'ADMIN_PAYMENT_ORDER_MISMATCH' using errcode = 'P0001';
  end if;

  if p_xtr_amount > v_payment.xtr_amount then
    raise exception 'ADMIN_REFUND_AMOUNT_EXCEEDS_PAYMENT' using errcode = 'P0001';
  end if;

  if v_status in ('requested', 'processing', 'completed')
     and exists (
       select 1
       from payments.star_refunds sr
       where sr.star_order_id = p_star_order_id
         and sr.status in ('requested', 'processing', 'completed', 'approved', 'processed')
     ) then
    raise exception 'ADMIN_REFUND_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  v_before := jsonb_build_object(
    'star_order', to_jsonb(v_order),
    'star_payment', to_jsonb(v_payment),
    'existing_refunds', coalesce(
      (
        select jsonb_agg(to_jsonb(sr) order by sr.created_at)
        from payments.star_refunds sr
        where sr.star_order_id = p_star_order_id
      ),
      '[]'::jsonb
    )
  );

  insert into payments.star_refunds (
    star_payment_id,
    star_order_id,
    user_id,
    telegram_payment_charge_id,
    xtr_amount,
    status,
    reason,
    requested_by_admin_id,
    processed_at,
    metadata
  )
  values (
    v_payment.id,
    v_order.id,
    v_order.user_id,
    v_payment.telegram_payment_charge_id,
    p_xtr_amount,
    v_status,
    v_reason,
    p_admin_user_id,
    case when v_status in ('completed') then v_now else null end,
    jsonb_build_object(
      'idempotency_key', v_key,
      'request_context', coalesce(p_request_context, '{}'::jsonb),
      'approval_context', coalesce(p_approval_context, '{}'::jsonb),
      'refund_context', v_refund_context,
      'external_ticket_id', v_external_ticket_id,
      'asset_handling_strategy', v_asset_handling_strategy,
      'asset_handling_note', v_asset_handling_note,
      'risk_restriction_required', v_risk_restriction_required,
      'risk_restriction_reason', v_risk_restriction_reason,
      'external_refund_completed', false,
      'note', 'This RPC records internal refund state only. Telegram Stars refund execution must be completed through the approved external support flow.'
    )
  )
  returning * into v_refund;

  update payments.star_orders
  set status = case
        when v_status = 'completed' then 'refunded'
        else status
      end,
      metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{admin_refund}',
        jsonb_build_object(
          'star_refund_id', v_refund.id,
          'status', v_status,
          'xtr_amount', p_xtr_amount,
          'admin_user_id', p_admin_user_id,
          'idempotency_key', v_key,
          'refund_context', v_refund_context,
          'external_ticket_id', v_external_ticket_id,
          'asset_handling_strategy', v_asset_handling_strategy,
          'risk_restriction_required', v_risk_restriction_required,
          'external_refund_completed', false,
          'updated_at', v_now
        ),
        true
      ),
      updated_at = v_now
  where id = p_star_order_id
  returning * into v_after_order;

  insert into ops.risk_events (
    user_id,
    event_type,
    severity,
    status,
    source_type,
    source_id,
    detail
  )
  values (
    v_order.user_id,
    'admin_refund_record_created',
    case
      when v_risk_restriction_required then 'high'
      when v_status in ('completed') then 'high'
      else 'medium'
    end,
    'reviewing',
    'star_refund',
    v_refund.id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'star_order_id', p_star_order_id,
      'star_payment_id', p_star_payment_id,
      'xtr_amount', p_xtr_amount,
      'status', v_status,
      'reason', v_reason,
      'idempotency_key', v_key,
      'refund_context', v_refund_context,
      'external_ticket_id', v_external_ticket_id,
      'asset_handling_strategy', v_asset_handling_strategy,
      'risk_restriction_required', v_risk_restriction_required,
      'risk_restriction_reason', v_risk_restriction_reason,
      'external_refund_completed', false
    )
  );

  v_after := jsonb_build_object(
    'star_order', to_jsonb(v_after_order),
    'star_payment', to_jsonb(v_payment),
    'star_refund', to_jsonb(v_refund),
    'refund_context', v_refund_context
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'payment.refund.create_record',
    'payments',
    'star_refunds',
    v_refund.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'star_order_id', p_star_order_id,
    'star_payment_id', p_star_payment_id,
    'star_refund_id', v_refund.id,
    'status', v_refund.status,
    'order_status', v_after_order.status,
    'xtr_amount', v_refund.xtr_amount,
    'refund_context', v_refund_context,
    'external_ticket_id', v_external_ticket_id,
    'asset_handling_strategy', v_asset_handling_strategy,
    'risk_restriction_required', v_risk_restriction_required,
    'external_refund_completed', false,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function api.admin_create_refund_record(
  uuid, uuid, uuid, text, integer, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_create_refund_record(
  uuid, uuid, uuid, text, integer, text, text, jsonb, jsonb, jsonb
) to service_role;

comment on function api.admin_create_refund_record(
  uuid, uuid, uuid, text, integer, text, text, jsonb, jsonb, jsonb
) is 'Creates an internal Telegram Stars refund record with admin audit, idempotency and refund handling context. It does not execute an external Telegram refund.';

commit;
