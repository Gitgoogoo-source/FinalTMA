-- Phase 4 / 11.1 task RLS database acceptance checks.

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
  ('00000000-0000-4000-8110-000000000001', 11110400001, 'tasks_rls_11_1_user_a', 'RLS A', 'active', '{"test":"tasks_rls_11_1"}'::jsonb),
  ('00000000-0000-4000-8110-000000000002', 11110400002, 'tasks_rls_11_1_user_b', 'RLS B', 'active', '{"test":"tasks_rls_11_1"}'::jsonb),
  ('00000000-0000-4000-8110-000000000003', 11110400003, 'tasks_rls_11_1_user_c', 'RLS C', 'active', '{"test":"tasks_rls_11_1"}'::jsonb),
  ('00000000-0000-4000-8110-000000000004', 11110400004, 'tasks_rls_11_1_user_d', 'RLS D', 'active', '{"test":"tasks_rls_11_1"}'::jsonb),
  ('00000000-0000-4000-8110-000000000005', 11110400005, 'tasks_rls_11_1_outsider', 'RLS Outsider', 'active', '{"test":"tasks_rls_11_1"}'::jsonb);

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
  '00000000-0000-4000-8110-000000000010',
  'TASKS_RLS_11_1_TEST',
  'daily',
  '11.1 RLS Test',
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
  '00000000-0000-4000-8110-000000000011',
  'TASKS_RLS_11_1_TEST',
  '11.1 RLS Test',
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
  ('00000000-0000-4000-8110-000000000021', '00000000-0000-4000-8110-000000000001', '00000000-0000-4000-8110-000000000010', 'tasks-rls-11-1', 1, 1, 'completed', now()),
  ('00000000-0000-4000-8110-000000000022', '00000000-0000-4000-8110-000000000002', '00000000-0000-4000-8110-000000000010', 'tasks-rls-11-1', 1, 1, 'completed', now());

insert into tasks.task_claims (
  id,
  user_id,
  task_id,
  period_key,
  reward,
  idempotency_key,
  request_fingerprint
) values
  ('00000000-0000-4000-8110-000000000031', '00000000-0000-4000-8110-000000000001', '00000000-0000-4000-8110-000000000010', 'tasks-rls-11-1', '[]'::jsonb, 'tasks-rls-11-1-claim-a', 'tasks-rls-11-1-fp-a'),
  ('00000000-0000-4000-8110-000000000032', '00000000-0000-4000-8110-000000000002', '00000000-0000-4000-8110-000000000010', 'tasks-rls-11-1', '[]'::jsonb, 'tasks-rls-11-1-claim-b', 'tasks-rls-11-1-fp-b');

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
  ('00000000-0000-4000-8110-000000000041', '00000000-0000-4000-8110-000000000001', '00000000-0000-4000-8110-000000000011', 1, date '2026-05-27', '[]'::jsonb, 'claimed', 'tasks-rls-11-1-signin-a', 'tasks-rls-11-1-signin-fp-a'),
  ('00000000-0000-4000-8110-000000000042', '00000000-0000-4000-8110-000000000002', '00000000-0000-4000-8110-000000000011', 1, date '2026-05-27', '[]'::jsonb, 'claimed', 'tasks-rls-11-1-signin-b', 'tasks-rls-11-1-signin-fp-b');

insert into tasks.referrals (
  id,
  inviter_user_id,
  invitee_user_id,
  invite_code,
  status,
  metadata
) values
  ('00000000-0000-4000-8110-000000000051', '00000000-0000-4000-8110-000000000001', '00000000-0000-4000-8110-000000000002', 'RLS111A', 'pending', '{"test":"tasks_rls_11_1"}'::jsonb),
  ('00000000-0000-4000-8110-000000000052', '00000000-0000-4000-8110-000000000003', '00000000-0000-4000-8110-000000000004', 'RLS111C', 'pending', '{"test":"tasks_rls_11_1"}'::jsonb);

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
  ('00000000-0000-4000-8110-000000000061', '00000000-0000-4000-8110-000000000051', '00000000-0000-4000-8110-000000000001', '00000000-0000-4000-8110-000000000002', 'gacha_open', '00000000-0000-4000-8110-000000000071', 100, 1000, 10, 'pending'),
  ('00000000-0000-4000-8110-000000000062', '00000000-0000-4000-8110-000000000052', '00000000-0000-4000-8110-000000000003', '00000000-0000-4000-8110-000000000004', 'gacha_open', '00000000-0000-4000-8110-000000000072', 100, 1000, 10, 'pending');

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
  '00000000-0000-4000-8110-000000000081',
  '00000000-0000-4000-8110-000000000001',
  'KCOIN',
  'credit',
  1,
  0,
  1,
  0,
  0,
  'tasks_rls_11_1',
  '00000000-0000-4000-8110-000000000010',
  'tasks-rls-11-1',
  'tasks-rls-11-1-ledger-a',
  '{"test":"tasks_rls_11_1"}'::jsonb
);

set local role authenticated;
set local request.jwt.claims to '{"app_user_id":"00000000-0000-4000-8110-000000000001"}';

select is(
  (select count(*)::int from tasks.user_task_progress where id in ('00000000-0000-4000-8110-000000000021', '00000000-0000-4000-8110-000000000022')),
  1,
  'authenticated user can only read own task progress'
);
select is(
  (select count(*)::int from tasks.task_claims where id in ('00000000-0000-4000-8110-000000000031', '00000000-0000-4000-8110-000000000032')),
  1,
  'authenticated user can only read own task claims'
);
select is(
  (select count(*)::int from tasks.user_signins where id in ('00000000-0000-4000-8110-000000000041', '00000000-0000-4000-8110-000000000042')),
  1,
  'authenticated user can only read own sign-in rows'
);
select is(
  (select count(*)::int from tasks.referrals where id = '00000000-0000-4000-8110-000000000051'),
  1,
  'referral inviter can read own referral'
);
select is(
  (select count(*)::int from tasks.referrals where id = '00000000-0000-4000-8110-000000000052'),
  0,
  'non-party user cannot read other referral'
);
select is(
  (select count(*)::int from tasks.referral_commissions where id in ('00000000-0000-4000-8110-000000000061', '00000000-0000-4000-8110-000000000062')),
  1,
  'commission inviter can only read own commission rows'
);
select is(
  (select count(*)::int from economy.currency_ledger where id = '00000000-0000-4000-8110-000000000081'),
  1,
  'ledger owner can read own ledger row'
);

select ok(
  testutil.raises_like(
    'insert into tasks.task_claims (user_id, task_id, period_key, reward) values (''00000000-0000-4000-8110-000000000001''::uuid, ''00000000-0000-4000-8110-000000000010''::uuid, ''direct-write'', ''[]''::jsonb)',
    '%permission denied%'
  ),
  'authenticated cannot insert task_claims'
);
select ok(
  testutil.raises_like(
    'insert into tasks.user_signins (user_id, campaign_id, day_index, signin_date, reward, status) values (''00000000-0000-4000-8110-000000000001''::uuid, ''00000000-0000-4000-8110-000000000011''::uuid, 1, current_date, ''[]''::jsonb, ''claimed'')',
    '%permission denied%'
  ),
  'authenticated cannot insert user_signins'
);
select ok(
  testutil.raises_like(
    'insert into tasks.referrals (inviter_user_id, invitee_user_id, invite_code, status) values (''00000000-0000-4000-8110-000000000001''::uuid, ''00000000-0000-4000-8110-000000000005''::uuid, ''RLS111X'', ''pending'')',
    '%permission denied%'
  ),
  'authenticated cannot insert referrals'
);
select ok(
  testutil.raises_like(
    'insert into economy.currency_ledger (user_id, currency_code, entry_type, amount, source_type, idempotency_key) values (''00000000-0000-4000-8110-000000000001''::uuid, ''KCOIN'', ''credit'', 1, ''direct_write'', ''tasks-rls-11-1-direct-ledger'')',
    '%permission denied%'
  ),
  'authenticated cannot insert currency_ledger'
);

reset role;

set local role authenticated;
set local request.jwt.claims to '{"app_user_id":"00000000-0000-4000-8110-000000000002"}';

select is(
  (select count(*)::int from tasks.referrals where id = '00000000-0000-4000-8110-000000000051'),
  1,
  'referral invitee can read own referral'
);
select is(
  (select count(*)::int from tasks.referral_commissions where id = '00000000-0000-4000-8110-000000000061'),
  0,
  'commission invitee cannot read inviter-only commission'
);

reset role;

set local role anon;
set local request.jwt.claims to '{}';

select ok(
  testutil.raises_like(
    'insert into tasks.user_task_progress (user_id, task_id, period_key, progress_count, target_count, status) values (''00000000-0000-4000-8110-000000000005''::uuid, ''00000000-0000-4000-8110-000000000010''::uuid, ''direct-write'', 1, 1, ''completed'')',
    '%permission denied%'
  ),
  'anon cannot insert task progress'
);

reset role;

select * from finish();

rollback;
