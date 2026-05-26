-- Phase 4 / 4.4 frontend-sensitive response field checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null,
  p_start_param text default null
)
returns uuid
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := api.auth_upsert_telegram_user(
    p_telegram_user_id := p_telegram_user_id,
    p_username := coalesce(p_username, 'u' || p_telegram_user_id::text),
    p_first_name := 'Test',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := p_start_param,
    p_metadata := jsonb_build_object(
      'risk_rule', 'internal-only',
      'request_context', jsonb_build_object('ip_hash', 'internal-ip-hash')
    )
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;

insert into _ids (key, id) values ('inviter', testutil.make_user(10440000001, 'phase4_sensitive_inviter', null));
insert into _ids (key, id) values ('invitee', testutil.make_user(10440000002, 'phase4_sensitive_invitee', null));

update core.users
set risk_score = 75,
    metadata = metadata || jsonb_build_object(
      'risk_score_reason', 'internal-only',
      'anti_abuse_bucket', 'internal-bucket'
    )
where id in (
  (select id from _ids where key = 'inviter'),
  (select id from _ids where key = 'invitee')
);

insert into _ids (key, txt)
select 'invite_code', invite_code
from core.users
where id = (select id from _ids where key = 'inviter');

insert into _ids (key, payload)
select
  'bind_response',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'invite_code'),
    'phase4-sensitive-bind-001',
    jsonb_build_object('request_context', 'internal-only')
  );

insert into _ids (key, payload)
select
  'bind_repeat_response',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'invite_code'),
    'phase4-sensitive-bind-001',
    jsonb_build_object('request_context', 'internal-only')
  );

insert into _ids (key, id)
select 'referral', id
from tasks.referrals
where invitee_user_id = (select id from _ids where key = 'invitee');

update tasks.referrals
set status = 'rewarded',
    qualified_at = now(),
    rewarded_at = now()
where id = (select id from _ids where key = 'referral');

insert into tasks.referral_commissions (
  referral_id,
  inviter_user_id,
  invitee_user_id,
  source_type,
  source_id,
  base_amount_kcoin,
  commission_bps,
  commission_amount_kcoin,
  status
) values (
  (select id from _ids where key = 'referral'),
  (select id from _ids where key = 'inviter'),
  (select id from _ids where key = 'invitee'),
  'gacha_open',
  gen_random_uuid(),
  100,
  1000,
  10,
  'pending'
);

insert into ops.risk_events (
  user_id,
  event_type,
  severity,
  source_type,
  detail
) values (
  (select id from _ids where key = 'invitee'),
  'phase4_sensitive_response_test',
  'high',
  'test',
  jsonb_build_object('rule_id', 'internal-risk-rule', 'ip_hash', 'internal-ip-hash')
);

insert into payments.telegram_webhook_events (
  update_id,
  event_type,
  user_id,
  telegram_user_id,
  invoice_payload,
  payload
) values (
  104400000020001,
  'successful_payment',
  (select id from _ids where key = 'invitee'),
  10440000002,
  'internal-invoice-payload',
  jsonb_build_object('raw_webhook', 'internal-only')
);

insert into _ids (key, payload)
select
  'ledger_credit_response',
  api.economy_credit(
    (select id from _ids where key = 'inviter'),
    'KCOIN',
    1,
    'phase4_sensitive_response_test',
    null,
    null,
    'phase4-sensitive-ledger-001',
    'test',
    jsonb_build_object('request_context', 'internal-only')
  );

insert into _ids (key, payload)
values ('records_response', api.referral_get_records((select id from _ids where key = 'inviter'), null, null, 10));

insert into _ids (key, payload)
values ('commission_history_response', api.referral_get_commission_history((select id from _ids where key = 'inviter'), null, 'pending', 10));

insert into _ids (key, payload)
values ('task_center_response', api.get_user_task_center((select id from _ids where key = 'inviter')));

select ok(
  not ((select payload from _ids where key = 'bind_response') ? 'invitee_user_id'),
  'referral_bind_inviter does not return invitee_user_id'
);

select ok(
  not ((select payload from _ids where key = 'bind_repeat_response') ? 'invitee_user_id'),
  'referral_bind_inviter idempotent replay does not return cached invitee_user_id'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload -> 'records' from _ids where key = 'records_response')) as record(value)
    where record.value ? 'invitee_user_id'
  ),
  'referral_get_records does not return invitee_user_id'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload -> 'commissions' from _ids where key = 'commission_history_response')) as commission(value)
    where commission.value ? 'invitee_user_id'
  ),
  'referral_get_commission_history does not return invitee_user_id'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload -> 'referral_records' from _ids where key = 'task_center_response')) as record(value)
    where record.value ? 'invitee_user_id'
  ),
  'get_user_task_center referral records do not return invitee_user_id'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload -> 'commission_history' from _ids where key = 'task_center_response')) as commission(value)
    where commission.value ? 'invitee_user_id'
  ),
  'get_user_task_center commission history does not return invitee_user_id'
);

select ok(
  not ((select payload #> '{profile}' from _ids where key = 'task_center_response') ? 'risk_score'),
  'get_user_task_center profile does not return core.users.risk_score'
);

select ok(
  not ((select payload #> '{profile}' from _ids where key = 'task_center_response') ? 'metadata'),
  'get_user_task_center profile does not return core.users.metadata'
);

select ok(
  not ((select payload from _ids where key = 'task_center_response') ? 'risk_events'),
  'get_user_task_center does not return ops.risk_events'
);

select ok(
  not ((select payload from _ids where key = 'task_center_response') ? 'payments'),
  'get_user_task_center does not return raw payment webhook data'
);

select ok(
  not exists (
    select 1
    from jsonb_each((select payload -> 'balances' from _ids where key = 'task_center_response')) as balance(currency_code, value)
    where balance.value ? 'metadata'
  ),
  'get_user_task_center balances do not return currency_ledger.metadata'
);

select ok(
  not (
    select response ? 'invitee_user_id'
    from ops.idempotency_keys
    where key = 'referral_bind_inviter:phase4-sensitive-bind-001'
  ),
  'stored referral_bind_inviter idempotency response does not cache invitee_user_id'
);

select * from finish();

rollback;
