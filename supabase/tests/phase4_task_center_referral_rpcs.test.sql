-- Phase 4 task center and referral RPC acceptance checks.
-- Covers 第四阶段规划.md / 3.3 建议新增 RPC 清单缺口.

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
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

select no_plan();

select ok(to_regprocedure('api.get_user_task_center(uuid)') is not null, 'get_user_task_center exists');
select ok(to_regprocedure('api.task_get_list(uuid,jsonb)') is not null, 'task_get_list exists');
select ok(to_regprocedure('api.task_record_progress(uuid,text,integer,uuid,text)') is not null, 'task_record_progress exists');
select ok(to_regprocedure('api.signin_get_status(uuid,uuid)') is not null, 'signin_get_status exists');
select ok(to_regprocedure('api.referral_bind_inviter(uuid,text,text,jsonb)') is not null, 'referral_bind_inviter exists');
select ok(to_regprocedure('api.referral_get_invite_stats(uuid,timestamp with time zone,timestamp with time zone)') is not null, 'referral_get_invite_stats exists');
select ok(to_regprocedure('api.referral_record_share_event(uuid,text,jsonb,text)') is not null, 'referral_record_share_event exists');
select ok(to_regprocedure('api.referral_get_records(uuid,timestamp with time zone,text,integer)') is not null, 'referral_get_records exists');
select ok(to_regprocedure('api.referral_get_commission_history(uuid,timestamp with time zone,text,integer)') is not null, 'referral_get_commission_history exists');

select ok(
  has_function_privilege('service_role', 'api.get_user_task_center(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'api.get_user_task_center(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'api.get_user_task_center(uuid)', 'EXECUTE'),
  'get_user_task_center is service-role only'
);

select ok(
  has_function_privilege('service_role', 'api.referral_bind_inviter(uuid,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'api.referral_bind_inviter(uuid,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'api.referral_bind_inviter(uuid,text,text,jsonb)', 'EXECUTE'),
  'referral_bind_inviter is service-role only'
);

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;
insert into _ids (key, id) values ('task_user', testutil.make_user(10400000001, 'phase4_task_user', null));
insert into _ids (key, payload) values ('task_list', api.task_get_list((select id from _ids where key = 'task_user'), '{}'::jsonb));

select ok(jsonb_array_length((select payload -> 'tasks' from _ids where key = 'task_list')) >= 10, 'task_get_list returns seeded task definitions');
select ok(
  exists (
    select 1
    from jsonb_array_elements((select payload -> 'tasks' from _ids where key = 'task_list')) as task_item(value)
    where task_item.value ->> 'code' = 'DAILY_SHARE_INVITE'
      and task_item.value #>> '{progress,status}' = 'in_progress'
  ),
  'task_get_list returns default in-progress state'
);

insert into _ids (key, payload) values ('signin_status', api.signin_get_status((select id from _ids where key = 'task_user'), null));
select is(jsonb_array_length((select payload -> 'days' from _ids where key = 'signin_status')), 7, 'signin_get_status returns 7 sign-in days');
select is(((select payload from _ids where key = 'signin_status') ->> 'next_day_index')::int, 1, 'signin_get_status marks day 1 as next available before sign-in');

insert into _ids (key, id) values ('open_source', gen_random_uuid());
insert into _ids (key, payload)
values (
  'open_progress',
  api.task_record_progress(
    (select id from _ids where key = 'task_user'),
    'open_box',
    2,
    (select id from _ids where key = 'open_source'),
    current_date::text
  )
);

select is(
  (
    select up.progress_count
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'task_user')
      and td.code = 'DAILY_OPEN_BOX_1'
      and up.period_key = current_date::text
  ),
  1,
  'task_record_progress caps progress at target count'
);

select is(
  (
    select up.status
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'task_user')
      and td.code = 'DAILY_OPEN_BOX_1'
      and up.period_key = current_date::text
  ),
  'completed',
  'task_record_progress completes reached task'
);

insert into _ids (key, payload)
values (
  'open_progress_repeat',
  api.task_record_progress(
    (select id from _ids where key = 'task_user'),
    'open_box',
    2,
    (select id from _ids where key = 'open_source'),
    current_date::text
  )
);

select is(
  (
    select up.progress_count
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'task_user')
      and td.code = 'DAILY_OPEN_BOX_10'
      and up.period_key = current_date::text
  ),
  2,
  'task_record_progress does not double count the same source event'
);

insert into _ids (key, payload)
values (
  'share_event',
  api.referral_record_share_event(
    (select id from _ids where key = 'task_user'),
    'copy_link',
    jsonb_build_object('target', 'telegram', 'surface', 'task_page'),
    'share-event-idem-001'
  )
);

select ok(((select payload from _ids where key = 'share_event') ? 'event_id'), 'referral_record_share_event returns event_id');
select is(
  (
    select count(*)::int
    from tasks.share_events
    where user_id = (select id from _ids where key = 'task_user')
      and idempotency_key = 'share-event-idem-001'
  ),
  1,
  'referral_record_share_event writes one share event'
);
select is(
  (
    select up.status
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'task_user')
      and td.code = 'DAILY_SHARE_INVITE'
      and up.period_key = current_date::text
  ),
  'completed',
  'share event records task progress'
);

insert into _ids (key, payload)
values (
  'share_event_repeat',
  api.referral_record_share_event(
    (select id from _ids where key = 'task_user'),
    'copy_link',
    jsonb_build_object('target', 'telegram', 'surface', 'task_page'),
    'share-event-idem-001'
  )
);
select ok(((select payload from _ids where key = 'share_event_repeat') ->> 'idempotent')::boolean, 'repeated share event returns idempotent=true');
select is((select count(*)::int from tasks.share_events where user_id = (select id from _ids where key = 'task_user')), 1, 'repeated share event does not insert duplicate row');

insert into _ids (key, id) values ('inviter', testutil.make_user(10400000002, 'phase4_inviter', null));
insert into _ids (key, txt) select 'invite_code', invite_code from core.users where id = (select id from _ids where key = 'inviter');
insert into _ids (key, id) values ('invitee', testutil.make_user(10400000003, 'phase4_invitee', null));
insert into _ids (key, id) select 'box', id from gacha.blind_boxes where slug = 'starter_egg';

insert into _ids (key, payload)
values (
  'bind_referral',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'invite_code'),
    'bind-referral-idem-001',
    jsonb_build_object('surface', 'login_start_param')
  )
);

select ok(((select payload from _ids where key = 'bind_referral') ->> 'bound')::boolean, 'referral_bind_inviter binds invitee to inviter');
select is(
  (
    select inviter_user_id
    from tasks.referrals
    where invitee_user_id = (select id from _ids where key = 'invitee')
  ),
  (select id from _ids where key = 'inviter'),
  'referral row stores inviter'
);

insert into _ids (key, payload)
values (
  'bind_referral_repeat',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'invite_code'),
    'bind-referral-idem-001',
    jsonb_build_object('surface', 'login_start_param')
  )
);
select ok(((select payload from _ids where key = 'bind_referral_repeat') ->> 'idempotent')::boolean, 'repeated referral bind returns idempotent=true');

insert into _ids (key, payload)
values (
  'self_referral',
  api.referral_bind_inviter(
    (select id from _ids where key = 'inviter'),
    (select txt from _ids where key = 'invite_code'),
    'bind-referral-self-001',
    '{}'::jsonb
  )
);
select is((select payload ->> 'reason' from _ids where key = 'self_referral'), 'self_invite_not_allowed', 'self referral is rejected');
select is(
  (
    select count(*)::int
    from ops.risk_events
    where user_id = (select id from _ids where key = 'inviter')
      and event_type = 'referral_self_invite'
  ),
  1,
  'self referral writes risk event'
);

insert into _ids (key, id)
select 'referral', id from tasks.referrals where invitee_user_id = (select id from _ids where key = 'invitee');
insert into _ids (key, payload)
select 'open_order', api.gacha_create_order((select id from _ids where key = 'invitee'), (select id from _ids where key = 'box'), 1, 'phase4-referral-first-open-order-001');
insert into _ids (key, id) select 'draw_order', ((select payload from _ids where key = 'open_order') ->> 'draw_order_id')::uuid;
insert into _ids (key, payload)
select 'first_open_unpaid', api.referral_process_first_open((select id from _ids where key = 'invitee'), (select id from _ids where key = 'draw_order'));
select is((select payload ->> 'reason' from _ids where key = 'first_open_unpaid'), 'draw_order_not_successful', 'referral_process_first_open rejects unopened draw order');
insert into _ids (key, payload)
select 'process_order', api.gacha_process_dev_paid_order((select id from _ids where key = 'draw_order'), (select id from _ids where key = 'invitee'));
insert into _ids (key, payload)
select 'first_open', api.referral_process_first_open((select id from _ids where key = 'invitee'), (select id from _ids where key = 'draw_order'));
select ok(((select payload from _ids where key = 'first_open') ->> 'idempotent')::boolean, 'referral_process_first_open is idempotent for the same successful draw order');
insert into _ids (key, payload)
select 'first_open_commission', api.referral_create_commission((select id from _ids where key = 'invitee'), (select id from _ids where key = 'draw_order'), 100, 1000);
select is((select payload ->> 'reason' from _ids where key = 'first_open_commission'), 'first_open_order_not_commissionable', 'referral_create_commission rejects first-open draw order');

insert into ops.system_settings (key, value, description)
values (
  'REFERRAL_COMMISSION_BPS',
  '{"commission_bps":1500}'::jsonb,
  'Test override for referral commission bps.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

insert into _ids (key, payload)
select 'second_open_order', api.gacha_create_order((select id from _ids where key = 'invitee'), (select id from _ids where key = 'box'), 1, 'phase4-referral-second-open-order-001');
insert into _ids (key, id) select 'second_draw_order', ((select payload from _ids where key = 'second_open_order') ->> 'draw_order_id')::uuid;
insert into _ids (key, payload)
select 'second_process_order', api.gacha_process_dev_paid_order((select id from _ids where key = 'second_draw_order'), (select id from _ids where key = 'invitee'));
select ok(((select payload from _ids where key = 'second_process_order') #>> '{referral_commission,processed}')::boolean, 'subsequent open generates pending referral commission');
select is(
  (
    select commission_bps
    from tasks.referral_commissions
    where source_id = (select id from _ids where key = 'second_draw_order')
  ),
  1500,
  'gacha_process_paid_order uses configured referral commission bps'
);
select is(
  (
    select commission_amount_kcoin
    from tasks.referral_commissions
    where source_id = (select id from _ids where key = 'second_draw_order')
  ),
  15::numeric,
  'configured referral commission bps controls commission amount'
);

insert into _ids (key, payload) values ('invite_stats', api.referral_get_invite_stats((select id from _ids where key = 'inviter'), null, null));
select is(((select payload from _ids where key = 'invite_stats') #>> '{referrals,total_count}')::int, 1, 'referral_get_invite_stats counts referral records');
select is(((select payload from _ids where key = 'invite_stats') #>> '{commissions,pending_amount_kcoin}')::numeric, 15::numeric, 'referral_get_invite_stats sums pending commission');

insert into _ids (key, payload) values ('referral_records', api.referral_get_records((select id from _ids where key = 'inviter'), null, null, 10));
select is(jsonb_array_length((select payload -> 'records' from _ids where key = 'referral_records')), 1, 'referral_get_records returns inviter records');

insert into _ids (key, payload) values ('commission_history', api.referral_get_commission_history((select id from _ids where key = 'inviter'), null, 'pending', 10));
select is(jsonb_array_length((select payload -> 'commissions' from _ids where key = 'commission_history')), 1, 'referral_get_commission_history filters pending rows');

insert into _ids (key, payload) values ('task_center', api.get_user_task_center((select id from _ids where key = 'inviter')));
select ok((select payload ? 'tasks' from _ids where key = 'task_center'), 'get_user_task_center includes tasks');
select ok((select payload ? 'signin' from _ids where key = 'task_center'), 'get_user_task_center includes sign-in status');
select ok((select payload ? 'invite_stats' from _ids where key = 'task_center'), 'get_user_task_center includes invite stats');
select ok((select payload ? 'commission_stats' from _ids where key = 'task_center'), 'get_user_task_center includes commission stats');

select * from finish();

rollback;
