-- Phase 6 payment status standardization checks.

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

grant usage on schema testutil to public;
grant execute on function testutil.raises_like(text, text) to public;

select plan(6);

create temp table _ids (key text primary key, id uuid) on commit drop;

insert into _ids (key, id)
values
  ('user', gen_random_uuid()),
  ('fulfilled_order', gen_random_uuid()),
  ('disputed_order', gen_random_uuid()),
  ('refunded_order', gen_random_uuid());

insert into core.users (id, telegram_user_id, username, first_name, status)
values (
  (select id from _ids where key = 'user'),
  880061601,
  'phase6_payment_status_user',
  'Phase6 Payment Status',
  'active'
);

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  idempotency_key,
  paid_at,
  fulfilled_at
)
values
  (
    (select id from _ids where key = 'fulfilled_order'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'fulfilled',
    10,
    'phase6-payment-status-fulfilled',
    'Phase 6 fulfilled',
    'phase6-payment-status-fulfilled',
    now() - interval '2 minutes',
    now() - interval '1 minute'
  ),
  (
    (select id from _ids where key = 'disputed_order'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'disputed',
    10,
    'phase6-payment-status-disputed',
    'Phase 6 disputed',
    'phase6-payment-status-disputed',
    now() - interval '2 minutes',
    null
  ),
  (
    (select id from _ids where key = 'refunded_order'),
    (select id from _ids where key = 'user'),
    'gacha_open',
    'refunded',
    10,
    'phase6-payment-status-refunded',
    'Phase 6 refunded',
    'phase6-payment-status-refunded',
    now() - interval '2 minutes',
    null
  );

select ok(
  to_regprocedure('payments.enforce_star_order_status_transition()') is not null
    and exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'payments'
        and c.relname = 'star_orders'
        and t.tgname = 'star_orders_enforce_status_transition'
        and not t.tgisinternal
    ),
  'star_orders status transition trigger exists'
);

select ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'payments'
      and c.relname = 'star_orders'
      and con.conname = 'star_orders_status_check'
      and pg_get_constraintdef(con.oid) like '%created%'
      and pg_get_constraintdef(con.oid) like '%precheckout_checked%'
      and pg_get_constraintdef(con.oid) like '%paid%'
      and pg_get_constraintdef(con.oid) like '%fulfilling%'
      and pg_get_constraintdef(con.oid) like '%fulfilled%'
      and pg_get_constraintdef(con.oid) like '%failed%'
      and pg_get_constraintdef(con.oid) like '%refunded%'
      and pg_get_constraintdef(con.oid) like '%disputed%'
      and pg_get_constraintdef(con.oid) like '%expired%'
  ),
  'star_orders status check includes every canonical Phase 6 payment status'
);

select ok(
  testutil.raises_like(
    format(
      'update payments.star_orders set status = %L where id = %L::uuid',
      'paid',
      (select id from _ids where key = 'fulfilled_order')
    ),
    '%STAR_ORDER_STATUS_IRREVERSIBLE%'
  ),
  'fulfilled orders cannot regress to paid'
);

update payments.star_orders
set status = 'disputed'
where id = (select id from _ids where key = 'fulfilled_order');

select is(
  (
    select status
    from payments.star_orders
    where id = (select id from _ids where key = 'fulfilled_order')
  ),
  'disputed',
  'fulfilled orders can move to disputed for admin compensation'
);

update payments.star_orders
set status = 'refunded'
where id = (select id from _ids where key = 'disputed_order');

select is(
  (
    select status
    from payments.star_orders
    where id = (select id from _ids where key = 'disputed_order')
  ),
  'refunded',
  'disputed orders can move to refunded after compensation'
);

select ok(
  testutil.raises_like(
    format(
      'update payments.star_orders set status = %L where id = %L::uuid',
      'paid',
      (select id from _ids where key = 'refunded_order')
    ),
    '%STAR_ORDER_STATUS_IRREVERSIBLE%'
  ),
  'refunded orders cannot regress to paid'
);

select * from finish();

rollback;
