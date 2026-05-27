-- Phase 4 / 11.1 referral binding and first-open database acceptance checks.

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

create or replace function testutil.balance_of(p_user_id uuid, p_currency_code text)
returns numeric
language sql
stable
as $$
  select coalesce((
    select available_amount
    from economy.user_balances
    where user_id = p_user_id
      and currency_code = upper(p_currency_code)
  ), 0)::numeric;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;

insert into _ids (key, id) values
  ('inviter', testutil.make_user(11110200001, 'tasks_referral_11_1_inviter', null)),
  ('second_inviter', testutil.make_user(11110200002, 'tasks_referral_11_1_second_inviter', null)),
  ('invitee', testutil.make_user(11110200003, 'tasks_referral_11_1_invitee', null));

insert into _ids (key, txt)
select 'invite_code', invite_code from core.users where id = (select id from _ids where key = 'inviter');
insert into _ids (key, txt)
select 'second_invite_code', invite_code from core.users where id = (select id from _ids where key = 'second_inviter');
insert into _ids (key, id)
select 'box', id from gacha.blind_boxes where slug = 'starter_egg';

insert into _ids (key, payload)
values (
  'bind_first',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'invite_code'),
    'tasks-referral-11-1-bind',
    '{"surface":"tasks_referral_test"}'::jsonb
  )
);

select ok(((select payload from _ids where key = 'bind_first') ->> 'bound')::boolean, 'valid referral bind succeeds');
select is(
  (
    select inviter_user_id
    from tasks.referrals
    where invitee_user_id = (select id from _ids where key = 'invitee')
  ),
  (select id from _ids where key = 'inviter'),
  'referral row stores the inviter'
);
select is(
  (
    select referred_by_user_id
    from core.users
    where id = (select id from _ids where key = 'invitee')
  ),
  (select id from _ids where key = 'inviter'),
  'invitee user stores referred_by_user_id'
);

insert into _ids (key, payload)
values (
  'bind_repeat',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'invite_code'),
    'tasks-referral-11-1-bind',
    '{"surface":"tasks_referral_test"}'::jsonb
  )
);
select ok(((select payload from _ids where key = 'bind_repeat') ->> 'idempotent')::boolean, 'repeated referral bind with same key is idempotent');
select is(
  (select count(*)::int from tasks.referrals where invitee_user_id = (select id from _ids where key = 'invitee')),
  1,
  'repeated bind does not duplicate referral'
);

insert into _ids (key, payload)
values (
  'bind_self',
  api.referral_bind_inviter(
    (select id from _ids where key = 'inviter'),
    (select txt from _ids where key = 'invite_code'),
    'tasks-referral-11-1-self',
    '{}'::jsonb
  )
);
select is((select payload ->> 'reason' from _ids where key = 'bind_self'), 'self_invite_not_allowed', 'self referral is rejected');
select is(
  (
    select count(*)::int
    from ops.risk_events
    where user_id = (select id from _ids where key = 'inviter')
      and event_type = 'referral_self_invite'
  ),
  1,
  'self referral writes a risk event'
);

insert into _ids (key, payload)
values (
  'bind_different_inviter',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'second_invite_code'),
    'tasks-referral-11-1-rebind',
    '{}'::jsonb
  )
);
select is((select payload ->> 'reason' from _ids where key = 'bind_different_inviter'), 'referral_already_bound', 'repeat bind to a different inviter is rejected');
select is(
  (
    select count(*)::int
    from ops.risk_events
    where user_id = (select id from _ids where key = 'invitee')
      and event_type = 'referral_rebind_attempt'
  ),
  1,
  'repeat bind to a different inviter writes a risk event'
);

insert into _ids (key, id)
select 'referral', id from tasks.referrals where invitee_user_id = (select id from _ids where key = 'invitee');

insert into _ids (key, payload)
select 'open_order', api.gacha_create_order(
  (select id from _ids where key = 'invitee'),
  (select id from _ids where key = 'box'),
  1,
  'tasks-referral-11-1-first-open-order'
);
insert into _ids (key, id)
select 'draw_order', ((select payload from _ids where key = 'open_order') ->> 'draw_order_id')::uuid;

insert into _ids (key, payload)
select 'first_open_unpaid', api.referral_process_first_open(
  (select id from _ids where key = 'invitee'),
  (select id from _ids where key = 'draw_order')
);
select is((select payload ->> 'reason' from _ids where key = 'first_open_unpaid'), 'draw_order_not_successful', 'first-open reward requires a successful draw order');

insert into _ids (key, payload)
select 'process_order', api.gacha_process_dev_paid_order(
  (select id from _ids where key = 'draw_order'),
  (select id from _ids where key = 'invitee')
);
insert into _ids (key, payload)
select 'first_open_repeat', api.referral_process_first_open(
  (select id from _ids where key = 'invitee'),
  (select id from _ids where key = 'draw_order')
);

select ok(((select payload from _ids where key = 'first_open_repeat') ->> 'processed')::boolean, 'first-open reward is processed after a successful draw');
select ok(((select payload from _ids where key = 'first_open_repeat') ->> 'idempotent')::boolean, 'first-open replay for same order is idempotent');
select is((select status from tasks.referrals where id = (select id from _ids where key = 'referral')), 'rewarded', 'referral becomes rewarded after first open');
select is(
  (select count(*)::int from tasks.referral_rewards where referral_id = (select id from _ids where key = 'referral')),
  2,
  'first open writes two referral reward records'
);
select is(
  (
    select count(*)::int
    from tasks.referral_rewards
    where referral_id = (select id from _ids where key = 'referral')
      and ledger_id is not null
  ),
  2,
  'first-open referral rewards point to ledger rows'
);
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 500::numeric, 'inviter receives first-open KCOIN reward once');
select is(testutil.balance_of((select id from _ids where key = 'invitee'), 'KCOIN'), 600::numeric, 'invitee receives first-open reward plus open-box rebate once');
select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where source_type = 'referral_first_open'
      and source_id = (select id from _ids where key = 'referral')
  ),
  2,
  'first-open replay does not duplicate referral reward ledger'
);

select * from finish();

rollback;
