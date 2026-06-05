-- Allow trusted KCOIN gacha fulfillment to complete only after the matching
-- immutable debit ledger entry exists. Stars and VIP daily free guards keep
-- their existing proof requirements.

create or replace function gacha.require_paid_star_payment_before_opened()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('opened', 'completed')
     and old.status not in ('opened', 'completed') then
    if new.payment_star_order_id is null then
      if new.total_price_stars = 0
         and coalesce(new.star_amount, 0) = 0
         and new.payment_provider = 'vip_daily_free'
         and new.payment_status = 'paid'
         and coalesce(new.metadata ->> 'source_type', '') = 'vip_daily_free_box' then
        return new;
      end if;

      if new.payment_provider = 'kcoin'
         and new.payment_status = 'paid'
         and coalesce(new.star_amount, 0) = 0
         and new.total_price_stars > 0
         and coalesce(new.metadata ->> 'currency_code', '') = 'KCOIN'
         and exists (
           select 1
           from economy.currency_ledger ledger
           where ledger.user_id = new.user_id
             and ledger.currency_code = 'KCOIN'
             and ledger.entry_type = 'debit'
             and ledger.amount = new.total_price_stars::numeric
             and ledger.source_type = 'gacha_open'
             and ledger.source_id = new.id
             and ledger.idempotency_key = 'gacha_open:kcoin:' || new.id::text
         ) then
        return new;
      end if;

      if new.payment_provider = 'kcoin' then
        raise exception 'matching KCOIN debit ledger is required before opening';
      end if;

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

comment on function gacha.require_paid_star_payment_before_opened() is
  'Guards gacha completion: Stars need successful_payment, VIP daily free needs its entitlement metadata, KCOIN needs the matching immutable debit ledger.';
