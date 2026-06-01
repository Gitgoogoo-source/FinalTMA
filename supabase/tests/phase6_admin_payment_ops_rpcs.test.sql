-- Phase 6 admin payment operations RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(25);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;
create temp table _errors (key text primary key, message text) on commit drop;

insert into _ids (key, id)
values
  ('actor', gen_random_uuid()),
  ('payment_user', gen_random_uuid()),
  ('star_order_processing', gen_random_uuid()),
  ('star_payment_processing', gen_random_uuid()),
  ('star_order_completed', gen_random_uuid()),
  ('star_payment_completed', gen_random_uuid()),
  ('star_order_fulfilled', gen_random_uuid()),
  ('star_payment_fulfilled', gen_random_uuid()),
  ('star_order_retry_failed', gen_random_uuid()),
  ('star_payment_retry_failed', gen_random_uuid()),
  ('fulfilled_box', gen_random_uuid()),
  ('fulfilled_pool_version', gen_random_uuid()),
  ('fulfilled_template', gen_random_uuid()),
  ('fulfilled_item_instance', gen_random_uuid()),
  ('fulfilled_draw_order', gen_random_uuid()),
  ('dispute', gen_random_uuid());

insert into ops.admin_users (id, email, display_name, status, metadata)
values (
  (select id from _ids where key = 'actor'),
  'phase6-payment-ops-admin@example.test',
  'Phase 6 Payment Ops Admin',
  'active',
  '{"test":true}'::jsonb
);

insert into core.users (id, telegram_user_id, username, first_name, status)
values (
  (select id from _ids where key = 'payment_user'),
  880061001,
  'phase6_payment_ops_user',
  'Phase6 Payment Ops',
  'active'
);

insert into catalog.collectible_templates (
  id,
  slug,
  display_name,
  rarity_code,
  type_code,
  release_status
)
values (
  (select id from _ids where key = 'fulfilled_template'),
  'phase6-payment-ops-fulfilled-template',
  'Phase 6 Payment Ops Fulfilled Template',
  'COMMON',
  'CHARACTER',
  'active'
);

insert into gacha.blind_boxes (
  id,
  slug,
  display_name,
  tier,
  status,
  price_stars
)
values (
  (select id from _ids where key = 'fulfilled_box'),
  'phase6-payment-ops-fulfilled-box',
  'Phase 6 Payment Ops Fulfilled Box',
  'normal',
  'active',
  6
);

insert into gacha.drop_pool_versions (
  id,
  box_id,
  version_no,
  status,
  total_weight,
  published_at
)
values (
  (select id from _ids where key = 'fulfilled_pool_version'),
  (select id from _ids where key = 'fulfilled_box'),
  1,
  'active',
  1,
  now()
);

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  idempotency_key,
  paid_at
)
values
  (
    (select id from _ids where key = 'star_order_processing'),
    (select id from _ids where key = 'payment_user'),
    'gacha_open',
    'paid',
    10,
    'phase6-payment-ops-processing-payload',
    'Phase 6 processing refund',
    'phase6-payment-ops-processing-order',
    now()
  ),
  (
    (select id from _ids where key = 'star_order_completed'),
    (select id from _ids where key = 'payment_user'),
    'gacha_open',
    'paid',
    8,
    'phase6-payment-ops-completed-payload',
    'Phase 6 completed refund',
    'phase6-payment-ops-completed-order',
    now()
  ),
  (
    (select id from _ids where key = 'star_order_fulfilled'),
    (select id from _ids where key = 'payment_user'),
    'gacha_open',
    'fulfilled',
    6,
    'phase6-payment-ops-fulfilled-payload',
    'Phase 6 fulfilled retry',
    'phase6-payment-ops-fulfilled-order',
    now()
  ),
  (
    (select id from _ids where key = 'star_order_retry_failed'),
    (select id from _ids where key = 'payment_user'),
    'gacha_open',
    'paid',
    9,
    'phase6-payment-ops-retry-failed-payload',
    'Phase 6 failed retry backoff',
    'phase6-payment-ops-retry-failed-order',
    now()
  );

insert into payments.star_payments (
  id,
  star_order_id,
  user_id,
  telegram_payment_charge_id,
  xtr_amount,
  currency,
  invoice_payload
)
values
  (
    (select id from _ids where key = 'star_payment_processing'),
    (select id from _ids where key = 'star_order_processing'),
    (select id from _ids where key = 'payment_user'),
    'phase6-payment-ops-charge-processing',
    10,
    'XTR',
    'phase6-payment-ops-processing-payload'
  ),
  (
    (select id from _ids where key = 'star_payment_completed'),
    (select id from _ids where key = 'star_order_completed'),
    (select id from _ids where key = 'payment_user'),
    'phase6-payment-ops-charge-completed',
    8,
    'XTR',
    'phase6-payment-ops-completed-payload'
  ),
  (
    (select id from _ids where key = 'star_payment_fulfilled'),
    (select id from _ids where key = 'star_order_fulfilled'),
    (select id from _ids where key = 'payment_user'),
    'phase6-payment-ops-charge-fulfilled',
    6,
    'XTR',
    'phase6-payment-ops-fulfilled-payload'
  ),
  (
    (select id from _ids where key = 'star_payment_retry_failed'),
    (select id from _ids where key = 'star_order_retry_failed'),
    (select id from _ids where key = 'payment_user'),
    'phase6-payment-ops-charge-retry-failed',
    9,
    'XTR',
    'phase6-payment-ops-retry-failed-payload'
  );

insert into inventory.item_instances (
  id,
  owner_user_id,
  template_id,
  level,
  power,
  status,
  source_type,
  source_id
)
values (
  (select id from _ids where key = 'fulfilled_item_instance'),
  (select id from _ids where key = 'payment_user'),
  (select id from _ids where key = 'fulfilled_template'),
  1,
  10,
  'available',
  'gacha',
  (select id from _ids where key = 'fulfilled_draw_order')
);

insert into gacha.draw_orders (
  id,
  user_id,
  box_id,
  pool_version_id,
  payment_star_order_id,
  status,
  quantity,
  draw_count,
  unit_price_stars,
  total_price_stars,
  invoice_payload,
  telegram_invoice_payload,
  idempotency_key,
  payment_status,
  paid_at,
  opened_at
)
values (
  (select id from _ids where key = 'fulfilled_draw_order'),
  (select id from _ids where key = 'payment_user'),
  (select id from _ids where key = 'fulfilled_box'),
  (select id from _ids where key = 'fulfilled_pool_version'),
  (select id from _ids where key = 'star_order_fulfilled'),
  'completed',
  1,
  1,
  6,
  6,
  'phase6-payment-ops-fulfilled-payload',
  'phase6-payment-ops-fulfilled-payload',
  'phase6-payment-ops-fulfilled-draw-order',
  'paid',
  now(),
  now()
);

insert into gacha.draw_results (
  draw_order_id,
  user_id,
  box_id,
  pool_version_id,
  draw_index,
  item_instance_id,
  template_id,
  rarity_code
)
values (
  (select id from _ids where key = 'fulfilled_draw_order'),
  (select id from _ids where key = 'payment_user'),
  (select id from _ids where key = 'fulfilled_box'),
  (select id from _ids where key = 'fulfilled_pool_version'),
  1,
  (select id from _ids where key = 'fulfilled_item_instance'),
  (select id from _ids where key = 'fulfilled_template'),
  'COMMON'
);

insert into payments.payment_disputes (
  id,
  user_id,
  star_order_id,
  star_payment_id,
  status,
  subject,
  message
)
values (
  (select id from _ids where key = 'dispute'),
  (select id from _ids where key = 'payment_user'),
  (select id from _ids where key = 'star_order_processing'),
  (select id from _ids where key = 'star_payment_processing'),
  'investigating',
  'Phase 6 dispute',
  'Payment fulfillment needs review'
);

select ok(
  to_regprocedure('api.admin_create_refund_record(uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_resolve_payment_dispute(uuid,uuid,text,text,text,text,jsonb,jsonb)') is not null,
  'phase 6 admin payment operation RPCs exist'
);

with signatures(signature) as (
  values
    ('api.admin_create_refund_record(uuid,uuid,uuid,text,integer,text,text,jsonb,jsonb,jsonb)'),
    ('api.admin_resolve_payment_dispute(uuid,uuid,text,text,text,text,jsonb,jsonb)')
)
select ok(
  not exists (
    select 1
    from signatures
    where not has_function_privilege('service_role', signature, 'EXECUTE')
       or has_function_privilege('public', signature, 'EXECUTE')
       or has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  'phase 6 admin payment operation RPCs are service_role only'
);

insert into _ids (key, payload)
values (
  'fulfilled_retry',
  api.admin_retry_payment_fulfillment(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_order_id => (select id from _ids where key = 'star_order_fulfilled'),
    p_reason => 'phase 6 fulfilled retry idempotent test',
    p_idempotency_key => 'phase6-payment-ops-fulfilled-retry-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

insert into _ids (key, payload)
values (
  'fulfilled_retry_second_key',
  api.admin_retry_payment_fulfillment(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_order_id => (select id from _ids where key = 'star_order_fulfilled'),
    p_reason => 'phase 6 fulfilled retry idempotent test second key',
    p_idempotency_key => 'phase6-payment-ops-fulfilled-retry-002',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'fulfilled_retry'))::boolean
    and ((select payload ->> 'fulfilled' from _ids where key = 'fulfilled_retry'))::boolean,
  'admin_retry_payment_fulfillment returns idempotent success for fulfilled orders'
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'fulfilled_retry_second_key'))::boolean,
  'admin_retry_payment_fulfillment returns idempotent success for later fulfilled retries'
);

select is(
  (
    select count(*)::int
    from gacha.draw_results
    where draw_order_id = (select id from _ids where key = 'fulfilled_draw_order')
  ),
  1,
  'fulfilled payment retries do not duplicate draw_results'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'actor')
      and action = 'payment.fulfillment.retry'
      and target_schema = 'payments'
      and target_table = 'star_orders'
      and target_id = (select id from _ids where key = 'star_order_fulfilled')
  ),
  2,
  'fulfilled payment retries write audit logs for each idempotent admin action'
);

select is(
  (
    select count(*)::int
    from ops.risk_events
    where event_type = 'admin_payment_fulfillment_retry'
      and source_type = 'star_order'
      and source_id = (select id from _ids where key = 'star_order_fulfilled')
      and (detail ->> 'idempotent')::boolean
  ),
  2,
  'fulfilled payment retries write risk events for each idempotent admin action'
);

insert into _ids (key, payload)
values (
  'failed_retry_backoff',
  api.admin_retry_payment_fulfillment(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_order_id => (select id from _ids where key = 'star_order_retry_failed'),
    p_reason => 'phase 6 retry backoff failed fulfillment test',
    p_idempotency_key => 'phase6-payment-ops-retry-backoff-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'retryable' from _ids where key = 'failed_retry_backoff'))::boolean
    and ((select payload ->> 'retry_count' from _ids where key = 'failed_retry_backoff'))::integer = 1
    and (select payload ->> 'next_retry_at' from _ids where key = 'failed_retry_backoff') is not null,
  'failed payment retry response includes due backoff state'
);

select ok(
  exists (
    select 1
    from payments.star_orders
    where id = (select id from _ids where key = 'star_order_retry_failed')
      and retry_count = 1
      and next_retry_at is not null
      and retry_exhausted_at is null
  ),
  'failed payment retry persists order-level backoff state'
);

insert into _ids (key, payload)
values (
  'refund_processing',
  api.admin_create_refund_record(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_payment_id => (select id from _ids where key = 'star_payment_processing'),
    p_star_order_id => (select id from _ids where key = 'star_order_processing'),
    p_reason => 'phase 6 processing refund record test',
    p_xtr_amount => 5,
    p_status => 'processing',
    p_idempotency_key => 'phase6-payment-ops-refund-processing-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb,
    p_refund_context => jsonb_build_object(
      'external_ticket_id', 'TG-STARS-TICKET-123',
      'asset_handling_strategy', 'freeze',
      'asset_handling_note', 'freeze delivered items until support completes',
      'risk_restriction_required', true,
      'risk_restriction_reason', 'refund pending external support'
    )
  )
);

select is(
  (select payload ->> 'status' from _ids where key = 'refund_processing'),
  'processing',
  'admin_create_refund_record returns the requested internal status'
);

select ok(
  exists (
    select 1
    from payments.star_refunds
    where star_payment_id = (select id from _ids where key = 'star_payment_processing')
      and star_order_id = (select id from _ids where key = 'star_order_processing')
      and xtr_amount = 5
      and status = 'processing'
  ),
  'admin_create_refund_record inserts a matching refund row'
);

select is(
  (
    select metadata #>> '{admin_refund,external_refund_completed}'
    from payments.star_orders
    where id = (select id from _ids where key = 'star_order_processing')
  ),
  'false',
  'refund record marks external refund completion as false'
);

select is(
  (
    select metadata #>> '{refund_context,external_ticket_id}'
    from payments.star_refunds
    where star_payment_id = (select id from _ids where key = 'star_payment_processing')
  ),
  'TG-STARS-TICKET-123',
  'refund record stores the external support ticket id in metadata'
);

select is(
  (
    select metadata #>> '{refund_context,asset_handling_strategy}'
    from payments.star_refunds
    where star_payment_id = (select id from _ids where key = 'star_payment_processing')
  ),
  'freeze',
  'refund record stores the delivered asset handling strategy'
);

select ok(
  (
    select (metadata #>> '{admin_refund,risk_restriction_required}')::boolean
    from payments.star_orders
    where id = (select id from _ids where key = 'star_order_processing')
  ),
  'refund order metadata records that risk restriction is required'
);

select is(
  (
    select detail #>> '{refund_context,asset_handling_strategy}'
    from ops.risk_events
    where source_type = 'star_refund'
      and source_id = (
        select id
        from payments.star_refunds
        where star_payment_id = (select id from _ids where key = 'star_payment_processing')
      )
  ),
  'freeze',
  'refund risk event includes the asset handling strategy'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'actor')
      and action = 'payment.refund.create_record'
      and target_schema = 'payments'
      and target_table = 'star_refunds'
      and reason = 'phase 6 processing refund record test'
  ),
  1,
  'admin_create_refund_record writes one audit log'
);

insert into _ids (key, payload)
values (
  'refund_processing_repeat',
  api.admin_create_refund_record(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_payment_id => (select id from _ids where key = 'star_payment_processing'),
    p_star_order_id => (select id from _ids where key = 'star_order_processing'),
    p_reason => 'phase 6 processing refund record test',
    p_xtr_amount => 5,
    p_status => 'processing',
    p_idempotency_key => 'phase6-payment-ops-refund-processing-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb,
    p_refund_context => jsonb_build_object(
      'external_ticket_id', 'TG-STARS-TICKET-123',
      'asset_handling_strategy', 'freeze',
      'asset_handling_note', 'freeze delivered items until support completes',
      'risk_restriction_required', true,
      'risk_restriction_reason', 'refund pending external support'
    )
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'refund_processing_repeat'))::boolean,
  'admin_create_refund_record returns idempotent repeat'
);

insert into _ids (key, payload)
values (
  'refund_completed',
  api.admin_create_refund_record(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_payment_id => (select id from _ids where key = 'star_payment_completed'),
    p_star_order_id => (select id from _ids where key = 'star_order_completed'),
    p_reason => 'phase 6 completed refund record test',
    p_xtr_amount => 8,
    p_status => 'completed',
    p_idempotency_key => 'phase6-payment-ops-refund-completed-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select is(
  (
    select status
    from payments.star_orders
    where id = (select id from _ids where key = 'star_order_completed')
  ),
  'refunded',
  'completed internal refund records mark the order refunded'
);

insert into _ids (key, payload)
values (
  'dispute_resolved',
  api.admin_resolve_payment_dispute(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_dispute_id => (select id from _ids where key = 'dispute'),
    p_resolution => 'fulfillment retried and refund workflow opened',
    p_status => 'resolved',
    p_reason => 'phase 6 resolve dispute test',
    p_idempotency_key => 'phase6-payment-ops-dispute-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select is(
  (select payload ->> 'status' from _ids where key = 'dispute_resolved'),
  'resolved',
  'admin_resolve_payment_dispute returns the resolved status'
);

select ok(
  exists (
    select 1
    from payments.payment_disputes
    where id = (select id from _ids where key = 'dispute')
      and status = 'resolved'
      and resolution = 'fulfillment retried and refund workflow opened'
      and resolved_by_admin_id = (select id from _ids where key = 'actor')
      and resolved_at is not null
  ),
  'admin_resolve_payment_dispute updates dispute resolution fields'
);

select is(
  (
    select status
    from payments.star_orders
    where id = (select id from _ids where key = 'star_order_processing')
  ),
  'disputed',
  'admin_resolve_payment_dispute marks the related order disputed'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'actor')
      and action = 'payment.dispute.resolve'
      and target_schema = 'payments'
      and target_table = 'payment_disputes'
      and target_id = (select id from _ids where key = 'dispute')
      and reason = 'phase 6 resolve dispute test'
  ),
  1,
  'admin_resolve_payment_dispute writes one audit log'
);

insert into _ids (key, payload)
values (
  'dispute_resolved_repeat',
  api.admin_resolve_payment_dispute(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_dispute_id => (select id from _ids where key = 'dispute'),
    p_resolution => 'fulfillment retried and refund workflow opened',
    p_status => 'resolved',
    p_reason => 'phase 6 resolve dispute test',
    p_idempotency_key => 'phase6-payment-ops-dispute-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'dispute_resolved_repeat'))::boolean,
  'admin_resolve_payment_dispute returns idempotent repeat'
);

do $$
begin
  perform api.admin_create_refund_record(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_payment_id => (select id from _ids where key = 'star_payment_completed'),
    p_star_order_id => (select id from _ids where key = 'star_order_completed'),
    p_reason => 'phase 6 invalid amount refund test',
    p_xtr_amount => 0,
    p_status => 'requested',
    p_idempotency_key => 'phase6-payment-ops-invalid-refund-001',
    p_request_context => '{}'::jsonb,
    p_approval_context => '{}'::jsonb
  );
  insert into _errors (key, message) values ('invalid_refund_amount', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('invalid_refund_amount', sqlerrm);
end;
$$;

select ok(
  (select message from _errors where key = 'invalid_refund_amount') like '%ADMIN_REFUND_AMOUNT_INVALID%',
  'admin_create_refund_record rejects invalid refund amounts'
);

select * from finish();

rollback;
