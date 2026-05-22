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
insert into _ids (key, id) values ('user', testutil.make_user(9200000001, 'ledger_user', null));

insert into _ids (key, payload)
select 'credit1', api.economy_credit(
  p_user_id := (select id from _ids where key = 'user'),
  p_currency_code := 'KCOIN',
  p_amount := 1000,
  p_source_type := 'test_credit',
  p_source_id := null,
  p_source_ref := 'ledger-case-1',
  p_idempotency_key := 'ledger-credit-001',
  p_note := 'pgTAP credit',
  p_metadata := '{"case":"ledger"}'::jsonb
);

select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 1000::numeric, 'credit increases available KCOIN balance');
select is((select count(*)::int from economy.currency_ledger where idempotency_key = 'ledger-credit-001'), 1, 'credit writes one immutable ledger row');
select is((select available_before from economy.currency_ledger where idempotency_key = 'ledger-credit-001'), 0::numeric, 'credit ledger records available_before');
select is((select available_after from economy.currency_ledger where idempotency_key = 'ledger-credit-001'), 1000::numeric, 'credit ledger records available_after');
select is((select locked_before from economy.currency_ledger where idempotency_key = 'ledger-credit-001'), 0::numeric, 'credit ledger records locked_before');
select is((select locked_after from economy.currency_ledger where idempotency_key = 'ledger-credit-001'), 0::numeric, 'credit ledger records locked_after');

insert into _ids (key, payload)
select 'credit1_repeat', api.economy_credit(
  p_user_id := (select id from _ids where key = 'user'),
  p_currency_code := 'KCOIN',
  p_amount := 1000,
  p_source_type := 'test_credit',
  p_source_id := null,
  p_source_ref := 'ledger-case-1',
  p_idempotency_key := 'ledger-credit-001',
  p_note := 'pgTAP duplicate credit',
  p_metadata := '{"case":"ledger_duplicate"}'::jsonb
);

select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 1000::numeric, 'idempotent repeated credit does not double-credit');
select ok(((select payload from _ids where key = 'credit1_repeat') ->> 'idempotent')::boolean, 'repeated credit returns idempotent=true');

insert into _ids (key, payload)
select 'debit1', api.economy_debit(
  p_user_id := (select id from _ids where key = 'user'),
  p_currency_code := 'KCOIN',
  p_amount := 300,
  p_source_type := 'test_debit',
  p_source_id := null,
  p_source_ref := 'ledger-case-2',
  p_idempotency_key := 'ledger-debit-001',
  p_note := 'pgTAP debit',
  p_metadata := '{"case":"ledger"}'::jsonb
);

select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 700::numeric, 'debit decreases available KCOIN balance');
select is((select available_before from economy.currency_ledger where idempotency_key = 'ledger-debit-001'), 1000::numeric, 'debit ledger records available_before');
select is((select available_after from economy.currency_ledger where idempotency_key = 'ledger-debit-001'), 700::numeric, 'debit ledger records available_after');
select is((select locked_before from economy.currency_ledger where idempotency_key = 'ledger-debit-001'), 0::numeric, 'debit ledger records locked_before');
select is((select locked_after from economy.currency_ledger where idempotency_key = 'ledger-debit-001'), 0::numeric, 'debit ledger records locked_after');
select is((select total_spent from economy.user_balances b join _ids i on i.id = b.user_id where i.key = 'user' and b.currency_code = 'KCOIN'), 300::numeric, 'total_spent tracks debit amount');
select ok(testutil.raises_like(format('select api.economy_debit(%L::uuid, %L, 999999, %L)', (select id::text from _ids where key = 'user'), 'KCOIN', 'overdraft_test'), '%insufficient balance%'), 'debit rejects insufficient balance');

insert into _ids (key, payload)
select 'lock1', api.economy_lock_balance(
  p_user_id := (select id from _ids where key = 'user'),
  p_currency_code := 'KCOIN',
  p_amount := 200,
  p_lock_type := 'market_buy',
  p_source_type := 'test_lock',
  p_source_id := null,
  p_expires_at := now() + interval '1 day',
  p_idempotency_key := 'ledger-lock-001',
  p_note := 'pgTAP lock',
  p_metadata := '{"case":"ledger_lock"}'::jsonb
);

insert into _ids (key, id) select 'lock_id', ((select payload from _ids where key = 'lock1') ->> 'lock_id')::uuid;
select is((select available_amount from economy.user_balances b join _ids i on i.id = b.user_id where i.key = 'user' and b.currency_code = 'KCOIN'), 500::numeric, 'lock moves amount out of available balance');
select is((select locked_amount from economy.user_balances b join _ids i on i.id = b.user_id where i.key = 'user' and b.currency_code = 'KCOIN'), 200::numeric, 'lock increases locked balance');
select is((select available_before from economy.currency_ledger where idempotency_key = 'ledger-lock-001'), 700::numeric, 'lock ledger records available_before');
select is((select available_after from economy.currency_ledger where idempotency_key = 'ledger-lock-001'), 500::numeric, 'lock ledger records available_after');
select is((select locked_before from economy.currency_ledger where idempotency_key = 'ledger-lock-001'), 0::numeric, 'lock ledger records locked_before');
select is((select locked_after from economy.currency_ledger where idempotency_key = 'ledger-lock-001'), 200::numeric, 'lock ledger records locked_after');
select ok(exists (select 1 from economy.balance_locks l join _ids i on i.id = l.id where i.key = 'lock_id' and l.status = 'active'), 'balance lock row is active');

insert into _ids (key, payload)
select 'unlock1', api.economy_unlock_balance(
  p_lock_id := (select id from _ids where key = 'lock_id'),
  p_mode := 'release',
  p_idempotency_key := 'ledger-unlock-001',
  p_note := 'pgTAP release',
  p_metadata := '{"case":"ledger_unlock"}'::jsonb
);

select is((select available_amount from economy.user_balances b join _ids i on i.id = b.user_id where i.key = 'user' and b.currency_code = 'KCOIN'), 700::numeric, 'unlock release restores available balance');
select is((select locked_amount from economy.user_balances b join _ids i on i.id = b.user_id where i.key = 'user' and b.currency_code = 'KCOIN'), 0::numeric, 'unlock release clears locked balance');
select is((select available_before from economy.currency_ledger where idempotency_key = 'ledger-unlock-001'), 500::numeric, 'unlock ledger records available_before');
select is((select available_after from economy.currency_ledger where idempotency_key = 'ledger-unlock-001'), 700::numeric, 'unlock ledger records available_after');
select is((select locked_before from economy.currency_ledger where idempotency_key = 'ledger-unlock-001'), 200::numeric, 'unlock ledger records locked_before');
select is((select locked_after from economy.currency_ledger where idempotency_key = 'ledger-unlock-001'), 0::numeric, 'unlock ledger records locked_after');
select ok(exists (select 1 from economy.balance_locks l join _ids i on i.id = l.id where i.key = 'lock_id' and l.status = 'released'), 'balance lock row is released');
select is(
  (
    select available_amount
    from economy.user_balances
    where user_id = (select id from _ids where key = 'user')
      and currency_code = 'KCOIN'
  ),
  (
    select coalesce(sum(case
      when entry_type in ('credit', 'refund') then amount
      when entry_type = 'unlock' then amount
      when entry_type in ('debit', 'fee', 'lock') then -amount
      when entry_type = 'adjustment' then amount
      when entry_type = 'reversal' then 0
      else 0
    end), 0)
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and currency_code = 'KCOIN'
  ),
  'available balance equals signed ledger total after credit, debit, lock and unlock'
);
select is(
  (
    select locked_amount
    from economy.user_balances
    where user_id = (select id from _ids where key = 'user')
      and currency_code = 'KCOIN'
  ),
  (
    select coalesce(sum(case
      when entry_type = 'lock' then amount
      when entry_type = 'unlock' then -amount
      else 0
    end), 0)
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and currency_code = 'KCOIN'
  ),
  'locked balance equals lock ledger total after release'
);
select ok(testutil.raises_like(format('update economy.currency_ledger set note = %L where id = %L::uuid', 'mutate forbidden', ((select payload from _ids where key = 'credit1') ->> 'ledger_id')), '%immutable%'), 'ledger update is blocked by immutable trigger');
select ok(testutil.raises_like(format('delete from economy.currency_ledger where id = %L::uuid', ((select payload from _ids where key = 'credit1') ->> 'ledger_id')), '%immutable%'), 'ledger delete is blocked by immutable trigger');

select * from finish();

rollback;
