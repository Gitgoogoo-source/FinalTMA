-- Phase 4 / 4.5 RLS verification checks.
-- These tests exercise RLS as browser roles with concrete app_user_id claims,
-- instead of only checking policy metadata.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, tasks, ops, api;

grant usage on schema extensions, testutil to public;

create or replace function testutil.raises_like(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return lower(sqlerrm) like lower(p_pattern);
end;
$$;

grant execute on function testutil.raises_like(text, text) to public;

select no_plan();

insert into core.users (
  id,
  telegram_user_id,
  username,
  first_name,
  status,
  metadata
) values
  ('00000000-0000-4000-8000-000000004501', 10450000001, 'phase4_rls_user_a', 'Phase4 RLS A', 'active', '{"test":"phase4_rls_verification"}'::jsonb),
  ('00000000-0000-4000-8000-000000004502', 10450000002, 'phase4_rls_user_b', 'Phase4 RLS B', 'active', '{"test":"phase4_rls_verification"}'::jsonb),
  ('00000000-0000-4000-8000-000000004503', 10450000003, 'phase4_rls_user_c', 'Phase4 RLS C', 'active', '{"test":"phase4_rls_verification"}'::jsonb),
  ('00000000-0000-4000-8000-000000004504', 10450000004, 'phase4_rls_user_d', 'Phase4 RLS D', 'active', '{"test":"phase4_rls_verification"}'::jsonb),
  ('00000000-0000-4000-8000-000000004505', 10450000005, 'phase4_rls_outsider', 'Phase4 RLS Outsider', 'active', '{"test":"phase4_rls_verification"}'::jsonb);

insert into tasks.task_definitions (
  id,
  code,
  task_type,
  title,
  period_type,
  target_count,
  reward,
  action_type,
  active
) values (
  '00000000-0000-4000-8000-000000004510',
  'phase4_rls_verification',
  'daily',
  'Phase 4 RLS verification',
  'daily',
  1,
  '[]'::jsonb,
  'none',
  true
);

insert into tasks.signin_campaigns (
  id,
  code,
  title,
  cycle_days,
  active,
  starts_at,
  ends_at
) values (
  '00000000-0000-4000-8000-000000004511',
  'phase4_rls_verification',
  'Phase 4 RLS verification',
  7,
  true,
  now() - interval '1 day',
  now() + interval '1 day'
);

insert into tasks.user_task_progress (
  id,
  user_id,
  task_id,
  period_key,
  progress_count,
  target_count,
  status,
  completed_at
) values
  ('00000000-0000-4000-8000-000000004521', '00000000-0000-4000-8000-000000004501', '00000000-0000-4000-8000-000000004510', 'phase4-rls', 1, 1, 'completed', now()),
  ('00000000-0000-4000-8000-000000004522', '00000000-0000-4000-8000-000000004502', '00000000-0000-4000-8000-000000004510', 'phase4-rls', 1, 1, 'completed', now());

insert into tasks.task_claims (
  id,
  user_id,
  task_id,
  period_key,
  reward,
  idempotency_key,
  request_fingerprint
) values
  ('00000000-0000-4000-8000-000000004531', '00000000-0000-4000-8000-000000004501', '00000000-0000-4000-8000-000000004510', 'phase4-rls', '[{"currency_code":"KCOIN","amount":1}]'::jsonb, 'phase4-rls-claim-a', 'phase4-rls-fingerprint-a'),
  ('00000000-0000-4000-8000-000000004532', '00000000-0000-4000-8000-000000004502', '00000000-0000-4000-8000-000000004510', 'phase4-rls', '[{"currency_code":"KCOIN","amount":1}]'::jsonb, 'phase4-rls-claim-b', 'phase4-rls-fingerprint-b');

insert into tasks.user_signins (
  id,
  user_id,
  campaign_id,
  day_index,
  signin_date,
  reward,
  status,
  idempotency_key,
  request_fingerprint
) values
  ('00000000-0000-4000-8000-000000004541', '00000000-0000-4000-8000-000000004501', '00000000-0000-4000-8000-000000004511', 1, date '2026-05-26', '[{"currency_code":"KCOIN","amount":1}]'::jsonb, 'claimed', 'phase4-rls-signin-a', 'phase4-rls-signin-fingerprint-a'),
  ('00000000-0000-4000-8000-000000004542', '00000000-0000-4000-8000-000000004502', '00000000-0000-4000-8000-000000004511', 1, date '2026-05-26', '[{"currency_code":"KCOIN","amount":1}]'::jsonb, 'claimed', 'phase4-rls-signin-b', 'phase4-rls-signin-fingerprint-b');

insert into tasks.referrals (
  id,
  inviter_user_id,
  invitee_user_id,
  invite_code,
  status,
  metadata
) values
  ('00000000-0000-4000-8000-000000004551', '00000000-0000-4000-8000-000000004501', '00000000-0000-4000-8000-000000004502', 'PHASE4RLSA', 'pending', '{"test":"phase4_rls_verification"}'::jsonb),
  ('00000000-0000-4000-8000-000000004552', '00000000-0000-4000-8000-000000004503', '00000000-0000-4000-8000-000000004504', 'PHASE4RLSC', 'pending', '{"test":"phase4_rls_verification"}'::jsonb);

insert into tasks.referral_commissions (
  id,
  referral_id,
  inviter_user_id,
  invitee_user_id,
  source_type,
  source_id,
  base_amount_kcoin,
  commission_bps,
  commission_amount_kcoin,
  status
) values
  ('00000000-0000-4000-8000-000000004561', '00000000-0000-4000-8000-000000004551', '00000000-0000-4000-8000-000000004501', '00000000-0000-4000-8000-000000004502', 'gacha_open', '00000000-0000-4000-8000-000000004571', 100, 1000, 10, 'pending'),
  ('00000000-0000-4000-8000-000000004562', '00000000-0000-4000-8000-000000004552', '00000000-0000-4000-8000-000000004503', '00000000-0000-4000-8000-000000004504', 'gacha_open', '00000000-0000-4000-8000-000000004572', 100, 1000, 10, 'pending');

insert into economy.currency_ledger (
  id,
  user_id,
  currency_code,
  entry_type,
  amount,
  available_before,
  available_after,
  locked_before,
  locked_after,
  source_type,
  source_id,
  source_ref,
  idempotency_key,
  metadata
) values (
  '00000000-0000-4000-8000-000000004581',
  '00000000-0000-4000-8000-000000004501',
  'KCOIN',
  'credit',
  1,
  0,
  1,
  0,
  0,
  'phase4_rls_verification',
  '00000000-0000-4000-8000-000000004510',
  'phase4-rls-verification',
  'phase4-rls-ledger-a',
  '{"test":"phase4_rls_verification"}'::jsonb
);

insert into ops.risk_events (
  id,
  user_id,
  event_type,
  severity,
  source_type,
  detail
) values (
  '00000000-0000-4000-8000-000000004591',
  '00000000-0000-4000-8000-000000004501',
  'wallet_sync_stuck',
  'low',
  'test',
  '{"test":"phase4_rls_verification"}'::jsonb
);

insert into ops.idempotency_keys (
  key,
  user_id,
  scope,
  request_hash,
  response,
  status
) values (
  'phase4-rls-verification',
  '00000000-0000-4000-8000-000000004501',
  'phase4_rls_verification',
  'phase4-rls-request-hash',
  '{"test":"phase4_rls_verification"}'::jsonb,
  'completed'
);

set local role authenticated;
set local request.jwt.claims to '{"app_user_id":"00000000-0000-4000-8000-000000004501"}';

select is(
  (select count(*)::integer from tasks.user_task_progress where id in ('00000000-0000-4000-8000-000000004521', '00000000-0000-4000-8000-000000004522')),
  1,
  'A user only reads own user_task_progress rows'
);

select is(
  (select count(*)::integer from tasks.user_task_progress where id = '00000000-0000-4000-8000-000000004522'),
  0,
  'A user cannot read B user_task_progress'
);

select is(
  (select count(*)::integer from tasks.task_claims where id in ('00000000-0000-4000-8000-000000004531', '00000000-0000-4000-8000-000000004532')),
  1,
  'A user only reads own task_claims rows'
);

select is(
  (select count(*)::integer from tasks.task_claims where id = '00000000-0000-4000-8000-000000004532'),
  0,
  'A user cannot read B task_claims'
);

select is(
  (select count(*)::integer from tasks.user_signins where id in ('00000000-0000-4000-8000-000000004541', '00000000-0000-4000-8000-000000004542')),
  1,
  'A user only reads own user_signins rows'
);

select is(
  (select count(*)::integer from tasks.user_signins where id = '00000000-0000-4000-8000-000000004542'),
  0,
  'A user cannot read B user_signins'
);

select is(
  (select count(*)::integer from tasks.referrals where id = '00000000-0000-4000-8000-000000004551'),
  1,
  'referral inviter can read the referral row'
);

select is(
  (select count(*)::integer from tasks.referrals where id = '00000000-0000-4000-8000-000000004552'),
  0,
  'non-party user cannot read another referral row'
);

select is(
  (select count(*)::integer from tasks.referral_commissions where id = '00000000-0000-4000-8000-000000004561'),
  1,
  'commission inviter can read own commission row'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"app_user_id":"00000000-0000-4000-8000-000000004502"}';

select is(
  (select count(*)::integer from tasks.referrals where id = '00000000-0000-4000-8000-000000004551'),
  1,
  'referral invitee can read the referral row'
);

select is(
  (select count(*)::integer from tasks.referral_commissions where id = '00000000-0000-4000-8000-000000004561'),
  0,
  'commission invitee cannot read inviter-only commission row'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"app_user_id":"00000000-0000-4000-8000-000000004505"}';

select is(
  (select count(*)::integer from tasks.referrals where id in ('00000000-0000-4000-8000-000000004551', '00000000-0000-4000-8000-000000004552')),
  0,
  'non-party user cannot read referral rows'
);

select is(
  (select count(*)::integer from tasks.referral_commissions where id in ('00000000-0000-4000-8000-000000004561', '00000000-0000-4000-8000-000000004562')),
  0,
  'non-inviter user cannot read referral commission rows'
);

select ok(
  testutil.raises_like(
    'insert into economy.currency_ledger (user_id, currency_code, entry_type, amount, source_type, idempotency_key) values (''00000000-0000-4000-8000-000000004505''::uuid, ''KCOIN'', ''credit'', 1, ''phase4_rls_direct_write'', ''phase4-rls-ledger-direct-insert'')',
    '%permission denied%'
  ),
  'authenticated cannot insert currency_ledger'
);

select ok(
  testutil.raises_like(
    'update economy.currency_ledger set note = ''direct update blocked'' where id = ''00000000-0000-4000-8000-000000004581''::uuid',
    '%permission denied%'
  ),
  'authenticated cannot update currency_ledger'
);

select ok(
  testutil.raises_like(
    'delete from economy.currency_ledger where id = ''00000000-0000-4000-8000-000000004581''::uuid',
    '%permission denied%'
  ),
  'authenticated cannot delete currency_ledger'
);

select ok(
  testutil.raises_like(
    'insert into tasks.task_claims (user_id, task_id, period_key, reward) values (''00000000-0000-4000-8000-000000004505''::uuid, ''00000000-0000-4000-8000-000000004510''::uuid, ''phase4-direct-write'', ''[]''::jsonb)',
    '%permission denied%'
  ),
  'authenticated cannot insert task_claims'
);

select ok(
  testutil.raises_like(
    'update tasks.task_claims set metadata = metadata || ''{"direct_write":true}''::jsonb where id = ''00000000-0000-4000-8000-000000004531''::uuid',
    '%permission denied%'
  ),
  'authenticated cannot update task_claims'
);

select ok(
  testutil.raises_like(
    'delete from tasks.task_claims where id = ''00000000-0000-4000-8000-000000004531''::uuid',
    '%permission denied%'
  ),
  'authenticated cannot delete task_claims'
);

select ok(
  testutil.raises_like(
    'insert into tasks.referrals (inviter_user_id, invitee_user_id, invite_code, status) values (''00000000-0000-4000-8000-000000004505''::uuid, ''00000000-0000-4000-8000-000000004501''::uuid, ''PHASE4RLSX'', ''pending'')',
    '%permission denied%'
  ),
  'authenticated cannot insert referrals'
);

select ok(
  testutil.raises_like(
    'update tasks.referrals set status = ''cancelled'' where id = ''00000000-0000-4000-8000-000000004551''::uuid',
    '%permission denied%'
  ),
  'authenticated cannot update referrals'
);

select ok(
  testutil.raises_like(
    'delete from tasks.referrals where id = ''00000000-0000-4000-8000-000000004551''::uuid',
    '%permission denied%'
  ),
  'authenticated cannot delete referrals'
);

select ok(
  testutil.raises_like(
    'insert into tasks.referral_commissions (referral_id, inviter_user_id, invitee_user_id, source_type, source_id, base_amount_kcoin, commission_bps, commission_amount_kcoin, status) values (''00000000-0000-4000-8000-000000004551''::uuid, ''00000000-0000-4000-8000-000000004501''::uuid, ''00000000-0000-4000-8000-000000004502''::uuid, ''gacha_open'', ''00000000-0000-4000-8000-000000004573''::uuid, 100, 1000, 10, ''pending'')',
    '%permission denied%'
  ),
  'authenticated cannot insert referral_commissions'
);

select ok(
  testutil.raises_like(
    'update tasks.referral_commissions set status = ''granted'' where id = ''00000000-0000-4000-8000-000000004561''::uuid',
    '%permission denied%'
  ),
  'authenticated cannot update referral_commissions'
);

select ok(
  testutil.raises_like(
    'delete from tasks.referral_commissions where id = ''00000000-0000-4000-8000-000000004561''::uuid',
    '%permission denied%'
  ),
  'authenticated cannot delete referral_commissions'
);

select ok(
  testutil.raises_like(
    'select count(*) from ops.risk_events',
    '%permission denied%'
  ),
  'authenticated cannot access ops.risk_events'
);

select ok(
  testutil.raises_like(
    'select count(*) from ops.idempotency_keys',
    '%permission denied%'
  ),
  'authenticated cannot access ops.idempotency_keys'
);

reset role;

set local role anon;
set local request.jwt.claims to '{}';

select ok(
  testutil.raises_like(
    'select count(*) from ops.risk_events',
    '%permission denied%'
  ),
  'anon cannot access ops.risk_events'
);

select ok(
  testutil.raises_like(
    'select count(*) from ops.idempotency_keys',
    '%permission denied%'
  ),
  'anon cannot access ops.idempotency_keys'
);

reset role;

with target(schema_name, table_name) as (
  values
    ('economy', 'currency_ledger'),
    ('tasks', 'task_claims'),
    ('tasks', 'referrals'),
    ('tasks', 'referral_commissions'),
    ('ops', 'risk_events'),
    ('ops', 'idempotency_keys')
),
direct_write_leak as (
  select target.schema_name, target.table_name, roles.role_name, privileges.privilege_name
  from target
  cross join (values ('anon'), ('authenticated')) as roles(role_name)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as privileges(privilege_name)
  where has_table_privilege(
    roles.role_name,
    format('%I.%I', target.schema_name, target.table_name),
    privileges.privilege_name
  )
)
select is(
  (select count(*)::integer from direct_write_leak),
  0,
  'browser roles have no direct write grants for Phase 4.5 protected tables'
);

with required_rpc(signature) as (
  values
    ('api.task_daily_check_in(uuid)'::text),
    ('api.task_daily_check_in(uuid,uuid,date,integer,text)'),
    ('api.task_claim_reward(uuid,uuid,text)'),
    ('api.task_claim_reward(uuid,uuid,text,text)'),
    ('api.task_record_progress(uuid,text,integer,uuid,text)'),
    ('api.referral_bind_inviter(uuid,text,text,jsonb)'),
    ('api.referral_process_first_open(uuid,uuid)'),
    ('api.referral_create_commission(uuid,uuid,numeric,integer)'),
    ('api.referral_claim_commission(uuid,uuid[],text)')
),
permission_mismatch as (
  select signature
  from required_rpc
  where to_regprocedure(signature) is null
     or not has_function_privilege('service_role', signature, 'EXECUTE')
     or has_function_privilege('public', signature, 'EXECUTE')
     or has_function_privilege('anon', signature, 'EXECUTE')
     or has_function_privilege('authenticated', signature, 'EXECUTE')
)
select is(
  (select count(*)::integer from permission_mismatch),
  0,
  'Phase 4 write operations are exposed only through service_role RPCs'
);

select * from finish();

rollback;
