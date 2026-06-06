-- Move VIP monthly card purchase from Telegram Stars to internal KCOIN.
--
-- Historical VIP Stars orders are left intact. New VIP purchases debit KCOIN
-- in one trusted transaction and activate/extend the subscription immediately.

begin;

alter table vip.vip_plans
  add column if not exists price_kcoin integer;

update vip.vip_plans
set price_kcoin = coalesce(price_kcoin, price_xtr)
where price_kcoin is null;

alter table vip.vip_plans
  alter column price_kcoin set not null,
  drop constraint if exists vip_plans_price_kcoin_check,
  add constraint vip_plans_price_kcoin_check check (price_kcoin > 0);

comment on column vip.vip_plans.price_kcoin is
  'Trusted display/config price for VIP monthly card in internal KCOIN. The Vercel API still passes the final server-side KCOIN price to the purchase RPC.';

update vip.vip_plans
set benefits = benefits || jsonb_build_object(
      'price_kcoin', price_kcoin,
      'payment_currency', 'KCOIN'
    ),
    updated_at = now()
where code = 'vip_monthly';

alter table vip.vip_orders
  add column if not exists payment_currency_code text not null default 'XTR',
  add column if not exists kcoin_amount numeric(38,0),
  add column if not exists kcoin_ledger_id uuid references economy.currency_ledger(id) on delete set null;

alter table vip.vip_orders
  alter column xtr_amount drop not null,
  drop constraint if exists vip_orders_xtr_amount_check,
  add constraint vip_orders_xtr_amount_check check (xtr_amount is null or xtr_amount > 0),
  drop constraint if exists vip_orders_payment_currency_code_check,
  add constraint vip_orders_payment_currency_code_check check (payment_currency_code in ('XTR', 'KCOIN')),
  drop constraint if exists vip_orders_kcoin_amount_check,
  add constraint vip_orders_kcoin_amount_check check (kcoin_amount is null or kcoin_amount > 0),
  drop constraint if exists vip_orders_payment_amount_check,
  add constraint vip_orders_payment_amount_check check (
    (payment_currency_code = 'XTR' and xtr_amount is not null and kcoin_amount is null)
    or
    (payment_currency_code = 'KCOIN' and kcoin_amount is not null and xtr_amount is null)
  );

comment on column vip.vip_orders.payment_currency_code is
  'Payment rail used for this VIP order. New monthly card purchases use KCOIN; legacy orders may use XTR.';
comment on column vip.vip_orders.kcoin_amount is
  'KCOIN amount debited for this VIP order when payment_currency_code is KCOIN.';
comment on column vip.vip_orders.kcoin_ledger_id is
  'economy.currency_ledger debit row for a KCOIN-paid VIP order.';

create index if not exists vip_orders_kcoin_ledger_idx
  on vip.vip_orders (kcoin_ledger_id)
  where kcoin_ledger_id is not null;

create or replace function api.vip_get_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user core.users%rowtype;
  v_plan vip.vip_plans%rowtype;
  v_subscription vip.vip_subscriptions%rowtype;
  v_claim vip.vip_daily_claims%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_is_vip boolean := false;
  v_fgems_claimed boolean := false;
  v_free_box_claimed boolean := false;
  v_plan_daily_fgems numeric(38,0) := 0;
  v_plan_daily_free_box_count integer := 0;
  v_remaining_free_box_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select * into v_user
  from core.users
  where id = p_user_id;

  if v_user.id is null then
    raise exception 'user not found';
  end if;

  select * into v_plan
  from vip.vip_plans
  where code = 'vip_monthly'
    and status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_plan.id is not null then
    v_plan_daily_fgems := coalesce(v_plan.daily_fgems, 0);
    v_plan_daily_free_box_count := coalesce(v_plan.daily_free_box_count, 0);
  end if;

  select * into v_subscription
  from vip.vip_subscriptions
  where user_id = p_user_id
    and status = 'active'
    and current_period_end > now()
  order by current_period_end desc
  limit 1;

  v_is_vip := v_subscription.id is not null;

  if v_is_vip then
    select * into v_claim
    from vip.vip_daily_claims
    where user_id = p_user_id
      and claim_date = v_today
    limit 1;
  end if;

  v_fgems_claimed := v_claim.id is not null and v_claim.fgems_claimed_at is not null;
  v_free_box_claimed := v_claim.id is not null and v_claim.free_box_claimed_at is not null;

  if v_free_box_claimed then
    v_remaining_free_box_count := greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0);
  end if;

  return jsonb_build_object(
    'is_vip', v_is_vip,
    'subscription_id', v_subscription.id,
    'current_period_start', v_subscription.current_period_start,
    'current_period_end', v_subscription.current_period_end,
    'auto_renew_enabled', coalesce(v_subscription.auto_renew_enabled, false),
    'plan',
      case when v_plan.id is null then null else jsonb_build_object(
        'id', v_plan.id,
        'code', v_plan.code,
        'display_name', v_plan.display_name,
        'price_xtr', v_plan.price_xtr,
        'price_kcoin', v_plan.price_kcoin,
        'currency_code', 'KCOIN',
        'duration_days', v_plan.duration_days,
        'subscription_period_seconds', v_plan.subscription_period_seconds,
        'daily_fgems', v_plan.daily_fgems,
        'daily_free_box_count', v_plan.daily_free_box_count,
        'fee_rebate_bps', v_plan.fee_rebate_bps,
        'badge_code', v_plan.badge_code,
        'benefits', v_plan.benefits
      ) end,
    'today', jsonb_build_object(
      'business_date_utc', v_today,
      'claim_id', v_claim.id,
      'claimed', v_fgems_claimed,
      'can_claim', v_is_vip and not v_fgems_claimed and v_plan_daily_fgems > 0,
      'fgems_amount', v_plan_daily_fgems,
      'fgems_claimed', v_fgems_claimed,
      'fgems_claimed_at', v_claim.fgems_claimed_at,
      'can_claim_fgems', v_is_vip and not v_fgems_claimed and v_plan_daily_fgems > 0,
      'free_box_count', coalesce(nullif(v_claim.free_box_count, 0), v_plan_daily_free_box_count, 0),
      'free_box_used_count', coalesce(v_claim.free_box_used_count, 0),
      'remaining_free_box_count', v_remaining_free_box_count,
      'free_box_claimed', v_free_box_claimed,
      'free_box_claimed_at', v_claim.free_box_claimed_at,
      'can_claim_free_box', v_is_vip and not v_free_box_claimed and v_plan_daily_free_box_count > 0,
      'free_box_available', v_free_box_claimed and v_remaining_free_box_count > 0
    ),
    'server_time', now()
  );
end;
$$;

create or replace function api.vip_create_order_with_server_kcoin_checked(
  p_user_id uuid,
  p_plan_id uuid,
  p_idempotency_key text,
  p_server_price_kcoin integer,
  p_expected_price_kcoin integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_status text;
  v_plan vip.vip_plans%rowtype;
  v_existing_order vip.vip_orders%rowtype;
  v_existing_subscription vip.vip_subscriptions%rowtype;
  v_subscription_id uuid;
  v_vip_order_id uuid := pg_catalog.gen_random_uuid();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_payload text;
  v_available_kcoin numeric(38,0) := 0;
  v_shortage_kcoin numeric(38,0) := 0;
  v_debit jsonb;
  v_debit_ledger_id uuid;
  v_effective_start timestamptz;
  v_effective_end timestamptz;
  v_subscription_start timestamptz;
  v_subscription_end timestamptz;
  v_now timestamptz := now();
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_plan_id is null then
    raise exception 'plan_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;
  if p_server_price_kcoin is null or p_server_price_kcoin <= 0 then
    raise exception 'server price kcoin is invalid';
  end if;
  if p_expected_price_kcoin is not null and p_expected_price_kcoin <> p_server_price_kcoin then
    raise exception 'expected price changed';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_create_order_with_server_kcoin_checked'),
    pg_catalog.hashtext(v_key)
  );

  select status into v_user_status
  from core.users
  where id = p_user_id
  for update;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  select * into v_existing_order
  from vip.vip_orders
  where idempotency_key = v_key
  for update;

  if v_existing_order.id is not null then
    if v_existing_order.user_id <> p_user_id
       or v_existing_order.plan_id <> p_plan_id
       or v_existing_order.payment_currency_code <> 'KCOIN' then
      raise exception 'idempotency key conflict';
    end if;
    if v_existing_order.kcoin_amount <> p_server_price_kcoin then
      raise exception 'expected price changed';
    end if;

    select * into v_existing_subscription
    from vip.vip_subscriptions
    where id = v_existing_order.subscription_id;

    return jsonb_build_object(
      'vip_order_id', v_existing_order.id,
      'star_order_id', null,
      'invoice_payload', null,
      'xtr_amount', 0,
      'kcoin_amount', v_existing_order.kcoin_amount,
      'currency_code', 'KCOIN',
      'status', v_existing_order.status,
      'payment_status', v_existing_order.status,
      'payment_order_status', v_existing_order.status,
      'subscription_id', v_existing_order.subscription_id,
      'current_period_start', v_existing_subscription.current_period_start,
      'current_period_end', v_existing_subscription.current_period_end,
      'starts_at', v_existing_order.starts_at,
      'ends_at', v_existing_order.ends_at,
      'paid_at', v_existing_order.paid_at,
      'fulfilled_at', v_existing_order.fulfilled_at,
      'kcoin_ledger_id', v_existing_order.kcoin_ledger_id,
      'idempotent', true
    );
  end if;

  select * into v_plan
  from vip.vip_plans
  where id = p_plan_id
  for update;

  if v_plan.id is null then
    raise exception 'vip plan not found';
  end if;
  if v_plan.status <> 'active'
     or (v_plan.starts_at is not null and v_plan.starts_at > now())
     or (v_plan.ends_at is not null and v_plan.ends_at <= now()) then
    raise exception 'vip plan is not active';
  end if;

  insert into economy.user_balances (user_id, currency_code)
  values (p_user_id, 'KCOIN')
  on conflict (user_id, currency_code) do nothing;

  select coalesce(available_amount, 0)
  into v_available_kcoin
  from economy.user_balances
  where user_id = p_user_id
    and currency_code = 'KCOIN'
  for update;

  if v_available_kcoin < p_server_price_kcoin then
    v_shortage_kcoin := p_server_price_kcoin::numeric - v_available_kcoin;
    raise exception 'insufficient balance: required=%, balance=%, shortage=%',
      p_server_price_kcoin,
      v_available_kcoin,
      v_shortage_kcoin;
  end if;

  v_payload :=
    'vipkcoin_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into vip.vip_orders (
    id,
    user_id,
    plan_id,
    star_order_id,
    status,
    payment_currency_code,
    xtr_amount,
    kcoin_amount,
    invoice_payload,
    idempotency_key,
    paid_at,
    metadata
  ) values (
    v_vip_order_id,
    p_user_id,
    v_plan.id,
    null,
    'activating',
    'KCOIN',
    null,
    p_server_price_kcoin,
    v_payload,
    v_key,
    v_now,
    jsonb_build_object(
      'plan_code', v_plan.code,
      'duration_days', v_plan.duration_days,
      'payment_currency', 'KCOIN',
      'price_source', 'server_env',
      'configured_plan_price_kcoin', v_plan.price_kcoin,
      'balance_before', v_available_kcoin
    )
  );

  v_debit := api._debit_balance(
    p_user_id,
    'KCOIN',
    p_server_price_kcoin,
    'vip_monthly_subscription',
    v_vip_order_id,
    null,
    'vip:monthly:kcoin:' || v_vip_order_id::text,
    'VIP monthly subscription KCOIN payment',
    jsonb_build_object(
      'vip_order_id', v_vip_order_id,
      'plan_id', v_plan.id,
      'plan_code', v_plan.code,
      'duration_days', v_plan.duration_days,
      'price_source', 'server_env',
      'configured_plan_price_kcoin', v_plan.price_kcoin
    )
  );
  v_debit_ledger_id := (v_debit ->> 'ledger_id')::uuid;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_process_kcoin_order:user'),
    pg_catalog.hashtext(p_user_id::text)
  );

  select * into v_existing_subscription
  from vip.vip_subscriptions
  where user_id = p_user_id
    and status = 'active'
  for update;

  if v_existing_subscription.id is null then
    v_effective_start := v_now;
    v_effective_end := v_now + make_interval(days => v_plan.duration_days);
    v_subscription_start := v_effective_start;
    v_subscription_end := v_effective_end;

    insert into vip.vip_subscriptions (
      user_id,
      plan_id,
      status,
      auto_renew_enabled,
      current_period_start,
      current_period_end,
      last_vip_order_id,
      metadata
    ) values (
      p_user_id,
      v_plan.id,
      'active',
      false,
      v_subscription_start,
      v_subscription_end,
      v_vip_order_id,
      jsonb_build_object('manual_renewal', true, 'payment_currency', 'KCOIN')
    )
    returning id into v_subscription_id;
  else
    if v_existing_subscription.current_period_end > v_now then
      v_effective_start := v_existing_subscription.current_period_end;
      v_effective_end := v_existing_subscription.current_period_end + make_interval(days => v_plan.duration_days);
      v_subscription_start := v_existing_subscription.current_period_start;
      v_subscription_end := v_effective_end;
    else
      v_effective_start := v_now;
      v_effective_end := v_now + make_interval(days => v_plan.duration_days);
      v_subscription_start := v_effective_start;
      v_subscription_end := v_effective_end;
    end if;

    update vip.vip_subscriptions
    set plan_id = v_plan.id,
        status = 'active',
        auto_renew_enabled = false,
        current_period_start = v_subscription_start,
        current_period_end = v_subscription_end,
        last_vip_order_id = v_vip_order_id,
        last_star_payment_id = null,
        telegram_payment_charge_id = null,
        cancelled_at = null,
        expired_at = null,
        refunded_at = null,
        metadata = metadata || jsonb_build_object('manual_renewal', true, 'payment_currency', 'KCOIN'),
        updated_at = now()
    where id = v_existing_subscription.id
    returning id into v_subscription_id;
  end if;

  update vip.vip_orders
  set subscription_id = v_subscription_id,
      status = 'fulfilled',
      starts_at = v_effective_start,
      ends_at = v_effective_end,
      fulfilled_at = coalesce(fulfilled_at, now()),
      kcoin_ledger_id = v_debit_ledger_id,
      error_message = null,
      metadata = metadata || jsonb_build_object(
        'balance_after', v_debit ->> 'available_after',
        'kcoin_ledger_id', v_debit_ledger_id
      ),
      updated_at = now()
  where id = v_vip_order_id
  returning * into v_existing_order;

  insert into vip.vip_benefit_ledger (
    user_id,
    subscription_id,
    vip_order_id,
    benefit_type,
    entry_type,
    amount,
    currency_code,
    source_type,
    source_id,
    idempotency_key,
    metadata
  ) values (
    p_user_id,
    v_subscription_id,
    v_vip_order_id,
    'subscription_activation',
    'grant',
    v_plan.duration_days,
    null,
    'vip_order',
    v_vip_order_id,
    'vip:subscription_activation:' || v_vip_order_id::text,
    jsonb_build_object(
      'starts_at', v_effective_start,
      'ends_at', v_effective_end,
      'plan_code', v_plan.code,
      'payment_currency', 'KCOIN',
      'kcoin_amount', p_server_price_kcoin,
      'kcoin_ledger_id', v_debit_ledger_id
    )
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'fulfilled', true,
    'idempotent', false,
    'retryable', false,
    'business_type', 'vip_monthly',
    'vip_order_id', v_vip_order_id,
    'star_order_id', null,
    'invoice_payload', null,
    'xtr_amount', 0,
    'kcoin_amount', p_server_price_kcoin,
    'currency_code', 'KCOIN',
    'status', 'fulfilled',
    'payment_status', 'fulfilled',
    'payment_order_status', 'fulfilled',
    'subscription_id', v_subscription_id,
    'starts_at', v_effective_start,
    'ends_at', v_effective_end,
    'current_period_start', v_subscription_start,
    'current_period_end', v_subscription_end,
    'paid_at', v_existing_order.paid_at,
    'fulfilled_at', v_existing_order.fulfilled_at,
    'kcoin_ledger_id', v_debit_ledger_id,
    'kcoin_debit', v_debit
  );
end;
$$;

drop function if exists api.kcoin_topup_create_order(uuid, integer, text, text, text, integer, integer);

create or replace function api.kcoin_topup_create_order(
  p_user_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_intent text default 'MANUAL_TOPUP',
  p_box_slug text default null,
  p_draw_count integer default null,
  p_required_kcoin integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_status text;
  v_existing payments.kcoin_topup_orders%rowtype;
  v_existing_star_order payments.star_orders%rowtype;
  v_amount integer := p_amount;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_intent text := upper(nullif(btrim(coalesce(p_intent, 'MANUAL_TOPUP')), ''));
  v_box_slug text := nullif(btrim(coalesce(p_box_slug, '')), '');
  v_draw_count integer := p_draw_count;
  v_required_kcoin integer := p_required_kcoin;
  v_available_kcoin numeric(38,0) := 0;
  v_shortage_kcoin numeric(38,0) := 0;
  v_is_fixed_package boolean := false;
  v_is_shortage_topup boolean := false;
  v_topup_type text := 'PACKAGE';
  v_topup_order_id uuid := pg_catalog.gen_random_uuid();
  v_star_order_id uuid := pg_catalog.gen_random_uuid();
  v_payload text;
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'kcoin topup amount is invalid';
  end if;

  if v_intent is null then
    v_intent := 'MANUAL_TOPUP';
  end if;

  if v_intent not in ('MANUAL_TOPUP', 'OPEN_BOX', 'VIP_MONTHLY') then
    raise exception 'kcoin topup context is invalid';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('kcoin_topup_create_order'),
    pg_catalog.hashtext(v_key)
  );

  select status into v_user_status
  from core.users
  where id = p_user_id
  for update;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  select * into v_existing
  from payments.kcoin_topup_orders
  where idempotency_key = v_key
  for update;

  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id or v_existing.xtr_amount <> v_amount then
      raise exception 'idempotency key conflict';
    end if;

    select * into v_existing_star_order
    from payments.star_orders
    where id = v_existing.star_order_id;

    return jsonb_build_object(
      'topup_order_id', v_existing.id,
      'star_order_id', v_existing.star_order_id,
      'invoice_payload', v_existing.invoice_payload,
      'xtr_amount', v_existing.xtr_amount,
      'kcoin_amount', v_existing.kcoin_amount,
      'status', v_existing.status,
      'payment_order_status', coalesce(v_existing_star_order.status, v_existing.status),
      'expires_at', v_existing_star_order.expires_at,
      'paid_at', v_existing.paid_at,
      'fulfilled_at', v_existing.fulfilled_at,
      'idempotent', true
    );
  end if;

  v_is_fixed_package := v_amount in (500, 1000, 5000, 10000);

  if v_intent = 'MANUAL_TOPUP' then
    if not v_is_fixed_package then
      raise exception 'kcoin topup amount is invalid';
    end if;
  else
    if v_required_kcoin is null or v_required_kcoin <= 0 then
      raise exception 'kcoin topup context is invalid';
    end if;

    if v_intent = 'OPEN_BOX'
       and (v_box_slug is null or v_draw_count is null or v_draw_count not in (1, 10)) then
      raise exception 'open box topup context is invalid';
    end if;

    insert into economy.user_balances (user_id, currency_code)
    values (p_user_id, 'KCOIN')
    on conflict (user_id, currency_code) do nothing;

    select coalesce(available_amount, 0)
    into v_available_kcoin
    from economy.user_balances
    where user_id = p_user_id
      and currency_code = 'KCOIN'
    for update;

    v_shortage_kcoin := greatest(v_required_kcoin::numeric - v_available_kcoin, 0);
    v_is_shortage_topup := v_shortage_kcoin > 0 and v_amount::numeric = v_shortage_kcoin;

    if not v_is_fixed_package and not v_is_shortage_topup then
      raise exception 'kcoin topup amount is invalid';
    end if;

    if v_available_kcoin + v_amount < v_required_kcoin then
      raise exception 'topup amount is not enough for purchase';
    end if;

    if v_is_shortage_topup then
      v_topup_type := 'SHORTAGE';
    end if;
  end if;

  v_payload :=
    'kcoin_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into payments.kcoin_topup_orders (
    id,
    user_id,
    status,
    xtr_amount,
    kcoin_amount,
    invoice_payload,
    idempotency_key,
    metadata
  ) values (
    v_topup_order_id,
    p_user_id,
    'created',
    v_amount,
    v_amount,
    v_payload,
    v_key,
    jsonb_build_object(
      'exchange_rate', '1_star_to_1_kcoin',
      'allowed_amounts', jsonb_build_array('SHORTAGE', 500, 1000, 5000, 10000),
      'intent', v_intent,
      'topup_type', v_topup_type,
      'box_slug', v_box_slug,
      'draw_count', v_draw_count,
      'required_kcoin', v_required_kcoin,
      'balance_before', v_available_kcoin,
      'shortage_kcoin', v_shortage_kcoin,
      'estimated_balance_after_topup', v_available_kcoin + v_amount,
      'estimated_balance_after_purchase',
        case
          when v_intent in ('OPEN_BOX', 'VIP_MONTHLY')
            then v_available_kcoin + v_amount - v_required_kcoin
          else null
        end
    )
  );

  insert into payments.star_orders (
    id,
    user_id,
    business_type,
    business_id,
    status,
    xtr_amount,
    telegram_invoice_payload,
    title,
    description,
    idempotency_key,
    expires_at,
    metadata
  ) values (
    v_star_order_id,
    p_user_id,
    'kcoin_topup',
    v_topup_order_id,
    'created',
    v_amount,
    v_payload,
    'K-coin Recharge',
    v_amount::text || ' K-coin',
    v_key,
    v_expires_at,
    jsonb_build_object(
      'topup_order_id', v_topup_order_id,
      'kcoin_amount', v_amount,
      'exchange_rate', '1_star_to_1_kcoin',
      'intent', v_intent,
      'topup_type', v_topup_type,
      'box_slug', v_box_slug,
      'draw_count', v_draw_count,
      'required_kcoin', v_required_kcoin
    )
  );

  update payments.kcoin_topup_orders
  set star_order_id = v_star_order_id,
      updated_at = now()
  where id = v_topup_order_id;

  return jsonb_build_object(
    'topup_order_id', v_topup_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', v_amount,
    'kcoin_amount', v_amount,
    'status', 'created',
    'payment_order_status', 'created',
    'expires_at', v_expires_at,
    'intent', v_intent,
    'topup_type', v_topup_type,
    'required_kcoin', v_required_kcoin,
    'balance_before', v_available_kcoin,
    'shortage_kcoin', v_shortage_kcoin,
    'estimated_balance_after_topup', v_available_kcoin + v_amount,
    'estimated_balance_after_purchase',
      case
        when v_intent in ('OPEN_BOX', 'VIP_MONTHLY')
          then v_available_kcoin + v_amount - v_required_kcoin
        else null
      end,
    'idempotent', false
  );
end;
$$;

comment on function api.vip_create_order_with_server_kcoin_checked(uuid, uuid, text, integer, integer) is
  'Debits KCOIN and opens or extends a VIP monthly subscription in one trusted transaction using a Vercel server-side price.';

comment on function api.kcoin_topup_create_order(uuid, integer, text, text, text, integer, integer) is
  'Creates a Telegram Stars K-coin topup order. Manual topups use fixed packages; OPEN_BOX and VIP_MONTHLY may also exactly cover the current KCOIN shortage.';

revoke execute on function api.vip_get_status(uuid)
  from public, anon, authenticated;
revoke execute on function api.vip_create_order_with_server_kcoin_checked(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function api.kcoin_topup_create_order(uuid, integer, text, text, text, integer, integer)
  from public, anon, authenticated;

grant execute on function api.vip_get_status(uuid)
  to service_role;
grant execute on function api.vip_create_order_with_server_kcoin_checked(uuid, uuid, text, integer, integer)
  to service_role;
grant execute on function api.kcoin_topup_create_order(uuid, integer, text, text, text, integer, integer)
  to service_role;

commit;
