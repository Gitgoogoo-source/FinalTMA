-- Phase 6 risk hardening: enforce risk/flag whitelists at table level and
-- make admin_resolve_risk_event update only the status column.

begin;

insert into ops.system_settings as s (key, value, description)
values (
  'risk.event_types',
  jsonb_build_object(
    'referral_self_invite', jsonb_build_object('category', 'referral', 'default_severity', 'medium', 'default_score_delta', 10),
    'referral_rebind_attempt', jsonb_build_object('category', 'referral', 'default_severity', 'medium', 'default_score_delta', 10),
    'gacha_fulfillment_star_order_missing', jsonb_build_object('category', 'gacha', 'default_severity', 'high', 'default_score_delta', 30),
    'gacha_fulfillment_duplicate_or_conflicting_charge', jsonb_build_object('category', 'gacha', 'default_severity', 'medium', 'default_score_delta', 10),
    'gacha_fulfillment_validation_failed', jsonb_build_object('category', 'gacha', 'default_severity', 'medium', 'default_score_delta', 10),
    'gacha_fulfillment_payment_insert_conflict', jsonb_build_object('category', 'gacha', 'default_severity', 'high', 'default_score_delta', 30),
    'gacha_fulfillment_failed', jsonb_build_object('category', 'gacha', 'default_severity', 'high', 'default_score_delta', 30),
    'admin_mint_retry', jsonb_build_object('category', 'mint', 'default_severity', 'medium', 'default_score_delta', 10),
    'admin_feature_flag_update', jsonb_build_object('category', 'admin', 'default_severity', 'medium', 'default_score_delta', 10),
    'admin_payment_fulfillment_retry', jsonb_build_object('category', 'payment', 'default_severity', 'medium', 'default_score_delta', 10),
    'admin_asset_compensation', jsonb_build_object('category', 'admin', 'default_severity', 'high', 'default_score_delta', 30),
    'admin_user_ban', jsonb_build_object('category', 'admin', 'default_severity', 'critical', 'default_score_delta', 100),
    'admin_star_refund_requested', jsonb_build_object('category', 'payment', 'default_severity', 'high', 'default_score_delta', 30),
    'admin_inventory_lock_released', jsonb_build_object('category', 'inventory', 'default_severity', 'high', 'default_score_delta', 30),
    'admin_drop_pool_published', jsonb_build_object('category', 'gacha', 'default_severity', 'high', 'default_score_delta', 30),
    'cron_box_activation_blocked', jsonb_build_object('category', 'gacha', 'default_severity', 'medium', 'default_score_delta', 10),
    'admin_refund_record_created', jsonb_build_object('category', 'payment', 'default_severity', 'medium', 'default_score_delta', 10),
    'admin_payment_dispute_resolved', jsonb_build_object('category', 'payment', 'default_severity', 'medium', 'default_score_delta', 10),
    'admin_payment_support_config_update', jsonb_build_object('category', 'payment', 'default_severity', 'low', 'default_score_delta', 0),
    'onchain_nft_owner_mismatch', jsonb_build_object('category', 'wallet', 'default_severity', 'medium', 'default_score_delta', 10),
    'wallet_nft_owner_mismatch', jsonb_build_object('category', 'wallet', 'default_severity', 'medium', 'default_score_delta', 10)
  ),
  'Phase 6 risk center: stable risk event type defaults, including direct internal risk_events writers protected by table constraints.'
)
on conflict (key) do update
set value = coalesce(s.value, '{}'::jsonb) || excluded.value,
    description = excluded.description,
    updated_at = now();

alter table ops.risk_events
  drop constraint if exists risk_events_event_type_check;

alter table ops.risk_events
  add constraint risk_events_event_type_check
  check (
    event_type in (
      'admin_asset_compensation',
      'admin_drop_pool_published',
      'admin_feature_flag_update',
      'admin_inventory_lock_released',
      'admin_mint_retry',
      'admin_payment_dispute_resolved',
      'admin_payment_fulfillment_retry',
      'admin_payment_support_config_update',
      'admin_refund_record_created',
      'admin_star_refund_requested',
      'admin_user_ban',
      'cron_box_activation_blocked',
      'gacha_fulfillment_duplicate_or_conflicting_charge',
      'gacha_fulfillment_failed',
      'gacha_fulfillment_mismatch',
      'gacha_fulfillment_payment_insert_conflict',
      'gacha_fulfillment_star_order_missing',
      'gacha_fulfillment_validation_failed',
      'gacha_high_frequency',
      'gacha_stock_mismatch',
      'ledger_balance_mismatch',
      'market_abnormal_cancel_rate',
      'market_price_manipulation',
      'market_self_trade',
      'mint_confirmed_queue_not_minted',
      'mint_retry_exceeded',
      'multi_account_wallet',
      'negative_balance_detected',
      'onchain_nft_owner_mismatch',
      'payment_disputed',
      'payment_duplicate_webhook',
      'payment_paid_not_fulfilled',
      'referral_abuse',
      'referral_multi_account',
      'referral_rebind_attempt',
      'referral_self_invite',
      'referral_self_loop',
      'wallet_nft_owner_mismatch',
      'wallet_proof_replay',
      'wallet_sync_stuck'
    )
  );

comment on constraint risk_events_event_type_check on ops.risk_events is
  'Rejects direct table writes with event_type outside the canonical risk event whitelist.';

alter table core.user_flags
  drop constraint if exists user_flags_flag_code_check;

alter table core.user_flags
  add constraint user_flags_flag_code_check
  check (
    flag_code in (
      'admin_ban',
      'admin_restriction',
      'fgems_frozen',
      'gacha_blocked',
      'kcoin_frozen',
      'market_buy_blocked',
      'market_sell_blocked',
      'mint_blocked',
      'support_review_required',
      'task_reward_blocked'
    )
  );

comment on constraint user_flags_flag_code_check on core.user_flags is
  'Rejects direct table writes with flag_code outside the canonical user flag whitelist.';

create or replace function api.admin_resolve_risk_event(
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
  v_event ops.risk_events%rowtype;
  v_updated ops.risk_events%rowtype;
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.resolve_risk_event';
  v_request_hash text;
  v_idempotent jsonb;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['risk:write', 'admin:write']);

  if p_risk_event_id is null then
    raise exception 'ADMIN_RISK_EVENT_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status is null or v_status not in (
    'reviewing',
    'ignored',
    'fixed',
    'false_positive',
    'escalated',
    'resolved'
  ) then
    raise exception 'ADMIN_RISK_EVENT_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'risk_event_id', p_risk_event_id,
    'status', v_status,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_event
  from ops.risk_events
  where id = p_risk_event_id
  for update;

  if not found then
    raise exception 'ADMIN_RISK_EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_event.status not in ('open', 'reviewing') then
    raise exception 'ADMIN_RISK_EVENT_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_event);

  update ops.risk_events
  set status = v_status
  where id = p_risk_event_id
  returning * into v_updated;

  v_after := to_jsonb(v_updated);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'risk.resolve_event',
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
    'previous_status', v_event.status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'resolved_at', v_updated.resolved_at,
    'server_time', v_now,
    'idempotent', false
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$$;

revoke all on function api.admin_resolve_risk_event(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function api.admin_resolve_risk_event(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) to service_role;

comment on function api.admin_resolve_risk_event(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb
) is
  'Phase 6 risk center: audited/idempotent admin status transition for risk events; only ops.risk_events.status is updated.';

commit;
