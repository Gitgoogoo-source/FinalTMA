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
insert into _ids (key, id) select 'box', id from gacha.blind_boxes where slug = 'starter_egg';

select ok(exists (select 1 from tasks.referrals r where r.id = (select id from _ids where key = 'referral') and r.status = 'pending'), 'auth start_param creates pending referral');

insert into _ids (key, payload)
select 'open_order', api.gacha_create_order((select id from _ids where key = 'invitee'), (select id from _ids where key = 'box'), 1, 'referral-first-open-order-001');
insert into _ids (key, id) select 'draw_order', ((select payload from _ids where key = 'open_order') ->> 'draw_order_id')::uuid;

insert into _ids (key, payload)
select 'first_open_unpaid', api.referral_process_first_open((select id from _ids where key = 'invitee'), (select id from _ids where key = 'draw_order'));
select ok(not ((select payload from _ids where key = 'first_open_unpaid') ->> 'processed')::boolean, 'unopened draw order does not trigger first-open reward');
select is((select payload ->> 'reason' from _ids where key = 'first_open_unpaid'), 'draw_order_not_successful', 'first-open reward requires successful draw results');

insert into _ids (key, payload)
select 'process_order', api.gacha_process_dev_paid_order((select id from _ids where key = 'draw_order'), (select id from _ids where key = 'invitee'));

insert into _ids (key, payload)
select 'first_open', api.referral_process_first_open((select id from _ids where key = 'invitee'), (select id from _ids where key = 'draw_order'));
select ok(((select payload from _ids where key = 'first_open') ->> 'processed')::boolean, 'first-open referral reward is processed');
select ok(((select payload from _ids where key = 'first_open') ->> 'idempotent')::boolean, 'repeated first-open call for same draw order is idempotent');
select is((select status from tasks.referrals where id = (select id from _ids where key = 'referral')), 'rewarded', 'referral becomes rewarded after first open');
select is((select first_open_order_id from tasks.referrals where id = (select id from _ids where key = 'referral')), (select id from _ids where key = 'draw_order'), 'referral stores first-open draw order');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 500::numeric, 'inviter receives 500 K-coin first-open reward');
select is(testutil.balance_of((select id from _ids where key = 'invitee'), 'KCOIN'), 600::numeric, 'invitee receives 500 K-coin first-open reward plus 100 open rebate');
select is((select count(*)::int from tasks.referral_rewards where referral_id = (select id from _ids where key = 'referral')), 2, 'two referral reward rows are recorded');

insert into _ids (key, id) select 'commission_source', (select id from _ids where key = 'draw_order');
insert into _ids (key, payload) select 'commission1', api.referral_create_commission((select id from _ids where key = 'invitee'), (select id from _ids where key = 'commission_source'), 100, 1000);
select ok(((select payload from _ids where key = 'commission1') ->> 'processed')::boolean, 'commission is processed for rewarded referral');
select is(((select payload from _ids where key = 'commission1') ->> 'amount_kcoin')::numeric, 10::numeric, '10% referral commission is calculated from K-coin base amount');
select is(((select payload from _ids where key = 'commission1') ->> 'status'), 'pending', 'commission is generated as pending');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 500::numeric, 'pending commission does not credit inviter balance');
select is((select count(*)::int from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')), 1, 'one referral commission row is recorded');
select is((select status from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')), 'pending', 'commission row remains pending before claim');
select ok((select ledger_id is null from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')), 'pending commission has no ledger id before claim');
select ok((select claimed_at is null from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')), 'pending commission has no claimed_at before claim');

insert into _ids (key, payload) select 'commission_repeat', api.referral_create_commission((select id from _ids where key = 'invitee'), (select id from _ids where key = 'commission_source'), 100, 1000);
select ok(((select payload from _ids where key = 'commission_repeat') ->> 'idempotent')::boolean, 'repeated commission for same source is idempotent');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 500::numeric, 'repeated commission still does not credit before claim');

insert into _ids (key, payload)
select 'claim_commission1', api.referral_claim_commission((select id from _ids where key = 'inviter'), null, 'referral-commission-claim-001');
select ok(((select payload from _ids where key = 'claim_commission1') ->> 'claimed')::boolean, 'pending commission can be claimed');
select is(((select payload from _ids where key = 'claim_commission1') ->> 'claimed_count')::int, 1, 'claim covers one pending commission');
select is(((select payload from _ids where key = 'claim_commission1') ->> 'claimed_amount_kcoin')::numeric, 10::numeric, 'claim amount equals pending commission amount');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 510::numeric, 'claim credits inviter balance');
select is((select status from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')), 'granted', 'claimed commission becomes granted');
select ok((select ledger_id is not null from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')), 'claimed commission stores ledger id');
select ok((select claimed_at is not null from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')), 'claimed commission stores claimed_at');
select ok(exists (
  select 1
  from economy.currency_ledger
  where id = (select ledger_id from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral'))
    and user_id = (select id from _ids where key = 'inviter')
    and source_type = 'referral_commission_claim'
    and entry_type = 'credit'
    and currency_code = 'KCOIN'
    and amount = 10
    and idempotency_key = 'referral_commission_claim:referral-commission-claim-001'
), 'claim writes one KCOIN ledger entry');

insert into _ids (key, payload)
select 'claim_commission_repeat', api.referral_claim_commission((select id from _ids where key = 'inviter'), null, 'referral-commission-claim-001');
select ok(((select payload from _ids where key = 'claim_commission_repeat') ->> 'idempotent')::boolean, 'repeated claim with same key returns idempotent=true');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 510::numeric, 'repeated claim does not credit again');
select is((select count(*)::int from economy.currency_ledger where idempotency_key = 'referral_commission_claim:referral-commission-claim-001'), 1, 'repeated claim does not write duplicate ledger');

insert into _ids (key, payload)
select 'claim_commission_empty', api.referral_claim_commission((select id from _ids where key = 'inviter'), null, 'referral-commission-claim-empty');
select ok(not ((select payload from _ids where key = 'claim_commission_empty') ->> 'claimed')::boolean, 'claim with no pending commissions returns claimed=false');
select is(((select payload from _ids where key = 'claim_commission_empty') ->> 'claimed_amount_kcoin')::numeric, 0::numeric, 'no-pending claim returns zero amount');

insert into _ids (key, id) values ('no_ref_user', testutil.make_user(10100000003, 'no_ref_user', null));
insert into _ids (key, payload) select 'no_ref_commission', api.referral_create_commission((select id from _ids where key = 'no_ref_user'), gen_random_uuid(), 100, 1000);
select ok(not ((select payload from _ids where key = 'no_ref_commission') ->> 'processed')::boolean, 'commission is not processed for users without rewarded referral');

select * from finish();

rollback;
