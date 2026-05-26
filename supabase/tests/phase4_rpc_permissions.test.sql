-- Phase 4 / 4.3 RPC permission acceptance checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

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
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

select no_plan();

create temp table _phase4_rpc_targets (
  signature text primary key,
  rpc_name text not null
) on commit drop;

insert into _phase4_rpc_targets (signature, rpc_name) values
  ('api.task_daily_check_in(uuid)', 'task_daily_check_in'),
  ('api.task_daily_check_in(uuid,uuid,date,integer,text)', 'task_daily_check_in'),
  ('api.task_claim_reward(uuid,uuid,text)', 'task_claim_reward'),
  ('api.task_claim_reward(uuid,uuid,text,text)', 'task_claim_reward'),
  ('api.task_record_progress(uuid,text,integer,uuid,text)', 'task_record_progress'),
  ('api.referral_bind_inviter(uuid,text,text,jsonb)', 'referral_bind_inviter'),
  ('api.referral_process_first_open(uuid,uuid)', 'referral_process_first_open'),
  ('api.referral_create_commission(uuid,uuid,numeric,integer)', 'referral_create_commission'),
  ('api.referral_claim_commission(uuid,uuid[],text)', 'referral_claim_commission'),
  ('api.get_user_task_center(uuid)', 'get_user_task_center');

select is(
  (
    select count(*)::integer
    from _phase4_rpc_targets
    where to_regprocedure(signature) is null
  ),
  0,
  'all Phase 4.3 target RPC signatures exist'
);

select is(
  (
    select count(*)::integer
    from _phase4_rpc_targets t
    join pg_proc p on p.oid = to_regprocedure(t.signature)
    where not p.prosecdef
  ),
  0,
  'all Phase 4.3 target RPCs are SECURITY DEFINER'
);

select is(
  (
    select count(*)::integer
    from _phase4_rpc_targets t
    join pg_proc p on p.oid = to_regprocedure(t.signature)
    where not exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(value)
      where cfg.value = 'search_path=""'
    )
  ),
  0,
  'all Phase 4.3 target RPCs pin an empty search_path'
);

select is(
  (
    select count(*)::integer
    from _phase4_rpc_targets
    where has_function_privilege('public', signature, 'EXECUTE')
       or has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  0,
  'public, anon and authenticated cannot execute Phase 4.3 RPCs directly'
);

select is(
  (
    select count(*)::integer
    from _phase4_rpc_targets
    where not has_function_privilege('service_role', signature, 'EXECUTE')
  ),
  0,
  'service_role can execute all Phase 4.3 RPCs'
);

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;

insert into _ids (key, id)
values ('restricted_user', testutil.make_user(10430000001, 'phase4_restricted_user', null));

update core.users
set status = 'restricted'
where id = (select id from _ids where key = 'restricted_user');

select ok(
  testutil.raises_like(
    format(
      'select api.task_daily_check_in(%L::uuid, null::uuid, current_date, 0, %L)',
      (select id::text from _ids where key = 'restricted_user'),
      'phase4-restricted-signin-001'
    ),
    '%user is not active%'
  ),
  'task_daily_check_in rejects non-active users'
);

insert into _ids (key, id) values ('inviter', testutil.make_user(10430000002, 'phase4_comm_inviter', null));
insert into _ids (key, id) values ('invitee', testutil.make_user(10430000003, 'phase4_comm_invitee', null));
insert into _ids (key, id) select 'box', id from gacha.blind_boxes where slug = 'starter_egg';

insert into tasks.referrals (
  inviter_user_id,
  invitee_user_id,
  invite_code,
  status,
  rewarded_at,
  metadata
) values (
  (select id from _ids where key = 'inviter'),
  (select id from _ids where key = 'invitee'),
  (select invite_code from core.users where id = (select id from _ids where key = 'inviter')),
  'rewarded',
  now(),
  jsonb_build_object('test', 'phase4_rpc_permissions')
);

insert into _ids (key, payload)
select
  'fake_source_commission',
  api.referral_create_commission(
    (select id from _ids where key = 'invitee'),
    gen_random_uuid(),
    100,
    1000
  );

select is(
  (select payload ->> 'reason' from _ids where key = 'fake_source_commission'),
  'draw_order_not_found',
  'referral_create_commission rejects fake source_id'
);

insert into _ids (key, payload)
select
  'unopened_order',
  api.gacha_create_order(
    (select id from _ids where key = 'invitee'),
    (select id from _ids where key = 'box'),
    1,
    'phase4-rpc-permission-unopened-order'
  );

insert into _ids (key, id)
select 'unopened_order_id', ((select payload from _ids where key = 'unopened_order') ->> 'draw_order_id')::uuid;

insert into _ids (key, payload)
select
  'unopened_source_commission',
  api.referral_create_commission(
    (select id from _ids where key = 'invitee'),
    (select id from _ids where key = 'unopened_order_id'),
    100,
    1000
  );

select is(
  (select payload ->> 'reason' from _ids where key = 'unopened_source_commission'),
  'draw_order_not_successful',
  'referral_create_commission rejects real but unsuccessful draw orders'
);

select is(
  (
    select count(*)::integer
    from tasks.referral_commissions
    where invitee_user_id = (select id from _ids where key = 'invitee')
  ),
  0,
  'rejected commission sources do not write referral_commissions'
);

select * from finish();

rollback;
