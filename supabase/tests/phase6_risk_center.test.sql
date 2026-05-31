-- Phase 6 step 2.7 risk center RPC tests.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

create or replace function testutil.raises_like(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm like p_pattern;
end;
$$;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

select ok(
  to_regprocedure('api.risk_record_event(uuid,text,text,text,uuid,integer,jsonb,text)') is not null
    and to_regprocedure('api.admin_resolve_risk_event(uuid,uuid,text,text,text,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_apply_user_flag(uuid,uuid,text,text,text,timestamp with time zone,text,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_clear_user_flag(uuid,uuid,uuid,text,text,text,jsonb)') is not null,
  'risk center RPCs exist with expected signatures'
);

select ok(
  (
    select bool_and(
      has_function_privilege('service_role', signature, 'EXECUTE')
      and not has_function_privilege('public', signature, 'EXECUTE')
      and not has_function_privilege('anon', signature, 'EXECUTE')
      and not has_function_privilege('authenticated', signature, 'EXECUTE')
    )
    from (
      values
        ('api.risk_record_event(uuid,text,text,text,uuid,integer,jsonb,text)'::regprocedure),
        ('api.admin_resolve_risk_event(uuid,uuid,text,text,text,jsonb,jsonb)'::regprocedure),
        ('api.admin_apply_user_flag(uuid,uuid,text,text,text,timestamp with time zone,text,jsonb,jsonb)'::regprocedure),
        ('api.admin_clear_user_flag(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure)
    ) as f(signature)
  ),
  'risk center RPCs are service_role-only'
);

select ok(
  (
    select value ?& array[
      'payment_duplicate_webhook',
      'payment_paid_not_fulfilled',
      'payment_disputed',
      'gacha_high_frequency',
      'gacha_stock_mismatch',
      'gacha_fulfillment_mismatch',
      'market_self_trade',
      'market_price_manipulation',
      'market_abnormal_cancel_rate',
      'referral_abuse',
      'referral_self_loop',
      'referral_multi_account',
      'multi_account_wallet',
      'wallet_proof_replay',
      'wallet_sync_stuck',
      'mint_retry_exceeded',
      'mint_confirmed_queue_not_minted',
      'ledger_balance_mismatch',
      'negative_balance_detected'
    ]
    from ops.system_settings
    where key = 'risk.event_types'
  ),
  'stable risk event type constants are seeded'
);

select is(
  (
    select count(*)::int
    from unnest(array[
      'gacha_blocked',
      'market_buy_blocked',
      'market_sell_blocked',
      'task_reward_blocked',
      'mint_blocked',
      'kcoin_frozen',
      'fgems_frozen',
      'support_review_required'
    ]) as required(flag_code)
    where api._risk_user_flag_allowed(required.flag_code)
  ),
  8,
  'all required user flag codes are whitelisted'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'core'
      and tablename = 'user_flags'
      and indexname = 'user_flags_active_code_unique_idx'
  ),
  'user flags have active-only uniqueness for user/code'
);

select ok(
  exists (
    select 1
    from ops.admin_roles
    where code = 'SUPPORT'
      and permissions ? 'risk:read'
      and not permissions ? 'risk:write'
  ),
  'default SUPPORT role can read risk but cannot write risk'
);

select ok(
  exists (
    select 1
    from ops.system_settings
    where key = 'risk.score_thresholds'
      and value ->> 'enabled' = 'true'
      and value ->> 'auto_apply_enabled' = 'false'
      and jsonb_typeof(value -> 'thresholds') = 'array'
  ),
  'risk score thresholds are seeded with config-controlled auto apply'
);

insert into core.users (id, telegram_user_id, first_name, status)
values
  ('11111111-1000-4000-8000-000000000001'::uuid, 610001, 'risk-user-one', 'active'),
  ('11111111-1000-4000-8000-000000000002'::uuid, 610002, 'risk-user-two', 'active')
on conflict (id) do update
set telegram_user_id = excluded.telegram_user_id,
    first_name = excluded.first_name,
    status = excluded.status;

insert into ops.admin_users (id, email, display_name, status)
values
  ('aaaaaaaa-2000-4000-8000-000000000001'::uuid, 'phase6-risk-write@example.invalid', 'phase6 risk writer', 'active'),
  ('aaaaaaaa-2000-4000-8000-000000000002'::uuid, 'phase6-risk-readonly@example.invalid', 'phase6 risk readonly', 'active'),
  ('aaaaaaaa-2000-4000-8000-000000000003'::uuid, 'phase6-admin-write@example.invalid', 'phase6 admin writer', 'active')
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status;

insert into ops.admin_roles (code, display_name, permissions)
values
  ('PHASE6_RISK_CENTER_WRITE', 'Phase 6 Risk Center Write', '["risk:write"]'::jsonb),
  ('PHASE6_RISK_CENTER_READONLY', 'Phase 6 Risk Center Readonly', '["risk:read"]'::jsonb),
  ('PHASE6_RISK_CENTER_ADMIN_WRITE', 'Phase 6 Risk Center Admin Write', '["admin:write"]'::jsonb)
on conflict (code) do update
set display_name = excluded.display_name,
    permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-2000-4000-8000-000000000001'::uuid, id
from ops.admin_roles
where code = 'PHASE6_RISK_CENTER_WRITE'
on conflict do nothing;

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-2000-4000-8000-000000000002'::uuid, id
from ops.admin_roles
where code = 'PHASE6_RISK_CENTER_READONLY'
on conflict do nothing;

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-2000-4000-8000-000000000003'::uuid, id
from ops.admin_roles
where code = 'PHASE6_RISK_CENTER_ADMIN_WRITE'
on conflict do nothing;

insert into _ids (key, payload)
select
  'risk_record_first',
  api.risk_record_event(
    p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
    p_event_type => 'payment_paid_not_fulfilled',
    p_source_type => 'payment_order',
    p_source_id => 'bbbbbbbb-2000-4000-8000-000000000001'::uuid,
    p_detail => '{"test":"risk_record_first"}'::jsonb,
    p_idempotency_key => 'phase6-risk-record-first'
  );

select is(
  (select payload ->> 'severity' from _ids where key = 'risk_record_first'),
  'high',
  'risk_record_event applies default severity from event type'
);

select is(
  (select payload ->> 'score_delta' from _ids where key = 'risk_record_first'),
  '30',
  'risk_record_event applies default score_delta from event type'
);

select is(
  (
    select risk_score::text
    from core.users
    where id = '11111111-1000-4000-8000-000000000001'::uuid
  ),
  '30',
  'risk_record_event updates user risk_score'
);

insert into _ids (key, payload)
select
  'risk_record_replay',
  api.risk_record_event(
    p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
    p_event_type => 'payment_paid_not_fulfilled',
    p_source_type => 'payment_order',
    p_source_id => 'bbbbbbbb-2000-4000-8000-000000000001'::uuid,
    p_detail => '{"test":"risk_record_first"}'::jsonb,
    p_idempotency_key => 'phase6-risk-record-first'
  );

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'risk_record_replay'))::boolean
    and (select payload ->> 'risk_event_id' from _ids where key = 'risk_record_replay')
      = (select payload ->> 'risk_event_id' from _ids where key = 'risk_record_first'),
  'risk_record_event replays completed idempotency key without another risk event'
);

insert into _ids (key, payload)
select
  'risk_record_second',
  api.risk_record_event(
    p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
    p_event_type => 'gacha_high_frequency',
    p_source_type => 'gacha_order',
    p_source_id => 'bbbbbbbb-2000-4000-8000-000000000002'::uuid,
    p_detail => '{"test":"risk_record_second"}'::jsonb
  );

select is(
  (select payload ->> 'score_delta' from _ids where key = 'risk_record_second'),
  '15',
  'same user recent events increase score_delta'
);

insert into _ids (key, payload)
select
  'risk_record_threshold_suggestion',
  api.risk_record_event(
    p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
    p_event_type => 'negative_balance_detected',
    p_source_type => 'ledger',
    p_source_id => 'bbbbbbbb-2000-4000-8000-000000000003'::uuid,
    p_detail => '{"test":"risk_record_threshold_suggestion"}'::jsonb,
    p_idempotency_key => 'phase6-risk-record-threshold-suggestion'
  );

select ok(
  (select payload -> 'flag_suggestion' ->> 'flag_code' from _ids where key = 'risk_record_threshold_suggestion')
    = 'support_review_required'
    and (select payload -> 'flag_suggestion' ->> 'auto_apply_enabled' from _ids where key = 'risk_record_threshold_suggestion')
      = 'false',
  'risk_record_event suggests a user flag after score threshold without auto-applying by default'
);

select ok(
  testutil.raises_like(
    $$
      select api.risk_record_event(
        p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
        p_event_type => 'unknown_risk_type'
      )
    $$,
    '%RISK_EVENT_TYPE_INVALID%'
  ),
  'risk_record_event rejects unknown event type'
);

select ok(
  testutil.raises_like(
    format(
      $$
        select api.admin_resolve_risk_event(
          p_admin_user_id => %L::uuid,
          p_risk_event_id => %L::uuid,
          p_status => 'ignored',
          p_reason => 'readonly cannot resolve risk events',
          p_idempotency_key => 'phase6-risk-resolve-readonly',
          p_request_context => '{"request_id":"phase6-risk-resolve-readonly"}'::jsonb,
          p_resolution_detail => '{}'::jsonb
        )
      $$,
      'aaaaaaaa-2000-4000-8000-000000000002',
      (select payload ->> 'risk_event_id' from _ids where key = 'risk_record_first')
    ),
    '%ADMIN_PERMISSION_DENIED%'
  ),
  'SUPPORT/read-only admin without risk:write cannot resolve risk events'
);

insert into _ids (key, payload)
select
  'resolve_reviewing',
  api.admin_resolve_risk_event(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_risk_event_id => (select (payload ->> 'risk_event_id')::uuid from _ids where key = 'risk_record_first'),
    p_status => 'reviewing',
    p_reason => 'start manual risk review',
    p_idempotency_key => 'phase6-risk-resolve-reviewing',
    p_request_context => '{"request_id":"phase6-risk-resolve-reviewing"}'::jsonb,
    p_resolution_detail => '{}'::jsonb
  );

select ok(
  exists (
    select 1
    from ops.risk_events
    where id = (select (payload ->> 'risk_event_id')::uuid from _ids where key = 'risk_record_first')
      and status = 'reviewing'
      and resolved_at is null
      and resolved_by_admin_id is null
  ),
  'risk:write admin can move open risk event to reviewing without resolved fields'
);

insert into _ids (key, payload)
select
  'resolve_fixed',
  api.admin_resolve_risk_event(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_risk_event_id => (select (payload ->> 'risk_event_id')::uuid from _ids where key = 'risk_record_first'),
    p_status => 'fixed',
    p_reason => 'risk finding fixed in pgTAP',
    p_idempotency_key => 'phase6-risk-resolve-fixed',
    p_request_context => '{"request_id":"phase6-risk-resolve-fixed"}'::jsonb,
    p_resolution_detail => '{"fix_method":"pgTAP"}'::jsonb
  );

select ok(
  exists (
    select 1
    from ops.risk_events
    where id = (select (payload ->> 'risk_event_id')::uuid from _ids where key = 'risk_record_first')
      and status = 'fixed'
      and resolved_by_admin_id = 'aaaaaaaa-2000-4000-8000-000000000001'::uuid
      and resolved_at is not null
  ),
  'risk terminal resolution sets resolved fields'
);

insert into _ids (key, payload)
select
  'resolve_fixed_replay',
  api.admin_resolve_risk_event(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_risk_event_id => (select (payload ->> 'risk_event_id')::uuid from _ids where key = 'risk_record_first'),
    p_status => 'fixed',
    p_reason => 'risk finding fixed in pgTAP',
    p_idempotency_key => 'phase6-risk-resolve-fixed',
    p_request_context => '{"request_id":"phase6-risk-resolve-fixed"}'::jsonb,
    p_resolution_detail => '{"fix_method":"pgTAP"}'::jsonb
  );

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'resolve_fixed_replay'))::boolean,
  'admin_resolve_risk_event replays completed idempotency key'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'risk.resolve_event'
      and target_id = (select (payload ->> 'risk_event_id')::uuid from _ids where key = 'risk_record_first')
  ),
  2,
  'resolve replay does not duplicate audit logs'
);

insert into _ids (key, payload)
select
  'resolve_resolved_status',
  api.admin_resolve_risk_event(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_risk_event_id => (select (payload ->> 'risk_event_id')::uuid from _ids where key = 'risk_record_second'),
    p_status => 'resolved',
    p_reason => 'risk center accepts resolved status',
    p_idempotency_key => 'phase6-risk-resolve-resolved-status',
    p_request_context => '{"request_id":"phase6-risk-resolve-resolved-status"}'::jsonb,
    p_resolution_detail => '{}'::jsonb
  );

select is(
  (select payload ->> 'status' from _ids where key = 'resolve_resolved_status'),
  'resolved',
  'admin_resolve_risk_event allows resolved status'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_apply_user_flag(
        p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
        p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
        p_flag_code => 'not_allowed',
        p_reason => 'invalid flag should fail',
        p_idempotency_key => 'phase6-risk-flag-invalid-code'
      )
    $$,
    '%ADMIN_USER_FLAG_CODE_INVALID%'
  ),
  'admin_apply_user_flag rejects flag code outside whitelist'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_apply_user_flag(
        p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
        p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
        p_flag_code => 'gacha_blocked',
        p_reason => 'expired flag should fail',
        p_ends_at => now() - interval '1 minute',
        p_idempotency_key => 'phase6-risk-flag-past-end'
      )
    $$,
    '%ADMIN_USER_FLAG_ENDS_AT_INVALID%'
  ),
  'admin_apply_user_flag rejects past ends_at'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_apply_user_flag(
        p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000002'::uuid,
        p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
        p_flag_code => 'gacha_blocked',
        p_reason => 'readonly cannot apply flag',
        p_idempotency_key => 'phase6-risk-flag-readonly'
      )
    $$,
    '%ADMIN_PERMISSION_DENIED%'
  ),
  'SUPPORT/read-only admin without risk:write cannot apply flags'
);

insert into _ids (key, payload)
select
  'apply_gacha_blocked',
  api.admin_apply_user_flag(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
    p_flag_code => 'gacha_blocked',
    p_flag_level => 'restriction',
    p_reason => 'block gacha while reviewing risk',
    p_ends_at => now() + interval '1 day',
    p_idempotency_key => 'phase6-risk-flag-gacha-apply',
    p_request_context => '{"request_id":"phase6-risk-flag-gacha-apply"}'::jsonb,
    p_metadata => '{"test":"apply"}'::jsonb
  );

select ok(
  exists (
    select 1
    from core.user_flags
    where id = (select (payload ->> 'user_flag_id')::uuid from _ids where key = 'apply_gacha_blocked')
      and user_id = '11111111-1000-4000-8000-000000000001'::uuid
      and flag_code = 'gacha_blocked'
      and flag_level = 'restriction'
      and active
  ),
  'risk:write admin can apply whitelisted active user flag'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where action = 'risk.apply_user_flag'
      and target_schema = 'core'
      and target_table = 'user_flags'
      and target_id = (select (payload ->> 'user_flag_id')::uuid from _ids where key = 'apply_gacha_blocked')
  ),
  'apply user flag writes audit log'
);

insert into _ids (key, payload)
select
  'apply_gacha_replay',
  api.admin_apply_user_flag(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
    p_flag_code => 'gacha_blocked',
    p_flag_level => 'restriction',
    p_reason => 'block gacha while reviewing risk',
    p_ends_at => (select ends_at from core.user_flags where id = (select (payload ->> 'user_flag_id')::uuid from _ids where key = 'apply_gacha_blocked')),
    p_idempotency_key => 'phase6-risk-flag-gacha-apply',
    p_request_context => '{"request_id":"phase6-risk-flag-gacha-apply"}'::jsonb,
    p_metadata => '{"test":"apply"}'::jsonb
  );

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'apply_gacha_replay'))::boolean,
  'admin_apply_user_flag replays completed idempotency key'
);

insert into _ids (key, payload)
select
  'apply_gacha_update',
  api.admin_apply_user_flag(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000003'::uuid,
    p_user_id => '11111111-1000-4000-8000-000000000001'::uuid,
    p_flag_code => 'gacha_blocked',
    p_flag_level => 'warning',
    p_reason => 'downgrade restriction after review',
    p_ends_at => now() + interval '2 days',
    p_idempotency_key => 'phase6-risk-flag-gacha-update',
    p_request_context => '{"request_id":"phase6-risk-flag-gacha-update"}'::jsonb,
    p_metadata => '{"test":"update"}'::jsonb
  );

select ok(
  (select payload ->> 'user_flag_id' from _ids where key = 'apply_gacha_update')
    = (select payload ->> 'user_flag_id' from _ids where key = 'apply_gacha_blocked')
    and (
      select count(*)::int
      from core.user_flags
      where user_id = '11111111-1000-4000-8000-000000000001'::uuid
        and flag_code = 'gacha_blocked'
        and active
    ) = 1
    and (
      select flag_level
      from core.user_flags
      where id = (select (payload ->> 'user_flag_id')::uuid from _ids where key = 'apply_gacha_blocked')
    ) = 'warning',
  'active flag conflict updates the existing active flag'
);

insert into _ids (key, payload)
select
  'clear_gacha_by_id',
  api.admin_clear_user_flag(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_user_flag_id => (select (payload ->> 'user_flag_id')::uuid from _ids where key = 'apply_gacha_blocked'),
    p_reason => 'clear after risk review',
    p_idempotency_key => 'phase6-risk-flag-gacha-clear',
    p_request_context => '{"request_id":"phase6-risk-flag-gacha-clear"}'::jsonb
  );

select ok(
  exists (
    select 1
    from core.user_flags
    where id = (select (payload ->> 'user_flag_id')::uuid from _ids where key = 'clear_gacha_by_id')
      and not active
      and metadata ->> 'cleared_reason' = 'clear after risk review'
      and metadata ->> 'cleared_by_admin_id' = 'aaaaaaaa-2000-4000-8000-000000000001'
      and metadata ? 'cleared_at'
  ),
  'admin_clear_user_flag clears active flag and records clearing metadata'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where action = 'risk.clear_user_flag'
      and target_id = (select (payload ->> 'user_flag_id')::uuid from _ids where key = 'clear_gacha_by_id')
  ),
  'clear user flag writes audit log'
);

select ok(
  testutil.raises_like(
    format(
      $$
        select api.admin_clear_user_flag(
          p_admin_user_id => %L::uuid,
          p_user_flag_id => %L::uuid,
          p_reason => 'already inactive should fail',
          p_idempotency_key => 'phase6-risk-flag-gacha-clear-again'
        )
      $$,
      'aaaaaaaa-2000-4000-8000-000000000001',
      (select payload ->> 'user_flag_id' from _ids where key = 'clear_gacha_by_id')
    ),
    '%ADMIN_USER_FLAG_NOT_FOUND%'
  ),
  'admin_clear_user_flag rejects or does not find non-active flags'
);

insert into _ids (key, payload)
select
  'apply_market_buy',
  api.admin_apply_user_flag(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_user_id => '11111111-1000-4000-8000-000000000002'::uuid,
    p_flag_code => 'market_buy_blocked',
    p_flag_level => 'restriction',
    p_reason => 'block market buy during review',
    p_idempotency_key => 'phase6-risk-flag-market-buy-apply'
  );

insert into _ids (key, payload)
select
  'clear_market_buy_by_user_code',
  api.admin_clear_user_flag(
    p_admin_user_id => 'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
    p_user_id => '11111111-1000-4000-8000-000000000002'::uuid,
    p_flag_code => 'market_buy_blocked',
    p_reason => 'clear by user and flag code',
    p_idempotency_key => 'phase6-risk-flag-market-buy-clear'
  );

select ok(
  (select payload ->> 'user_flag_id' from _ids where key = 'apply_market_buy')
    = (select payload ->> 'user_flag_id' from _ids where key = 'clear_market_buy_by_user_code')
    and (
      select active
      from core.user_flags
      where id = (select (payload ->> 'user_flag_id')::uuid from _ids where key = 'apply_market_buy')
    ) = false,
  'admin_clear_user_flag supports user_id + flag_code target'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action in ('risk.resolve_event', 'risk.apply_user_flag', 'risk.clear_user_flag')
  ),
  8,
  'risk center write RPCs record expected audit entries without idempotent duplicates'
);

select * from finish();

rollback;
