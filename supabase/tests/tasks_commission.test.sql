-- Phase 4 / 11.1 referral commission database acceptance checks.

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

insert into ops.system_settings (key, value, description)
values (
  'REFERRAL_COMMISSION_BPS',
  '{"commission_bps":1000}'::jsonb,
  '11.1 commission test rate.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

insert into _ids (key, id) values
  ('inviter', testutil.make_user(11110300001, 'tasks_commission_11_1_inviter', null)),
  ('invitee', testutil.make_user(11110300002, 'tasks_commission_11_1_invitee', null));
insert into _ids (key, txt)
select 'invite_code', invite_code from core.users where id = (select id from _ids where key = 'inviter');
insert into _ids (key, id)
select 'box', id from gacha.blind_boxes where slug = 'starter_egg';

insert into _ids (key, payload)
values (
  'bind_referral',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'invite_code'),
    'tasks-commission-11-1-bind',
    '{}'::jsonb
  )
);
insert into _ids (key, id)
select 'referral', id from tasks.referrals where invitee_user_id = (select id from _ids where key = 'invitee');

insert into _ids (key, payload)
select 'first_open_order', api.gacha_create_order(
  (select id from _ids where key = 'invitee'),
  (select id from _ids where key = 'box'),
  1,
  'tasks-commission-11-1-first-open'
);
insert into _ids (key, id)
select 'first_draw_order', ((select payload from _ids where key = 'first_open_order') ->> 'draw_order_id')::uuid;
insert into _ids (key, payload)
select 'first_process_order', api.gacha_process_dev_paid_order(
  (select id from _ids where key = 'first_draw_order'),
  (select id from _ids where key = 'invitee')
);

select is(
  (select count(*)::int from tasks.referral_commissions where referral_id = (select id from _ids where key = 'referral')),
  0,
  'first-open order does not create commission'
);

insert into _ids (key, payload)
select 'second_open_order', api.gacha_create_order(
  (select id from _ids where key = 'invitee'),
  (select id from _ids where key = 'box'),
  1,
  'tasks-commission-11-1-second-open'
);
insert into _ids (key, id)
select 'second_draw_order', ((select payload from _ids where key = 'second_open_order') ->> 'draw_order_id')::uuid;
insert into _ids (key, payload)
select 'second_process_order', api.gacha_process_dev_paid_order(
  (select id from _ids where key = 'second_draw_order'),
  (select id from _ids where key = 'invitee')
);
insert into _ids (key, id)
select 'commission', id
from tasks.referral_commissions
where referral_id = (select id from _ids where key = 'referral')
  and source_id = (select id from _ids where key = 'second_draw_order');

select is(
  (
    select status
    from tasks.referral_commissions
    where id = (select id from _ids where key = 'commission')
  ),
  'pending',
  'second successful open creates a pending commission'
);
select is(
  (
    select commission_amount_kcoin
    from tasks.referral_commissions
    where id = (select id from _ids where key = 'commission')
  ),
  10::numeric,
  'commission amount is calculated from the configured 10 percent rate'
);
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 500::numeric, 'pending commission does not credit inviter before claim');

insert into _ids (key, payload)
select 'commission_repeat', api.referral_create_commission(
  (select id from _ids where key = 'invitee'),
  (select id from _ids where key = 'second_draw_order'),
  100,
  1000
);
select ok(((select payload from _ids where key = 'commission_repeat') ->> 'idempotent')::boolean, 'repeated commission generation for same order is idempotent');
select is(
  (
    select count(*)::int
    from tasks.referral_commissions
    where referral_id = (select id from _ids where key = 'referral')
      and source_id = (select id from _ids where key = 'second_draw_order')
  ),
  1,
  'repeated commission generation does not duplicate commission rows'
);

insert into _ids (key, payload)
select 'claim_commission', api.referral_claim_commission(
  (select id from _ids where key = 'inviter'),
  null,
  'tasks-commission-11-1-claim'
);
insert into _ids (key, id)
select 'commission_ledger', ((select payload from _ids where key = 'claim_commission') ->> 'ledger_id')::uuid;

select ok(((select payload from _ids where key = 'claim_commission') ->> 'claimed')::boolean, 'pending commission can be claimed');
select is(((select payload from _ids where key = 'claim_commission') ->> 'claimed_amount_kcoin')::numeric, 10::numeric, 'claim amount equals pending commission amount');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 510::numeric, 'claim credits inviter balance');
select is(
  (select status from tasks.referral_commissions where id = (select id from _ids where key = 'commission')),
  'granted',
  'claimed commission becomes granted'
);
select is(
  (select ledger_id from tasks.referral_commissions where id = (select id from _ids where key = 'commission')),
  (select id from _ids where key = 'commission_ledger'),
  'claimed commission stores claim ledger id'
);
select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where id = (select id from _ids where key = 'commission_ledger')
      and user_id = (select id from _ids where key = 'inviter')
      and source_type = 'referral_commission_claim'
      and currency_code = 'KCOIN'
      and amount = 10
  ),
  1,
  'commission claim writes one KCOIN ledger row'
);

insert into _ids (key, payload)
select 'claim_commission_repeat', api.referral_claim_commission(
  (select id from _ids where key = 'inviter'),
  null,
  'tasks-commission-11-1-claim'
);
select ok(((select payload from _ids where key = 'claim_commission_repeat') ->> 'idempotent')::boolean, 'repeated commission claim with same key is idempotent');
select is(testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'), 510::numeric, 'repeated commission claim does not credit again');
select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where idempotency_key = 'referral_commission_claim:tasks-commission-11-1-claim'
  ),
  1,
  'repeated commission claim does not duplicate ledger'
);

insert into _ids (key, payload)
select 'claim_commission_empty', api.referral_claim_commission(
  (select id from _ids where key = 'inviter'),
  null,
  'tasks-commission-11-1-empty'
);
select ok(not ((select payload from _ids where key = 'claim_commission_empty') ->> 'claimed')::boolean, 'claim with no pending commission returns claimed=false');

select * from finish();

rollback;
