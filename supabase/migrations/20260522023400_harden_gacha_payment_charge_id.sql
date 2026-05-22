-- Block first-phase gacha fulfillment unless the matching successful_payment
-- row was recorded for the same Stars order. This closes the edge case where
-- a reused telegram_payment_charge_id conflicts in payments.star_payments but
-- the draw order would otherwise continue opening.

create or replace function gacha.require_paid_star_payment_before_opened()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'opened' and old.status is distinct from 'opened' then
    if new.payment_star_order_id is null then
      raise exception 'draw order payment_star_order_id is required before opening';
    end if;

    if not exists (
      select 1
      from payments.star_payments sp
      where sp.star_order_id = new.payment_star_order_id
    ) then
      raise exception 'successful payment not recorded for draw order';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function gacha.require_paid_star_payment_before_opened()
  from public, anon, authenticated;

drop trigger if exists require_paid_star_payment_before_opened on gacha.draw_orders;
create trigger require_paid_star_payment_before_opened
before update of status on gacha.draw_orders
for each row
execute function gacha.require_paid_star_payment_before_opened();
