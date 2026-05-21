-- This pgTAP test is designed for the Telegram Mini App blind-box game schema.
-- Run after migrations, RPC files and RLS files have been applied.
-- Each file wraps its fixture data in a transaction and rolls back at the end.

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

create or replace function testutil.balance_of(p_user_id uuid, p_currency_code text)
returns numeric
language sql
stable
as $$
  select coalesce((
    select available_amount
    from economy.user_balances
    where user_id = p_user_id and currency_code = upper(p_currency_code)
  ), 0)::numeric;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;
insert into _ids (key, id) values ('inviter', testutil.make_user(10100000001, 'referral_inviter', null));
insert into _ids (key, txt) select 'invite_code', invite_code from core.users where id = (select id from _ids where key = 'inviter');
insert into _ids (key, id) values ('invitee', testutil.make_user(10100000002, 'referral_invitee', (select txt from _ids where key = 'invite_code')));
insert into _ids (key, id) select 'referral', id from tasks.referrals where invitee_user_id = (select id from _ids where key = 'invitee');

select ok(exists (select 1 from tasks.referrals r where r.id = (select id from _ids where key = 'referral') and r.status = 'pending'), 'auth start_param creates pending referral');

insert into _ids (key, payload) select 'first_open', api.referral_process_first_open((select id from _ids where key = 'invitee'), null);
select ok(((select payload from _ids where key = 'first_open') ->> 'processed')::boolean, 'first-open referral reward is processed');
select is((select status from tasks.referrals where id = (select id from _ids where key = 'referral')), 'rewarded', 'referral becomes rewarded after first open');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 500::numeric, 'inviter receives 500 K-coin first-open reward');
select is(testutil.balance_of((select id from _ids where key = 'invitee'), 'KCOIN'), 500::numeric, 'invitee receives 500 K-coin first-open reward');
select is((select count(*)::int from tasks.referral_rewards where referral_id = (select id from _ids where key = 'referral')), 2, 'two referral reward rows are recorded');

insert into _ids (key, id) values ('commission_source', gen_random_uuid());
insert into _ids (key, payload) select 'commission1', api.referral_create_commission((select id from _ids where key = 'invitee'), (select id from _ids where key = 'commission_source'), 100, 1000);
select ok(((select payload from _ids where key = 'commission1') ->> 'processed')::boolean, 'commission is processed for rewarded referral');
select is(((select payload from _ids where key = 'commission1') ->> 'amount_kcoin')::numeric, 10::numeric, '10% referral commission is calculated from K-coin base amount');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 510::numeric, 'commission credits inviter balance');
select is((select count(*)::int from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')), 1, 'one referral commission row is recorded');

insert into _ids (key, payload) select 'commission_repeat', api.referral_create_commission((select id from _ids where key = 'invitee'), (select id from _ids where key = 'commission_source'), 100, 1000);
select ok(((select payload from _ids where key = 'commission_repeat') ->> 'idempotent')::boolean, 'repeated commission for same source is idempotent');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 510::numeric, 'repeated commission does not credit again');

insert into _ids (key, id) values ('no_ref_user', testutil.make_user(10100000003, 'no_ref_user', null));
insert into _ids (key, payload) select 'no_ref_commission', api.referral_create_commission((select id from _ids where key = 'no_ref_user'), gen_random_uuid(), 100, 1000);
select ok(not ((select payload from _ids where key = 'no_ref_commission') ->> 'processed')::boolean, 'commission is not processed for users without rewarded referral');

select * from finish();

rollback;
