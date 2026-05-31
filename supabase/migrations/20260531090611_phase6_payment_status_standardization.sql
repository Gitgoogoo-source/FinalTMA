-- Phase 6 payment status standardization.
-- Canonical payment order statuses are:
-- created / precheckout_checked / paid / fulfilling / fulfilled / failed /
-- refunded / disputed / expired.
--
-- The existing check constraint still accepts legacy values used by older
-- migrations. This trigger prevents terminal orders from regressing into
-- active payment states while keeping refund/dispute compensation possible.

begin;

create or replace function payments.enforce_star_order_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'fulfilled'
     and new.status not in ('fulfilled', 'refunded', 'disputed') then
    raise exception 'STAR_ORDER_STATUS_IRREVERSIBLE'
      using errcode = 'P0001',
            detail = 'fulfilled payment orders cannot move back to active, failed, or expired states',
            hint = 'Use refunded or disputed for admin compensation outcomes.';
  end if;

  if old.status = 'refunded'
     and new.status <> 'refunded' then
    raise exception 'STAR_ORDER_STATUS_IRREVERSIBLE'
      using errcode = 'P0001',
            detail = 'refunded payment orders are terminal';
  end if;

  if old.status = 'disputed'
     and new.status not in ('disputed', 'refunded') then
    raise exception 'STAR_ORDER_STATUS_IRREVERSIBLE'
      using errcode = 'P0001',
            detail = 'disputed payment orders can only remain disputed or become refunded';
  end if;

  return new;
end;
$$;

drop trigger if exists star_orders_enforce_status_transition on payments.star_orders;

create trigger star_orders_enforce_status_transition
before update of status on payments.star_orders
for each row
execute function payments.enforce_star_order_status_transition();

revoke all on function payments.enforce_star_order_status_transition()
from public, anon, authenticated;

comment on function payments.enforce_star_order_status_transition() is
  'Prevents canonical Telegram Stars payment statuses from regressing after fulfilled/refunded/disputed terminal states.';

commit;
