-- Align first-phase gacha draw orders with 第一阶段教学指南.md section 9.
-- The existing schema already has concrete Stars payment links
-- (payment_star_order_id, invoice_payload, total_price_stars). These columns
-- keep the phase-1 payment contract explicit without breaking those fields.

alter table gacha.draw_orders
  add column if not exists payment_provider text,
  add column if not exists payment_status text,
  add column if not exists star_amount integer,
  add column if not exists telegram_invoice_payload text,
  add column if not exists telegram_payment_charge_id text;

comment on column gacha.draw_orders.payment_provider is
  'Phase-1 reserved payment provider, for example dev or telegram_stars.';
comment on column gacha.draw_orders.payment_status is
  'Phase-1 reserved payment status. Formal fulfillment is still decided by backend/RPC.';
comment on column gacha.draw_orders.star_amount is
  'Reserved Telegram Stars amount for the order, mirrored from total_price_stars.';
comment on column gacha.draw_orders.telegram_invoice_payload is
  'Reserved Telegram invoice payload, mirrored from invoice_payload.';
comment on column gacha.draw_orders.telegram_payment_charge_id is
  'Reserved successful_payment charge id. Unique when present to prevent duplicate fulfillment.';

with latest_payment as (
  select distinct on (sp.star_order_id)
    sp.star_order_id,
    sp.telegram_payment_charge_id,
    sp.provider_payment_charge_id
  from payments.star_payments sp
  order by sp.star_order_id, sp.paid_at desc nulls last, sp.created_at desc
)
update gacha.draw_orders d
set
  payment_provider = coalesce(
    d.payment_provider,
    case
      when latest_payment.provider_payment_charge_id = 'dev-paid'
        or latest_payment.telegram_payment_charge_id like 'dev:%'
      then 'dev'
      when d.payment_star_order_id is not null then 'telegram_stars'
      else 'dev'
    end
  ),
  payment_status = coalesce(
    d.payment_status,
    case
      when latest_payment.provider_payment_charge_id = 'dev-paid'
        or latest_payment.telegram_payment_charge_id like 'dev:%'
      then 'dev_paid'
      when latest_payment.telegram_payment_charge_id is not null then 'paid'
      when d.status in ('paid', 'opening', 'opened') then 'paid'
      when d.status = 'invoice_created' then 'pending'
      when d.status in ('failed', 'cancelled', 'expired') then d.status
      else 'created'
    end
  ),
  star_amount = coalesce(d.star_amount, d.total_price_stars),
  telegram_invoice_payload = coalesce(d.telegram_invoice_payload, d.invoice_payload),
  telegram_payment_charge_id = coalesce(d.telegram_payment_charge_id, latest_payment.telegram_payment_charge_id),
  updated_at = now()
from latest_payment
where d.payment_star_order_id = latest_payment.star_order_id;

update gacha.draw_orders d
set
  payment_provider = coalesce(
    d.payment_provider,
    case when d.payment_star_order_id is not null then 'telegram_stars' else 'dev' end
  ),
  payment_status = coalesce(
    d.payment_status,
    case
      when d.telegram_payment_charge_id is not null then 'paid'
      when d.status in ('paid', 'opening', 'opened') then 'paid'
      when d.status = 'invoice_created' then 'pending'
      when d.status in ('failed', 'cancelled', 'expired') then d.status
      else 'created'
    end
  ),
  star_amount = coalesce(d.star_amount, d.total_price_stars),
  telegram_invoice_payload = coalesce(d.telegram_invoice_payload, d.invoice_payload),
  updated_at = now()
where d.payment_provider is null
  or d.payment_status is null
  or d.star_amount is null
  or d.telegram_invoice_payload is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'draw_orders_payment_provider_check'
      and conrelid = 'gacha.draw_orders'::regclass
  ) then
    alter table gacha.draw_orders
      add constraint draw_orders_payment_provider_check
      check (payment_provider is null or payment_provider in ('dev', 'telegram_stars'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'draw_orders_payment_status_check'
      and conrelid = 'gacha.draw_orders'::regclass
  ) then
    alter table gacha.draw_orders
      add constraint draw_orders_payment_status_check
      check (
        payment_status is null
        or payment_status in ('created', 'pending', 'paid', 'dev_paid', 'failed', 'refunded', 'expired', 'cancelled')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'draw_orders_star_amount_check'
      and conrelid = 'gacha.draw_orders'::regclass
  ) then
    alter table gacha.draw_orders
      add constraint draw_orders_star_amount_check
      check (star_amount is null or star_amount > 0);
  end if;
end;
$$;

create unique index if not exists draw_orders_telegram_invoice_payload_uq
  on gacha.draw_orders (telegram_invoice_payload)
  where telegram_invoice_payload is not null;

create unique index if not exists draw_orders_telegram_payment_charge_id_uq
  on gacha.draw_orders (telegram_payment_charge_id)
  where telegram_payment_charge_id is not null;

create index if not exists draw_orders_payment_status_idx
  on gacha.draw_orders (payment_status);

create or replace function gacha.set_draw_order_payment_minimum_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.telegram_invoice_payload is null then
    new.telegram_invoice_payload := new.invoice_payload;
  end if;

  if new.star_amount is null then
    new.star_amount := new.total_price_stars;
  end if;

  if new.payment_provider is null then
    new.payment_provider := case
      when new.payment_star_order_id is null then 'dev'
      else 'telegram_stars'
    end;
  end if;

  if new.telegram_payment_charge_id is not null then
    if new.telegram_payment_charge_id like 'dev:%' then
      new.payment_provider := 'dev';
      new.payment_status := 'dev_paid';
    elsif new.payment_status is null or new.payment_status in ('created', 'pending') then
      new.payment_status := 'paid';
    end if;
  end if;

  if new.payment_status is null then
    new.payment_status := case
      when new.status in ('paid', 'opening', 'opened') then 'paid'
      when new.status = 'invoice_created' then 'pending'
      when new.status in ('failed', 'cancelled', 'expired') then new.status
      else 'created'
    end;
  elsif new.status in ('paid', 'opening', 'opened') and new.payment_status in ('created', 'pending') then
    new.payment_status := 'paid';
  elsif new.status in ('failed', 'cancelled', 'expired') and new.payment_status in ('created', 'pending') then
    new.payment_status := new.status;
  end if;

  return new;
end;
$$;

revoke execute on function gacha.set_draw_order_payment_minimum_fields() from public, anon, authenticated;

drop trigger if exists set_draw_order_payment_minimum_fields on gacha.draw_orders;
create trigger set_draw_order_payment_minimum_fields
before insert or update on gacha.draw_orders
for each row
execute function gacha.set_draw_order_payment_minimum_fields();

create or replace function payments.sync_gacha_draw_order_payment_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update gacha.draw_orders
  set
    telegram_payment_charge_id = coalesce(telegram_payment_charge_id, new.telegram_payment_charge_id),
    payment_provider = case
      when new.provider_payment_charge_id = 'dev-paid'
        or new.telegram_payment_charge_id like 'dev:%'
      then 'dev'
      else coalesce(payment_provider, 'telegram_stars')
    end,
    payment_status = case
      when new.provider_payment_charge_id = 'dev-paid'
        or new.telegram_payment_charge_id like 'dev:%'
      then 'dev_paid'
      else 'paid'
    end,
    updated_at = now()
  where payment_star_order_id = new.star_order_id
    and (
      telegram_payment_charge_id is null
      or telegram_payment_charge_id = new.telegram_payment_charge_id
    );

  return new;
end;
$$;

revoke execute on function payments.sync_gacha_draw_order_payment_fields() from public, anon, authenticated;

drop trigger if exists sync_gacha_draw_order_payment_fields on payments.star_payments;
create trigger sync_gacha_draw_order_payment_fields
after insert on payments.star_payments
for each row
execute function payments.sync_gacha_draw_order_payment_fields();
