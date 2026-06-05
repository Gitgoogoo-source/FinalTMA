-- VIP monthly card database schema and RPCs.
--
-- Scope:
-- - One manually renewed VIP monthly plan.
-- - UTC daily benefit claims.
-- - Daily FGEMS and free-box counters tracked in vip_daily_claims.
-- - Market fee rebates are credited after normal settlement.

begin;

create schema if not exists vip;

grant usage on schema vip to authenticated, service_role;

alter table payments.star_orders
  drop constraint if exists star_orders_business_type_check;

alter table payments.star_orders
  add constraint star_orders_business_type_check
  check (business_type in ('gacha_open', 'vip_monthly', 'admin_test', 'other'));

create table if not exists vip.vip_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (nullif(btrim(code), '') is not null),
  display_name text not null check (nullif(btrim(display_name), '') is not null),
  status text not null default 'active'
    check (status in ('draft', 'active', 'paused', 'archived')),
  price_xtr integer not null check (price_xtr > 0),
  duration_days integer not null default 30 check (duration_days > 0),
  subscription_period_seconds integer not null default 2592000
    check (subscription_period_seconds > 0),
  daily_fgems numeric(38,0) not null default 100 check (daily_fgems >= 0),
  daily_free_box_count integer not null default 1 check (daily_free_box_count >= 0),
  fee_rebate_bps integer not null default 2000
    check (fee_rebate_bps between 0 and 10000),
  badge_code text,
  benefits jsonb not null default '{}'::jsonb check (jsonb_typeof(benefits) = 'object'),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

comment on table vip.vip_plans is 'Operator-configured VIP monthly card plans and benefit settings.';

create table if not exists vip.vip_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  plan_id uuid not null references vip.vip_plans(id) on delete restrict,
  star_order_id uuid references payments.star_orders(id) on delete set null,
  subscription_id uuid,
  status text not null default 'created'
    check (status in (
      'created',
      'invoice_created',
      'paid',
      'activating',
      'active',
      'fulfilled',
      'cancelled',
      'expired',
      'failed',
      'refunded'
    )),
  xtr_amount integer not null check (xtr_amount > 0),
  invoice_payload text not null unique check (nullif(btrim(invoice_payload), '') is not null),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  starts_at timestamptz,
  ends_at timestamptz,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

comment on table vip.vip_orders is 'VIP business orders mapped one-to-one to Telegram Stars payment orders.';

create table if not exists vip.vip_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  plan_id uuid not null references vip.vip_plans(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'cancelled', 'expired', 'refunded', 'suspended')),
  auto_renew_enabled boolean not null default false,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  last_vip_order_id uuid references vip.vip_orders(id) on delete set null,
  last_star_payment_id uuid references payments.star_payments(id) on delete set null,
  telegram_payment_charge_id text,
  cancelled_at timestamptz,
  expired_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

comment on table vip.vip_subscriptions is 'Current and historical VIP monthly card subscription periods.';

alter table vip.vip_orders
  drop constraint if exists vip_orders_subscription_id_fkey;

alter table vip.vip_orders
  add constraint vip_orders_subscription_id_fkey
  foreign key (subscription_id) references vip.vip_subscriptions(id) on delete set null;

create table if not exists vip.vip_daily_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  subscription_id uuid not null references vip.vip_subscriptions(id) on delete cascade,
  plan_id uuid not null references vip.vip_plans(id) on delete restrict,
  claim_date date not null,
  fgems_amount numeric(38,0) not null default 0 check (fgems_amount >= 0),
  fgems_ledger_id uuid references economy.currency_ledger(id) on delete set null,
  free_box_count integer not null default 0 check (free_box_count >= 0),
  free_box_used_count integer not null default 0 check (free_box_used_count >= 0),
  free_box_used_at timestamptz,
  status text not null default 'claimed'
    check (status in ('claimed', 'partially_used', 'used', 'expired', 'reversed')),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, claim_date),
  check (free_box_used_count <= free_box_count)
);

comment on table vip.vip_daily_claims is 'UTC-date daily VIP benefit claims. The free box entitlement is stored as counters on this row.';

create table if not exists vip.vip_benefit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  subscription_id uuid references vip.vip_subscriptions(id) on delete set null,
  vip_order_id uuid references vip.vip_orders(id) on delete set null,
  benefit_type text not null
    check (benefit_type in (
      'subscription_activation',
      'daily_fgems',
      'daily_free_box',
      'fee_rebate',
      'badge',
      'refund_reversal',
      'admin_adjustment'
    )),
  entry_type text not null
    check (entry_type in ('grant', 'consume', 'reversal', 'expire', 'adjustment')),
  amount numeric(38,0) check (amount is null or amount >= 0),
  currency_code text references economy.currencies(code),
  source_type text not null check (nullif(btrim(source_type), '') is not null),
  source_id uuid,
  idempotency_key text unique check (idempotency_key is null or nullif(btrim(idempotency_key), '') is not null),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

comment on table vip.vip_benefit_ledger is 'VIP benefit audit ledger. Currency balances still use economy.currency_ledger as the asset source of truth.';

create table if not exists vip.vip_fee_rebates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  subscription_id uuid not null references vip.vip_subscriptions(id) on delete cascade,
  market_order_id uuid not null references market.orders(id) on delete cascade,
  fee_currency_code text not null references economy.currencies(code),
  original_fee_amount numeric(38,0) not null check (original_fee_amount >= 0),
  rebate_bps integer not null check (rebate_bps between 0 and 10000),
  rebate_amount numeric(38,0) not null check (rebate_amount >= 0),
  ledger_id uuid references economy.currency_ledger(id) on delete set null,
  status text not null default 'granted'
    check (status in ('pending', 'granted', 'reversed', 'failed')),
  idempotency_key text not null unique check (nullif(btrim(idempotency_key), '') is not null),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (market_order_id, user_id)
);

comment on table vip.vip_fee_rebates is 'VIP market fee rebate grants. Rebate credits are written to economy.currency_ledger.';

create index if not exists vip_orders_user_created_idx
  on vip.vip_orders (user_id, created_at desc);
create index if not exists vip_orders_status_created_idx
  on vip.vip_orders (status, created_at desc);
create unique index if not exists vip_orders_star_order_unique_idx
  on vip.vip_orders (star_order_id)
  where star_order_id is not null;

create index if not exists vip_subscriptions_user_period_idx
  on vip.vip_subscriptions (user_id, current_period_end desc);
create index if not exists vip_subscriptions_status_period_idx
  on vip.vip_subscriptions (status, current_period_end);
create unique index if not exists vip_one_active_subscription_per_user_idx
  on vip.vip_subscriptions (user_id)
  where status = 'active';

create index if not exists vip_daily_claims_user_date_idx
  on vip.vip_daily_claims (user_id, claim_date desc);
create index if not exists vip_daily_claims_subscription_date_idx
  on vip.vip_daily_claims (subscription_id, claim_date desc);

create index if not exists vip_benefit_ledger_user_created_idx
  on vip.vip_benefit_ledger (user_id, created_at desc);
create index if not exists vip_benefit_ledger_subscription_created_idx
  on vip.vip_benefit_ledger (subscription_id, created_at desc);
create index if not exists vip_benefit_ledger_source_idx
  on vip.vip_benefit_ledger (source_type, source_id);

create index if not exists vip_fee_rebates_user_created_idx
  on vip.vip_fee_rebates (user_id, created_at desc);
create index if not exists vip_fee_rebates_subscription_created_idx
  on vip.vip_fee_rebates (subscription_id, created_at desc);

drop trigger if exists vip_plans_set_updated_at on vip.vip_plans;
create trigger vip_plans_set_updated_at
  before update on vip.vip_plans
  for each row execute function core.set_updated_at();

drop trigger if exists vip_orders_set_updated_at on vip.vip_orders;
create trigger vip_orders_set_updated_at
  before update on vip.vip_orders
  for each row execute function core.set_updated_at();

drop trigger if exists vip_subscriptions_set_updated_at on vip.vip_subscriptions;
create trigger vip_subscriptions_set_updated_at
  before update on vip.vip_subscriptions
  for each row execute function core.set_updated_at();

alter table vip.vip_plans enable row level security;
alter table vip.vip_orders enable row level security;
alter table vip.vip_subscriptions enable row level security;
alter table vip.vip_daily_claims enable row level security;
alter table vip.vip_benefit_ledger enable row level security;
alter table vip.vip_fee_rebates enable row level security;

revoke all on all tables in schema vip from public, anon, authenticated;
grant all privileges on all tables in schema vip to service_role;

grant select on table
  vip.vip_plans,
  vip.vip_orders,
  vip.vip_subscriptions,
  vip.vip_daily_claims,
  vip.vip_benefit_ledger,
  vip.vip_fee_rebates
to authenticated;

drop policy if exists vip_plans_read_active on vip.vip_plans;
create policy vip_plans_read_active
on vip.vip_plans
for select
to authenticated
using (
  status = 'active'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

drop policy if exists vip_plans_admin_read on vip.vip_plans;

drop policy if exists vip_orders_select_own on vip.vip_orders;
create policy vip_orders_select_own
on vip.vip_orders
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists vip_orders_admin_read on vip.vip_orders;

drop policy if exists vip_subscriptions_select_own on vip.vip_subscriptions;
create policy vip_subscriptions_select_own
on vip.vip_subscriptions
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists vip_subscriptions_admin_read on vip.vip_subscriptions;

drop policy if exists vip_daily_claims_select_own on vip.vip_daily_claims;
create policy vip_daily_claims_select_own
on vip.vip_daily_claims
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists vip_daily_claims_admin_read on vip.vip_daily_claims;

drop policy if exists vip_benefit_ledger_select_own on vip.vip_benefit_ledger;
create policy vip_benefit_ledger_select_own
on vip.vip_benefit_ledger
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists vip_benefit_ledger_admin_read on vip.vip_benefit_ledger;

drop policy if exists vip_fee_rebates_select_own on vip.vip_fee_rebates;
create policy vip_fee_rebates_select_own
on vip.vip_fee_rebates
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists vip_fee_rebates_admin_read on vip.vip_fee_rebates;

insert into vip.vip_plans (
  code,
  display_name,
  status,
  price_xtr,
  duration_days,
  subscription_period_seconds,
  daily_fgems,
  daily_free_box_count,
  fee_rebate_bps,
  badge_code,
  benefits
) values (
  'vip_monthly',
  'VIP Monthly Card',
  'active',
  199,
  30,
  2592000,
  100,
  1,
  2000,
  'vip_monthly',
  jsonb_build_object(
    'daily_fgems', 100,
    'daily_free_box_count', 1,
    'fee_rebate_bps', 2000,
    'manual_renewal', true,
    'business_day', 'UTC'
  )
)
on conflict (code) do update
set display_name = excluded.display_name,
    status = excluded.status,
    price_xtr = excluded.price_xtr,
    duration_days = excluded.duration_days,
    subscription_period_seconds = excluded.subscription_period_seconds,
    daily_fgems = excluded.daily_fgems,
    daily_free_box_count = excluded.daily_free_box_count,
    fee_rebate_bps = excluded.fee_rebate_bps,
    badge_code = excluded.badge_code,
    benefits = excluded.benefits,
    updated_at = now();

create or replace function api.vip_get_status(
  p_user_id uuid
)
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

  select * into v_subscription
  from vip.vip_subscriptions
  where user_id = p_user_id
    and status = 'active'
    and current_period_end > now()
  order by current_period_end desc
  limit 1;

  if v_subscription.id is not null then
    select * into v_claim
    from vip.vip_daily_claims
    where user_id = p_user_id
      and claim_date = v_today
    limit 1;
  end if;

  return jsonb_build_object(
    'is_vip', v_subscription.id is not null,
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
      'claimed', v_claim.id is not null,
      'can_claim', v_subscription.id is not null and v_claim.id is null,
      'fgems_amount', coalesce(v_plan.daily_fgems, 0),
      'free_box_count', coalesce(v_plan.daily_free_box_count, 0),
      'free_box_used_count', coalesce(v_claim.free_box_used_count, 0)
    ),
    'server_time', now()
  );
end;
$$;

create or replace function api.vip_create_order_checked(
  p_user_id uuid,
  p_plan_id uuid,
  p_idempotency_key text,
  p_expected_price_xtr integer
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
  v_existing_star_order payments.star_orders%rowtype;
  v_vip_order_id uuid := pg_catalog.gen_random_uuid();
  v_star_order_id uuid := pg_catalog.gen_random_uuid();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_payload text;
  v_expires_at timestamptz := now() + interval '15 minutes';
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

  perform pg_advisory_xact_lock(pg_catalog.hashtext('vip_create_order_checked'), pg_catalog.hashtext(v_key));

  select status into v_user_status
  from core.users
  where id = p_user_id;

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
       or v_existing_order.plan_id <> p_plan_id then
      raise exception 'idempotency key conflict';
    end if;
    if p_expected_price_xtr is not null
       and v_existing_order.xtr_amount <> p_expected_price_xtr then
      raise exception 'expected price changed';
    end if;

    select * into v_existing_star_order
    from payments.star_orders
    where id = v_existing_order.star_order_id;

    return jsonb_build_object(
      'vip_order_id', v_existing_order.id,
      'star_order_id', v_existing_order.star_order_id,
      'invoice_payload', v_existing_order.invoice_payload,
      'xtr_amount', v_existing_order.xtr_amount,
      'status', v_existing_order.status,
      'payment_order_status', v_existing_star_order.status,
      'expires_at', v_existing_star_order.expires_at,
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
  if p_expected_price_xtr is not null
     and v_plan.price_xtr <> p_expected_price_xtr then
    raise exception 'expected price changed';
  end if;

  v_payload :=
    'vip_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into vip.vip_orders (
    id,
    user_id,
    plan_id,
    status,
    xtr_amount,
    invoice_payload,
    idempotency_key,
    metadata
  ) values (
    v_vip_order_id,
    p_user_id,
    v_plan.id,
    'created',
    v_plan.price_xtr,
    v_payload,
    v_key,
    jsonb_build_object('plan_code', v_plan.code, 'duration_days', v_plan.duration_days)
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
    'vip_monthly',
    v_vip_order_id,
    'created',
    v_plan.price_xtr,
    v_payload,
    v_plan.display_name,
    'VIP monthly card for 30 days',
    v_key,
    v_expires_at,
    jsonb_build_object(
      'plan_id', v_plan.id,
      'plan_code', v_plan.code,
      'duration_days', v_plan.duration_days,
      'manual_renewal', true
    )
  );

  update vip.vip_orders
  set star_order_id = v_star_order_id,
      updated_at = now()
  where id = v_vip_order_id;

  return jsonb_build_object(
    'vip_order_id', v_vip_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', v_plan.price_xtr,
    'status', 'created',
    'payment_order_status', 'created',
    'expires_at', v_expires_at,
    'idempotent', false
  );
end;
$$;

create or replace function api.vip_process_paid_order(
  p_star_order_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_raw_update jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_star_order payments.star_orders%rowtype;
  v_vip_order vip.vip_orders%rowtype;
  v_plan vip.vip_plans%rowtype;
  v_payment payments.star_payments%rowtype;
  v_existing_subscription vip.vip_subscriptions%rowtype;
  v_subscription_id uuid;
  v_charge_id text := nullif(btrim(coalesce(p_telegram_payment_charge_id, '')), '');
  v_provider_charge_id text := nullif(btrim(coalesce(p_provider_payment_charge_id, '')), '');
  v_raw_update jsonb := coalesce(p_raw_update, '{}'::jsonb);
  v_effective_start timestamptz;
  v_effective_end timestamptz;
  v_subscription_start timestamptz;
  v_subscription_end timestamptz;
  v_now timestamptz := now();
begin
  if p_star_order_id is null or v_charge_id is null then
    raise exception 'star_order_id and telegram_payment_charge_id are required';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  if v_star_order.id is null then
    raise exception 'star order not found';
  end if;
  if v_star_order.business_type <> 'vip_monthly' then
    raise exception 'Stars order business type is not vip_monthly';
  end if;

  select * into v_vip_order
  from vip.vip_orders
  where id = v_star_order.business_id
    and star_order_id = v_star_order.id
  for update;

  if v_vip_order.id is null then
    raise exception 'vip order not found';
  end if;

  if v_star_order.user_id <> v_vip_order.user_id then
    raise exception 'vip order user mismatch';
  end if;
  if v_star_order.xtr_amount <> v_vip_order.xtr_amount then
    raise exception 'vip order amount mismatch';
  end if;
  if v_star_order.telegram_invoice_payload <> v_vip_order.invoice_payload then
    raise exception 'vip order invoice payload mismatch';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_process_paid_order:user'),
    pg_catalog.hashtext(v_vip_order.user_id::text)
  );

  perform 1
  from core.users
  where id = v_vip_order.user_id
  for update;

  if not found then
    raise exception 'user not found';
  end if;

  select * into v_plan
  from vip.vip_plans
  where id = v_vip_order.plan_id
  for update;

  if v_plan.id is null then
    raise exception 'vip plan not found';
  end if;

  select * into v_payment
  from payments.star_payments
  where telegram_payment_charge_id = v_charge_id
  for update;

  if v_payment.id is not null and v_payment.star_order_id <> v_star_order.id then
    raise exception 'telegram payment charge id is already bound to another order';
  end if;

  if v_vip_order.status = 'fulfilled' and v_vip_order.subscription_id is not null then
    if v_payment.id is null then
      raise exception 'fulfilled vip order has no matching payment charge';
    end if;

    select * into v_existing_subscription
    from vip.vip_subscriptions
    where id = v_vip_order.subscription_id;

    update payments.star_orders
    set status = 'fulfilled',
        fulfilled_at = coalesce(fulfilled_at, v_vip_order.fulfilled_at, now()),
        error_message = null,
        updated_at = now()
    where id = v_star_order.id
    returning * into v_star_order;

    return jsonb_build_object(
      'fulfilled', true,
      'idempotent', true,
      'retryable', false,
      'business_type', 'vip_monthly',
      'star_order_id', v_star_order.id,
      'vip_order_id', v_vip_order.id,
      'subscription_id', v_vip_order.subscription_id,
      'current_period_start', v_existing_subscription.current_period_start,
      'current_period_end', v_existing_subscription.current_period_end,
      'telegram_payment_charge_id', v_charge_id,
      'payment_order_status', v_star_order.status
    );
  end if;

  if v_star_order.status not in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked', 'paid', 'fulfilling', 'failed') then
    raise exception 'vip star order status is not fulfillable';
  end if;
  if v_vip_order.status not in ('created', 'invoice_created', 'paid', 'activating', 'failed') then
    raise exception 'vip order status is not fulfillable';
  end if;

  if v_payment.id is null then
    insert into payments.star_payments (
      star_order_id,
      user_id,
      telegram_payment_charge_id,
      provider_payment_charge_id,
      xtr_amount,
      currency,
      invoice_payload,
      raw_update
    ) values (
      v_star_order.id,
      v_star_order.user_id,
      v_charge_id,
      v_provider_charge_id,
      v_star_order.xtr_amount,
      'XTR',
      v_star_order.telegram_invoice_payload,
      v_raw_update
    )
    on conflict (telegram_payment_charge_id) do nothing
    returning * into v_payment;

    if v_payment.id is null then
      select * into v_payment
      from payments.star_payments
      where telegram_payment_charge_id = v_charge_id
      for update;
    end if;
  end if;

  if v_payment.id is null or v_payment.star_order_id <> v_star_order.id then
    raise exception 'successful payment row is missing or conflicting';
  end if;

  update payments.star_orders
  set status = 'fulfilling',
      paid_at = coalesce(paid_at, v_payment.paid_at, v_now),
      error_message = null,
      updated_at = now()
  where id = v_star_order.id
  returning * into v_star_order;

  update vip.vip_orders
  set status = 'activating',
      paid_at = coalesce(paid_at, v_payment.paid_at, v_now),
      error_message = null,
      updated_at = now()
  where id = v_vip_order.id
  returning * into v_vip_order;

  select * into v_existing_subscription
  from vip.vip_subscriptions
  where user_id = v_vip_order.user_id
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
      last_star_payment_id,
      telegram_payment_charge_id,
      metadata
    ) values (
      v_vip_order.user_id,
      v_plan.id,
      'active',
      false,
      v_subscription_start,
      v_subscription_end,
      v_vip_order.id,
      v_payment.id,
      v_charge_id,
      jsonb_build_object('manual_renewal', true)
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
        last_vip_order_id = v_vip_order.id,
        last_star_payment_id = v_payment.id,
        telegram_payment_charge_id = v_charge_id,
        cancelled_at = null,
        expired_at = null,
        refunded_at = null,
        metadata = metadata || jsonb_build_object('manual_renewal', true),
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
      error_message = null,
      updated_at = now()
  where id = v_vip_order.id
  returning * into v_vip_order;

  update payments.star_orders
  set status = 'fulfilled',
      fulfilled_at = coalesce(fulfilled_at, now()),
      error_message = null,
      updated_at = now()
  where id = v_star_order.id
  returning * into v_star_order;

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
    v_vip_order.user_id,
    v_subscription_id,
    v_vip_order.id,
    'subscription_activation',
    'grant',
    v_plan.duration_days,
    null,
    'vip_order',
    v_vip_order.id,
    'vip:subscription_activation:' || v_vip_order.id::text,
    jsonb_build_object(
      'starts_at', v_effective_start,
      'ends_at', v_effective_end,
      'plan_code', v_plan.code,
      'telegram_payment_charge_id', v_charge_id
    )
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'fulfilled', true,
    'idempotent', false,
    'retryable', false,
    'business_type', 'vip_monthly',
    'star_order_id', v_star_order.id,
    'star_payment_id', v_payment.id,
    'vip_order_id', v_vip_order.id,
    'subscription_id', v_subscription_id,
    'starts_at', v_effective_start,
    'ends_at', v_effective_end,
    'current_period_start', v_subscription_start,
    'current_period_end', v_subscription_end,
    'telegram_payment_charge_id', v_charge_id,
    'payment_order_status', v_star_order.status
  );
end;
$$;

create or replace function api.vip_claim_daily_benefit(
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_status text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_today date := (now() at time zone 'UTC')::date;
  v_subscription vip.vip_subscriptions%rowtype;
  v_plan vip.vip_plans%rowtype;
  v_existing_claim vip.vip_daily_claims%rowtype;
  v_claim_id uuid := pg_catalog.gen_random_uuid();
  v_credit jsonb := null;
  v_ledger_id uuid := null;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtext('vip_claim_daily_benefit'), pg_catalog.hashtext(p_user_id::text || ':' || v_today::text));

  select status into v_user_status
  from core.users
  where id = p_user_id;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  select * into v_existing_claim
  from vip.vip_daily_claims
  where idempotency_key = v_key
  for update;

  if v_existing_claim.id is not null then
    if v_existing_claim.user_id <> p_user_id then
      raise exception 'idempotency key conflict';
    end if;

    return jsonb_build_object(
      'claim_id', v_existing_claim.id,
      'subscription_id', v_existing_claim.subscription_id,
      'claim_date', v_existing_claim.claim_date,
      'fgems_amount', v_existing_claim.fgems_amount,
      'fgems_ledger_id', v_existing_claim.fgems_ledger_id,
      'free_box_count', v_existing_claim.free_box_count,
      'free_box_used_count', v_existing_claim.free_box_used_count,
      'already_claimed', true,
      'idempotent', true
    );
  end if;

  select * into v_subscription
  from vip.vip_subscriptions
  where user_id = p_user_id
    and status = 'active'
    and current_period_end > now()
  order by current_period_end desc
  limit 1
  for update;

  if v_subscription.id is null then
    raise exception 'VIP_EXPIRED';
  end if;

  select * into v_plan
  from vip.vip_plans
  where id = v_subscription.plan_id;

  if v_plan.id is null then
    raise exception 'vip plan not found';
  end if;

  select * into v_existing_claim
  from vip.vip_daily_claims
  where user_id = p_user_id
    and claim_date = v_today
  for update;

  if v_existing_claim.id is not null then
    return jsonb_build_object(
      'claim_id', v_existing_claim.id,
      'subscription_id', v_existing_claim.subscription_id,
      'claim_date', v_existing_claim.claim_date,
      'fgems_amount', v_existing_claim.fgems_amount,
      'fgems_ledger_id', v_existing_claim.fgems_ledger_id,
      'free_box_count', v_existing_claim.free_box_count,
      'free_box_used_count', v_existing_claim.free_box_used_count,
      'already_claimed', true,
      'idempotent', false
    );
  end if;

  insert into vip.vip_daily_claims (
    id,
    user_id,
    subscription_id,
    plan_id,
    claim_date,
    fgems_amount,
    free_box_count,
    free_box_used_count,
    status,
    idempotency_key,
    metadata
  ) values (
    v_claim_id,
    p_user_id,
    v_subscription.id,
    v_plan.id,
    v_today,
    v_plan.daily_fgems,
    v_plan.daily_free_box_count,
    0,
    'claimed',
    v_key,
    jsonb_build_object('business_day', 'UTC')
  )
  returning * into v_existing_claim;

  if v_plan.daily_fgems > 0 then
    v_credit := api._credit_balance(
      p_user_id,
      'FGEMS',
      v_plan.daily_fgems,
      'vip_daily_claim',
      v_claim_id,
      null,
      'vip:daily_fgems:' || p_user_id::text || ':' || v_today::text,
      'VIP daily FGEMS',
      jsonb_build_object('claim_date', v_today, 'subscription_id', v_subscription.id)
    );
    v_ledger_id := (v_credit ->> 'ledger_id')::uuid;

    update vip.vip_daily_claims
    set fgems_ledger_id = v_ledger_id
    where id = v_claim_id
    returning * into v_existing_claim;

    insert into vip.vip_benefit_ledger (
      user_id,
      subscription_id,
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
      v_subscription.id,
      'daily_fgems',
      'grant',
      v_plan.daily_fgems,
      'FGEMS',
      'vip_daily_claim',
      v_claim_id,
      'vip:benefit:daily_fgems:' || p_user_id::text || ':' || v_today::text,
      jsonb_build_object('ledger_id', v_ledger_id, 'claim_date', v_today)
    )
    on conflict (idempotency_key) do nothing;
  end if;

  if v_plan.daily_free_box_count > 0 then
    insert into vip.vip_benefit_ledger (
      user_id,
      subscription_id,
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
      v_subscription.id,
      'daily_free_box',
      'grant',
      v_plan.daily_free_box_count,
      null,
      'vip_daily_claim',
      v_claim_id,
      'vip:benefit:daily_free_box:' || p_user_id::text || ':' || v_today::text,
      jsonb_build_object('claim_date', v_today)
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'claim_id', v_existing_claim.id,
    'subscription_id', v_existing_claim.subscription_id,
    'claim_date', v_existing_claim.claim_date,
    'fgems_amount', v_existing_claim.fgems_amount,
    'fgems_ledger_id', v_existing_claim.fgems_ledger_id,
    'fgems_ledger', v_credit,
    'free_box_count', v_existing_claim.free_box_count,
    'free_box_used_count', v_existing_claim.free_box_used_count,
    'already_claimed', false,
    'idempotent', false
  );
end;
$$;

create or replace function api.vip_consume_daily_free_box(
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_status text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_today date := (now() at time zone 'UTC')::date;
  v_subscription vip.vip_subscriptions%rowtype;
  v_claim vip.vip_daily_claims%rowtype;
  v_existing_ledger vip.vip_benefit_ledger%rowtype;
  v_remaining_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_consume_daily_free_box'),
    pg_catalog.hashtext(p_user_id::text || ':' || v_today::text)
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

  select * into v_existing_ledger
  from vip.vip_benefit_ledger
  where idempotency_key = v_key
  for update;

  if v_existing_ledger.id is not null then
    if v_existing_ledger.user_id <> p_user_id
       or v_existing_ledger.benefit_type <> 'daily_free_box'
       or v_existing_ledger.entry_type <> 'consume' then
      raise exception 'idempotency key conflict';
    end if;

    select * into v_claim
    from vip.vip_daily_claims
    where id = v_existing_ledger.source_id;

    return jsonb_build_object(
      'consumed', true,
      'idempotent', true,
      'claim_id', v_claim.id,
      'claim_date', v_claim.claim_date,
      'free_box_count', v_claim.free_box_count,
      'free_box_used_count', v_claim.free_box_used_count,
      'remaining_free_box_count', greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0),
      'consume_ledger_id', v_existing_ledger.id
    );
  end if;

  select * into v_subscription
  from vip.vip_subscriptions
  where user_id = p_user_id
    and status = 'active'
    and current_period_end > now()
  order by current_period_end desc
  limit 1
  for update;

  if v_subscription.id is null then
    raise exception 'VIP_EXPIRED';
  end if;

  select * into v_claim
  from vip.vip_daily_claims
  where user_id = p_user_id
    and claim_date = v_today
  for update;

  if v_claim.id is null then
    raise exception 'VIP_DAILY_BENEFIT_NOT_CLAIMED';
  end if;

  if v_claim.free_box_used_count >= v_claim.free_box_count then
    raise exception 'VIP_FREE_BOX_ALREADY_USED';
  end if;

  insert into vip.vip_benefit_ledger (
    user_id,
    subscription_id,
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
    v_claim.subscription_id,
    'daily_free_box',
    'consume',
    1,
    null,
    'vip_daily_claim',
    v_claim.id,
    v_key,
    jsonb_build_object('claim_date', v_today)
  )
  returning * into v_existing_ledger;

  update vip.vip_daily_claims
  set free_box_used_count = free_box_used_count + 1,
      free_box_used_at = now(),
      status = case
        when free_box_used_count + 1 >= free_box_count then 'used'
        else 'partially_used'
      end
  where id = v_claim.id
  returning * into v_claim;

  v_remaining_count := greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0);

  return jsonb_build_object(
    'consumed', true,
    'idempotent', false,
    'claim_id', v_claim.id,
    'claim_date', v_claim.claim_date,
    'free_box_count', v_claim.free_box_count,
    'free_box_used_count', v_claim.free_box_used_count,
    'remaining_free_box_count', v_remaining_count,
    'consume_ledger_id', v_existing_ledger.id,
    'consumed_at', v_claim.free_box_used_at
  );
end;
$$;

create or replace function api.vip_apply_market_fee_rebate(
  p_market_order_id uuid,
  p_seller_user_id uuid,
  p_fee_amount numeric,
  p_currency_code text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_currency text := upper(nullif(btrim(coalesce(p_currency_code, '')), ''));
  v_order market.orders%rowtype;
  v_subscription vip.vip_subscriptions%rowtype;
  v_plan vip.vip_plans%rowtype;
  v_existing_rebate vip.vip_fee_rebates%rowtype;
  v_rebate_id uuid := pg_catalog.gen_random_uuid();
  v_rebate_amount numeric(38,0);
  v_credit jsonb := null;
  v_ledger_id uuid := null;
begin
  if p_market_order_id is null or p_seller_user_id is null then
    raise exception 'market_order_id and seller_user_id are required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;
  if v_currency is null then
    raise exception 'currency_code is required';
  end if;
  if p_fee_amount is null or p_fee_amount < 0 then
    raise exception 'fee_amount must be non-negative';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtext('vip_apply_market_fee_rebate'), pg_catalog.hashtext(v_key));

  select * into v_existing_rebate
  from vip.vip_fee_rebates
  where idempotency_key = v_key
  for update;

  if v_existing_rebate.id is not null then
    return jsonb_build_object(
      'applied', v_existing_rebate.status = 'granted',
      'idempotent', true,
      'rebate_id', v_existing_rebate.id,
      'ledger_id', v_existing_rebate.ledger_id,
      'rebate_amount', v_existing_rebate.rebate_amount,
      'rebate_bps', v_existing_rebate.rebate_bps
    );
  end if;

  select * into v_existing_rebate
  from vip.vip_fee_rebates
  where market_order_id = p_market_order_id
    and user_id = p_seller_user_id
  for update;

  if v_existing_rebate.id is not null then
    return jsonb_build_object(
      'applied', v_existing_rebate.status = 'granted',
      'idempotent', true,
      'rebate_id', v_existing_rebate.id,
      'ledger_id', v_existing_rebate.ledger_id,
      'rebate_amount', v_existing_rebate.rebate_amount,
      'rebate_bps', v_existing_rebate.rebate_bps
    );
  end if;

  select * into v_order
  from market.orders
  where id = p_market_order_id
  for update;

  if v_order.id is null then
    raise exception 'market order not found';
  end if;
  if v_order.status <> 'completed' then
    raise exception 'market order is not completed';
  end if;
  if v_order.seller_user_id <> p_seller_user_id then
    raise exception 'market order seller mismatch';
  end if;
  if v_currency <> 'KCOIN' then
    raise exception 'fee currency mismatch';
  end if;
  if v_order.fee_amount_kcoin <> p_fee_amount then
    raise exception 'fee amount mismatch';
  end if;

  select * into v_subscription
  from vip.vip_subscriptions
  where user_id = p_seller_user_id
    and status = 'active'
    and current_period_start <= coalesce(v_order.completed_at, v_order.created_at, now())
    and current_period_end > coalesce(v_order.completed_at, v_order.created_at, now())
  order by current_period_end desc
  limit 1;

  if v_subscription.id is null then
    return jsonb_build_object(
      'applied', false,
      'idempotent', false,
      'reason', 'not_vip',
      'rebate_amount', 0
    );
  end if;

  select * into v_plan
  from vip.vip_plans
  where id = v_subscription.plan_id;

  if v_plan.id is null then
    raise exception 'vip plan not found';
  end if;

  v_rebate_amount := floor(p_fee_amount * v_plan.fee_rebate_bps / 10000);

  if v_rebate_amount <= 0 then
    return jsonb_build_object(
      'applied', false,
      'idempotent', false,
      'reason', 'zero_rebate',
      'rebate_amount', 0,
      'rebate_bps', v_plan.fee_rebate_bps
    );
  end if;

  insert into vip.vip_fee_rebates (
    id,
    user_id,
    subscription_id,
    market_order_id,
    fee_currency_code,
    original_fee_amount,
    rebate_bps,
    rebate_amount,
    status,
    idempotency_key,
    metadata
  ) values (
    v_rebate_id,
    p_seller_user_id,
    v_subscription.id,
    p_market_order_id,
    v_currency,
    p_fee_amount,
    v_plan.fee_rebate_bps,
    v_rebate_amount,
    'pending',
    v_key,
    jsonb_build_object('listing_id', v_order.listing_id)
  )
  returning * into v_existing_rebate;

  v_credit := api._credit_balance(
    p_seller_user_id,
    v_currency,
    v_rebate_amount,
    'vip_fee_rebate',
    v_rebate_id,
    null,
    'vip:fee_rebate:' || p_market_order_id::text || ':' || p_seller_user_id::text,
    'VIP market fee rebate',
    jsonb_build_object(
      'market_order_id', p_market_order_id,
      'subscription_id', v_subscription.id,
      'original_fee_amount', p_fee_amount,
      'rebate_bps', v_plan.fee_rebate_bps
    )
  );
  v_ledger_id := (v_credit ->> 'ledger_id')::uuid;

  update vip.vip_fee_rebates
  set ledger_id = v_ledger_id,
      status = 'granted',
      metadata = metadata || jsonb_build_object('ledger_id', v_ledger_id)
  where id = v_rebate_id
  returning * into v_existing_rebate;

  insert into vip.vip_benefit_ledger (
    user_id,
    subscription_id,
    benefit_type,
    entry_type,
    amount,
    currency_code,
    source_type,
    source_id,
    idempotency_key,
    metadata
  ) values (
    p_seller_user_id,
    v_subscription.id,
    'fee_rebate',
    'grant',
    v_rebate_amount,
    v_currency,
    'vip_fee_rebate',
    v_rebate_id,
    'vip:benefit:fee_rebate:' || p_market_order_id::text || ':' || p_seller_user_id::text,
    jsonb_build_object(
      'market_order_id', p_market_order_id,
      'ledger_id', v_ledger_id,
      'original_fee_amount', p_fee_amount,
      'rebate_bps', v_plan.fee_rebate_bps
    )
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'applied', true,
    'idempotent', false,
    'rebate_id', v_rebate_id,
    'ledger_id', v_ledger_id,
    'rebate_amount', v_rebate_amount,
    'rebate_bps', v_plan.fee_rebate_bps,
    'credit', v_credit
  );
end;
$$;

create or replace function api.vip_expire_subscriptions_job(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_expired_count integer := 0;
begin
  with due as (
    select id
    from vip.vip_subscriptions
    where status = 'active'
      and current_period_end <= now()
    order by current_period_end asc
    limit v_limit
    for update skip locked
  ),
  updated as (
    update vip.vip_subscriptions s
    set status = 'expired',
        expired_at = coalesce(expired_at, now()),
        updated_at = now()
    from due
    where s.id = due.id
    returning s.id
  )
  select count(*)::integer into v_expired_count
  from updated;

  return jsonb_build_object(
    'expired_count', v_expired_count,
    'limit', v_limit,
    'server_time', now()
  );
end;
$$;

create or replace function api.payment_mark_precheckout_checked(
  p_update_id bigint,
  p_pre_checkout_query_id text,
  p_invoice_payload text,
  p_currency text,
  p_total_amount integer,
  p_telegram_user_id bigint default null,
  p_raw_update jsonb default '{}'::jsonb,
  p_request_headers_hash text default null,
  p_request_id text default null,
  p_webhook_secret_verified boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_event payments.telegram_webhook_events%rowtype;
  v_star_order payments.star_orders%rowtype;
  v_draw_order gacha.draw_orders%rowtype;
  v_vip_order vip.vip_orders%rowtype;
  v_plan vip.vip_plans%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_event_inserted boolean := false;
  v_allowed boolean := true;
  v_reason_code text := null;
  v_error_message text := null;
  v_target_payment_status text := null;
  v_target_draw_status text := null;
  v_target_vip_status text := null;
  v_normalized_payload text := nullif(trim(coalesce(p_invoice_payload, '')), '');
  v_normalized_currency text := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_pre_checkout_query_id text := nullif(trim(coalesce(p_pre_checkout_query_id, '')), '');
  v_duration_ms integer;
begin
  if p_update_id is null then
    raise exception 'update_id is required';
  end if;

  if v_pre_checkout_query_id is null then
    raise exception 'pre_checkout_query_id is required';
  end if;

  insert into payments.telegram_webhook_events (
    update_id,
    event_type,
    telegram_user_id,
    invoice_payload,
    payload,
    process_status,
    request_headers_hash,
    webhook_secret_verified
  )
  values (
    p_update_id,
    'pre_checkout_query',
    p_telegram_user_id,
    v_normalized_payload,
    coalesce(p_raw_update, '{}'::jsonb),
    'processing',
    nullif(trim(coalesce(p_request_headers_hash, '')), ''),
    p_webhook_secret_verified
  )
  on conflict (update_id) do nothing
  returning * into v_event;

  v_event_inserted := v_event.id is not null;

  if not v_event_inserted then
    select * into v_event
    from payments.telegram_webhook_events
    where update_id = p_update_id
    for update;

    if v_event.id is null then
      raise exception 'telegram webhook event not found after update_id conflict';
    end if;

    if v_event.event_type = 'pre_checkout_query'
       and v_event.process_status = 'processed' then
      return jsonb_build_object(
        'allowed', true,
        'idempotent', true,
        'event_id', v_event.id,
        'invoice_payload', coalesce(v_event.invoice_payload, v_normalized_payload),
        'reason_code', null,
        'error_message', null
      );
    end if;

    update payments.telegram_webhook_events
    set event_type = 'pre_checkout_query',
        telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
        invoice_payload = coalesce(v_normalized_payload, invoice_payload),
        process_status = 'processing',
        request_headers_hash = coalesce(nullif(trim(coalesce(p_request_headers_hash, '')), ''), request_headers_hash),
        webhook_secret_verified = webhook_secret_verified or p_webhook_secret_verified,
        processed_at = null,
        processing_duration_ms = null,
        error_message = null
    where id = v_event.id
    returning * into v_event;
  end if;

  if v_normalized_payload is null then
    v_allowed := false;
    v_reason_code := 'PAYLOAD_REQUIRED';
    v_error_message := 'Payment payload is invalid.';
  end if;

  if v_allowed and v_normalized_currency <> 'XTR' then
    v_allowed := false;
    v_reason_code := 'CURRENCY_INVALID';
    v_error_message := 'Stars currency is invalid.';
    v_target_payment_status := 'failed';
    v_target_draw_status := 'failed';
    v_target_vip_status := 'failed';
  end if;

  if v_allowed and (p_total_amount is null or p_total_amount <= 0) then
    v_allowed := false;
    v_reason_code := 'AMOUNT_INVALID';
    v_error_message := 'Stars amount is invalid.';
    v_target_payment_status := 'failed';
    v_target_draw_status := 'failed';
    v_target_vip_status := 'failed';
  end if;

  if v_normalized_payload is not null then
    select * into v_star_order
    from payments.star_orders
    where telegram_invoice_payload = v_normalized_payload
    for update;
  end if;

  if v_allowed and v_star_order.id is null then
    v_allowed := false;
    v_reason_code := 'ORDER_NOT_FOUND';
    v_error_message := 'Payment order not found.';
  end if;

  if v_allowed and p_telegram_user_id is null then
    v_allowed := false;
    v_reason_code := 'TELEGRAM_USER_REQUIRED';
    v_error_message := 'Telegram payment user is invalid.';
  end if;

  if v_allowed and not exists (
    select 1
    from core.users u
    where u.id = v_star_order.user_id
      and u.telegram_user_id = p_telegram_user_id
  ) then
    v_allowed := false;
    v_reason_code := 'TELEGRAM_USER_MISMATCH';
    v_error_message := 'Telegram payment user does not match the order.';
  end if;

  if v_allowed and v_star_order.business_type not in ('gacha_open', 'vip_monthly') then
    v_allowed := false;
    v_reason_code := 'BUSINESS_TYPE_INVALID';
    v_error_message := 'Payment order business type is invalid.';
    v_target_payment_status := 'failed';
  end if;

  if v_allowed and v_star_order.xtr_amount <> p_total_amount then
    v_allowed := false;
    v_reason_code := 'AMOUNT_MISMATCH';
    v_error_message := 'Stars amount does not match the order.';
    v_target_payment_status := 'failed';
    v_target_draw_status := 'failed';
    v_target_vip_status := 'failed';
  end if;

  if v_allowed and v_star_order.status not in (
    'created',
    'invoice_created',
    'precheckout_ok',
    'precheckout_checked'
  ) then
    v_allowed := false;
    v_reason_code := 'ORDER_STATUS_NOT_PAYABLE';
    v_error_message := 'Payment order is not payable.';
  end if;

  if v_allowed and v_star_order.expires_at is not null and v_star_order.expires_at <= now() then
    v_allowed := false;
    v_reason_code := 'ORDER_EXPIRED';
    v_error_message := 'Payment order expired.';
    v_target_payment_status := 'expired';
    v_target_draw_status := 'expired';
    v_target_vip_status := 'expired';
  end if;

  if v_star_order.id is not null and v_star_order.business_type = 'gacha_open' then
    select * into v_draw_order
    from gacha.draw_orders
    where id = v_star_order.business_id
      and payment_star_order_id = v_star_order.id
    for update;

    if v_allowed and v_draw_order.id is null then
      v_allowed := false;
      v_reason_code := 'DRAW_ORDER_NOT_FOUND';
      v_error_message := 'Draw order not found.';
      v_target_payment_status := 'failed';
    end if;

    if v_allowed and v_draw_order.user_id <> v_star_order.user_id then
      v_allowed := false;
      v_reason_code := 'DRAW_ORDER_USER_MISMATCH';
      v_error_message := 'Draw order user mismatch.';
      v_target_payment_status := 'failed';
      v_target_draw_status := 'failed';
    end if;

    if v_allowed and v_draw_order.status not in ('created', 'invoice_created') then
      v_allowed := false;
      v_reason_code := 'DRAW_ORDER_STATUS_NOT_PAYABLE';
      v_error_message := 'Draw order is not payable.';
    end if;

    if v_allowed and coalesce(v_draw_order.payment_status, 'pending') not in ('created', 'pending') then
      v_allowed := false;
      v_reason_code := 'DRAW_ORDER_PAYMENT_STATUS_NOT_PAYABLE';
      v_error_message := 'Draw order payment status is not payable.';
    end if;

    if v_allowed and v_draw_order.total_price_stars <> p_total_amount then
      v_allowed := false;
      v_reason_code := 'DRAW_ORDER_AMOUNT_MISMATCH';
      v_error_message := 'Draw order amount mismatch.';
      v_target_payment_status := 'failed';
      v_target_draw_status := 'failed';
    end if;

    if v_allowed then
      select * into v_box
      from gacha.blind_boxes
      where id = v_draw_order.box_id
      for update;

      if v_box.id is null then
        v_allowed := false;
        v_reason_code := 'BLIND_BOX_NOT_FOUND';
        v_error_message := 'Blind box not found.';
        v_target_payment_status := 'failed';
        v_target_draw_status := 'failed';
      elsif v_box.status <> 'active'
         or (v_box.starts_at is not null and v_box.starts_at > now())
         or (v_box.ends_at is not null and v_box.ends_at <= now()) then
        v_allowed := false;
        v_reason_code := 'BLIND_BOX_UNAVAILABLE';
        v_error_message := 'Blind box is unavailable.';
        v_target_payment_status := 'failed';
        v_target_draw_status := 'failed';
      end if;
    end if;
  elsif v_star_order.id is not null and v_star_order.business_type = 'vip_monthly' then
    select * into v_vip_order
    from vip.vip_orders
    where id = v_star_order.business_id
      and star_order_id = v_star_order.id
    for update;

    if v_allowed and v_vip_order.id is null then
      v_allowed := false;
      v_reason_code := 'VIP_ORDER_NOT_FOUND';
      v_error_message := 'VIP order not found.';
      v_target_payment_status := 'failed';
    end if;

    if v_allowed and v_vip_order.user_id <> v_star_order.user_id then
      v_allowed := false;
      v_reason_code := 'VIP_ORDER_USER_MISMATCH';
      v_error_message := 'VIP order user mismatch.';
      v_target_payment_status := 'failed';
      v_target_vip_status := 'failed';
    end if;

    if v_allowed and v_vip_order.status not in ('created', 'invoice_created') then
      v_allowed := false;
      v_reason_code := 'VIP_ORDER_STATUS_NOT_PAYABLE';
      v_error_message := 'VIP order is not payable.';
    end if;

    if v_allowed and v_vip_order.xtr_amount <> p_total_amount then
      v_allowed := false;
      v_reason_code := 'VIP_ORDER_AMOUNT_MISMATCH';
      v_error_message := 'VIP order amount mismatch.';
      v_target_payment_status := 'failed';
      v_target_vip_status := 'failed';
    end if;

    if v_allowed and v_vip_order.invoice_payload <> v_normalized_payload then
      v_allowed := false;
      v_reason_code := 'VIP_ORDER_PAYLOAD_MISMATCH';
      v_error_message := 'VIP order payload mismatch.';
      v_target_payment_status := 'failed';
      v_target_vip_status := 'failed';
    end if;

    if v_allowed then
      select * into v_plan
      from vip.vip_plans
      where id = v_vip_order.plan_id;

      if v_plan.id is null then
        v_allowed := false;
        v_reason_code := 'VIP_PLAN_NOT_FOUND';
        v_error_message := 'VIP plan not found.';
        v_target_payment_status := 'failed';
        v_target_vip_status := 'failed';
      elsif v_plan.status <> 'active'
         or (v_plan.starts_at is not null and v_plan.starts_at > now())
         or (v_plan.ends_at is not null and v_plan.ends_at <= now()) then
        v_allowed := false;
        v_reason_code := 'VIP_PLAN_UNAVAILABLE';
        v_error_message := 'VIP plan is unavailable.';
        v_target_payment_status := 'failed';
        v_target_vip_status := 'failed';
      end if;
    end if;
  end if;

  v_duration_ms := greatest(
    floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
    0
  );

  if not v_allowed then
    if v_star_order.id is not null then
      update payments.star_orders
      set status = case
            when v_target_payment_status is not null
             and status in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked')
              then v_target_payment_status
            else status
          end,
          error_message = left(v_error_message, 1000),
          updated_at = now()
      where id = v_star_order.id
      returning * into v_star_order;
    end if;

    if v_draw_order.id is not null then
      update gacha.draw_orders
      set status = case
            when v_target_draw_status is not null
             and status in ('created', 'invoice_created')
              then v_target_draw_status
            else status
          end,
          payment_status = case
            when v_target_draw_status is not null
             and coalesce(payment_status, 'pending') in ('created', 'pending')
              then v_target_draw_status
            else payment_status
          end,
          error_message = left(v_error_message, 1000),
          updated_at = now()
      where id = v_draw_order.id;
    end if;

    if v_vip_order.id is not null then
      update vip.vip_orders
      set status = case
            when v_target_vip_status is not null
             and status in ('created', 'invoice_created')
              then v_target_vip_status
            else status
          end,
          error_message = left(v_error_message, 1000),
          updated_at = now()
      where id = v_vip_order.id
      returning * into v_vip_order;
    end if;

    update payments.telegram_webhook_events
    set user_id = coalesce(v_star_order.user_id, user_id),
        process_status = 'failed',
        processed_at = now(),
        processing_duration_ms = v_duration_ms,
        error_message = left(v_error_message, 1000)
    where id = v_event.id
    returning * into v_event;

    return jsonb_build_object(
      'allowed', false,
      'idempotent', not v_event_inserted,
      'event_id', v_event.id,
      'star_order_id', v_star_order.id,
      'business_type', v_star_order.business_type,
      'business_id', v_star_order.business_id,
      'draw_order_id', v_draw_order.id,
      'vip_order_id', v_vip_order.id,
      'invoice_payload', v_normalized_payload,
      'reason_code', v_reason_code,
      'error_message', v_error_message,
      'payment_order_status', v_star_order.status
    );
  end if;

  update payments.star_orders
  set status = 'precheckout_checked',
      precheckout_at = coalesce(precheckout_at, now()),
      error_message = null,
      updated_at = now()
  where id = v_star_order.id
  returning * into v_star_order;

  if v_star_order.business_type = 'gacha_open' then
    update gacha.draw_orders
    set payment_status = case
          when payment_status is null or payment_status = 'created' then 'pending'
          else payment_status
        end,
        error_message = null,
        updated_at = now()
    where id = v_draw_order.id
    returning * into v_draw_order;
  elsif v_star_order.business_type = 'vip_monthly' then
    update vip.vip_orders
    set status = case when status = 'created' then 'invoice_created' else status end,
        error_message = null,
        updated_at = now()
    where id = v_vip_order.id
    returning * into v_vip_order;
  end if;

  update payments.telegram_webhook_events
  set user_id = v_star_order.user_id,
      telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
      invoice_payload = v_normalized_payload,
      process_status = 'processed',
      processed_at = now(),
      processing_duration_ms = v_duration_ms,
      error_message = null
  where id = v_event.id
  returning * into v_event;

  return jsonb_build_object(
    'allowed', true,
    'idempotent', not v_event_inserted,
    'event_id', v_event.id,
    'star_order_id', v_star_order.id,
    'business_type', v_star_order.business_type,
    'business_id', v_star_order.business_id,
    'draw_order_id', v_draw_order.id,
    'vip_order_id', v_vip_order.id,
    'user_id', v_star_order.user_id,
    'telegram_user_id', p_telegram_user_id,
    'invoice_payload', v_normalized_payload,
    'reason_code', null,
    'error_message', null,
    'payment_order_status', v_star_order.status,
    'precheckout_at', v_star_order.precheckout_at
  );
end;
$$;

create or replace function api.payment_record_successful_payment(
  p_update_id bigint,
  p_invoice_payload text,
  p_currency text,
  p_total_amount integer,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_telegram_user_id bigint default null,
  p_raw_update jsonb default '{}'::jsonb,
  p_request_headers_hash text default null,
  p_request_id text default null,
  p_webhook_secret_verified boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_event payments.telegram_webhook_events%rowtype;
  v_star_order payments.star_orders%rowtype;
  v_star_payment payments.star_payments%rowtype;
  v_existing_charge_payment payments.star_payments%rowtype;
  v_existing_order_payment payments.star_payments%rowtype;
  v_vip_order vip.vip_orders%rowtype;
  v_draw_order_id uuid;
  v_vip_order_id uuid;
  v_event_inserted boolean := false;
  v_normalized_payload text := nullif(trim(coalesce(p_invoice_payload, '')), '');
  v_normalized_currency text := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_telegram_payment_charge_id text := nullif(trim(coalesce(p_telegram_payment_charge_id, '')), '');
  v_provider_payment_charge_id text := nullif(trim(coalesce(p_provider_payment_charge_id, '')), '');
  v_reason_code text := null;
  v_error_message text := null;
  v_duration_ms integer := 0;
begin
  if p_update_id is null then
    raise exception 'update_id is required';
  end if;

  insert into payments.telegram_webhook_events (
    update_id,
    event_type,
    telegram_user_id,
    invoice_payload,
    payload,
    process_status,
    request_headers_hash,
    webhook_secret_verified
  )
  values (
    p_update_id,
    'successful_payment',
    p_telegram_user_id,
    v_normalized_payload,
    coalesce(p_raw_update, '{}'::jsonb),
    'processing',
    nullif(trim(coalesce(p_request_headers_hash, '')), ''),
    p_webhook_secret_verified
  )
  on conflict (update_id) do nothing
  returning * into v_event;

  v_event_inserted := v_event.id is not null;

  if not v_event_inserted then
    select * into v_event
    from payments.telegram_webhook_events
    where update_id = p_update_id
    for update;

    if v_event.id is null then
      raise exception 'telegram webhook event not found after update_id conflict';
    end if;

    if v_event.event_type = 'successful_payment'
       and v_event.process_status in ('processed', 'ignored') then
      if v_telegram_payment_charge_id is not null then
        select * into v_star_payment
        from payments.star_payments
        where telegram_payment_charge_id = v_telegram_payment_charge_id;
      end if;

      if v_star_payment.id is null and coalesce(v_event.invoice_payload, v_normalized_payload) is not null then
        select * into v_star_payment
        from payments.star_payments
        where invoice_payload = coalesce(v_event.invoice_payload, v_normalized_payload)
        order by paid_at desc, created_at desc
        limit 1;
      end if;

      if v_star_payment.id is not null then
        select * into v_star_order
        from payments.star_orders
        where id = v_star_payment.star_order_id;
      elsif coalesce(v_event.invoice_payload, v_normalized_payload) is not null then
        select * into v_star_order
        from payments.star_orders
        where telegram_invoice_payload = coalesce(v_event.invoice_payload, v_normalized_payload);
      end if;

      v_draw_order_id := case when v_star_order.business_type = 'gacha_open' then v_star_order.business_id else null end;
      v_vip_order_id := case when v_star_order.business_type = 'vip_monthly' then v_star_order.business_id else null end;

      return jsonb_build_object(
        'payment_recorded', false,
        'idempotent', true,
        'duplicate_update', true,
        'duplicate_charge', false,
        'event_id', v_event.id,
        'star_order_id', v_star_order.id,
        'star_payment_id', v_star_payment.id,
        'business_type', v_star_order.business_type,
        'business_id', v_star_order.business_id,
        'draw_order_id', v_draw_order_id,
        'vip_order_id', v_vip_order_id,
        'invoice_payload', coalesce(v_event.invoice_payload, v_normalized_payload),
        'telegram_payment_charge_id', v_telegram_payment_charge_id,
        'reason_code', null,
        'error_message', null,
        'payment_order_status', v_star_order.status,
        'process_status', v_event.process_status
      );
    end if;

    if v_event.event_type <> 'successful_payment' then
      return jsonb_build_object(
        'payment_recorded', false,
        'idempotent', true,
        'duplicate_update', true,
        'duplicate_charge', false,
        'event_id', v_event.id,
        'star_order_id', null,
        'star_payment_id', null,
        'business_type', null,
        'business_id', null,
        'draw_order_id', null,
        'vip_order_id', null,
        'invoice_payload', coalesce(v_event.invoice_payload, v_normalized_payload),
        'telegram_payment_charge_id', v_telegram_payment_charge_id,
        'reason_code', 'UPDATE_ID_EVENT_TYPE_CONFLICT',
        'error_message', 'Telegram update_id is already used by another event type.',
        'payment_order_status', null,
        'process_status', v_event.process_status
      );
    end if;

    update payments.telegram_webhook_events
    set telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
        invoice_payload = coalesce(v_normalized_payload, invoice_payload),
        payload = coalesce(p_raw_update, payload),
        process_status = 'processing',
        request_headers_hash = coalesce(nullif(trim(coalesce(p_request_headers_hash, '')), ''), request_headers_hash),
        webhook_secret_verified = webhook_secret_verified or p_webhook_secret_verified,
        processed_at = null,
        processing_duration_ms = null,
        error_message = null
    where id = v_event.id
    returning * into v_event;
  end if;

  if v_telegram_payment_charge_id is null then
    v_reason_code := 'TELEGRAM_PAYMENT_CHARGE_ID_REQUIRED';
    v_error_message := 'Telegram payment charge id is required.';
  elsif v_normalized_payload is null then
    v_reason_code := 'PAYLOAD_REQUIRED';
    v_error_message := 'Payment payload is invalid.';
  elsif v_normalized_currency is distinct from 'XTR' then
    v_reason_code := 'CURRENCY_INVALID';
    v_error_message := 'Stars currency is invalid.';
  elsif p_total_amount is null or p_total_amount <= 0 then
    v_reason_code := 'AMOUNT_INVALID';
    v_error_message := 'Stars amount is invalid.';
  end if;

  if v_normalized_payload is not null then
    select * into v_star_order
    from payments.star_orders
    where telegram_invoice_payload = v_normalized_payload
    for update;
  end if;

  if v_reason_code is null and v_star_order.id is null then
    v_reason_code := 'ORDER_NOT_FOUND';
    v_error_message := 'Payment order not found.';
  end if;

  if v_reason_code is null and p_telegram_user_id is null then
    v_reason_code := 'TELEGRAM_USER_REQUIRED';
    v_error_message := 'Telegram payment user is invalid.';
  end if;

  if v_reason_code is null and not exists (
    select 1
    from core.users u
    where u.id = v_star_order.user_id
      and u.telegram_user_id = p_telegram_user_id
  ) then
    v_reason_code := 'TELEGRAM_USER_MISMATCH';
    v_error_message := 'Telegram payment user does not match the order.';
  end if;

  if v_reason_code is null and v_star_order.business_type not in ('gacha_open', 'vip_monthly') then
    v_reason_code := 'BUSINESS_TYPE_INVALID';
    v_error_message := 'Payment order business type is invalid.';
  end if;

  if v_reason_code is null and v_star_order.xtr_amount <> p_total_amount then
    v_reason_code := 'AMOUNT_MISMATCH';
    v_error_message := 'Stars amount does not match the order.';
  end if;

  if v_telegram_payment_charge_id is not null then
    select * into v_existing_charge_payment
    from payments.star_payments
    where telegram_payment_charge_id = v_telegram_payment_charge_id
    for update;
  end if;

  if v_reason_code is null and v_existing_charge_payment.id is not null then
    if v_star_order.id is not null
       and v_existing_charge_payment.star_order_id = v_star_order.id
       and v_existing_charge_payment.invoice_payload = v_normalized_payload then
      update payments.telegram_webhook_events
      set user_id = v_star_order.user_id,
          telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
          invoice_payload = v_normalized_payload,
          process_status = 'ignored',
          processed_at = now(),
          processing_duration_ms = greatest(
            floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
            0
          ),
          error_message = null
      where id = v_event.id
      returning * into v_event;

      v_draw_order_id := case when v_star_order.business_type = 'gacha_open' then v_star_order.business_id else null end;
      v_vip_order_id := case when v_star_order.business_type = 'vip_monthly' then v_star_order.business_id else null end;

      return jsonb_build_object(
        'payment_recorded', false,
        'idempotent', true,
        'duplicate_update', not v_event_inserted,
        'duplicate_charge', true,
        'event_id', v_event.id,
        'star_order_id', v_star_order.id,
        'star_payment_id', v_existing_charge_payment.id,
        'business_type', v_star_order.business_type,
        'business_id', v_star_order.business_id,
        'draw_order_id', v_draw_order_id,
        'vip_order_id', v_vip_order_id,
        'invoice_payload', v_normalized_payload,
        'telegram_payment_charge_id', v_telegram_payment_charge_id,
        'reason_code', null,
        'error_message', null,
        'payment_order_status', v_star_order.status,
        'process_status', v_event.process_status
      );
    else
      v_reason_code := 'PAYMENT_CHARGE_CONFLICT';
      v_error_message := 'Telegram payment charge id is already bound to another order.';
    end if;
  end if;

  if v_reason_code is null and v_star_order.status in (
    'fulfilled',
    'fulfilling',
    'refunded',
    'disputed',
    'cancelled',
    'expired',
    'failed'
  ) then
    v_reason_code := case
      when v_star_order.status = 'fulfilled' then 'ORDER_ALREADY_FULFILLED'
      else 'ORDER_STATUS_NOT_PAYABLE'
    end;
    v_error_message := 'Payment order status cannot record successful payment.';
  end if;

  if v_reason_code is null and v_star_order.id is not null then
    select * into v_existing_order_payment
    from payments.star_payments
    where star_order_id = v_star_order.id
    order by paid_at desc, created_at desc
    limit 1
    for update;

    if v_existing_order_payment.id is not null then
      v_reason_code := 'ORDER_ALREADY_PAID';
      v_error_message := 'Payment order already has a successful payment.';
    end if;
  end if;

  if v_star_order.business_type = 'vip_monthly' then
    select * into v_vip_order
    from vip.vip_orders
    where id = v_star_order.business_id
      and star_order_id = v_star_order.id
    for update;

    if v_reason_code is null and v_vip_order.id is null then
      v_reason_code := 'VIP_ORDER_NOT_FOUND';
      v_error_message := 'VIP order not found.';
    elsif v_reason_code is null and v_vip_order.user_id <> v_star_order.user_id then
      v_reason_code := 'VIP_ORDER_USER_MISMATCH';
      v_error_message := 'VIP order user mismatch.';
    elsif v_reason_code is null and v_vip_order.xtr_amount <> p_total_amount then
      v_reason_code := 'VIP_ORDER_AMOUNT_MISMATCH';
      v_error_message := 'VIP order amount mismatch.';
    elsif v_reason_code is null and v_vip_order.invoice_payload <> v_normalized_payload then
      v_reason_code := 'VIP_ORDER_PAYLOAD_MISMATCH';
      v_error_message := 'VIP order payload mismatch.';
    end if;
  end if;

  v_draw_order_id := case when v_star_order.business_type = 'gacha_open' then v_star_order.business_id else null end;
  v_vip_order_id := case when v_star_order.business_type = 'vip_monthly' then v_star_order.business_id else null end;

  if v_reason_code is not null then
    v_duration_ms := greatest(
      floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
      0
    );

    if v_star_order.id is not null
       and v_reason_code in ('CURRENCY_INVALID', 'AMOUNT_INVALID', 'AMOUNT_MISMATCH', 'BUSINESS_TYPE_INVALID', 'VIP_ORDER_AMOUNT_MISMATCH', 'VIP_ORDER_PAYLOAD_MISMATCH')
       and v_star_order.status in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked') then
      update payments.star_orders
      set status = 'failed',
          error_message = left(v_error_message, 1000),
          updated_at = now()
      where id = v_star_order.id
      returning * into v_star_order;
    end if;

    if v_vip_order.id is not null
       and v_reason_code in ('AMOUNT_MISMATCH', 'VIP_ORDER_AMOUNT_MISMATCH', 'VIP_ORDER_PAYLOAD_MISMATCH')
       and v_vip_order.status in ('created', 'invoice_created') then
      update vip.vip_orders
      set status = 'failed',
          error_message = left(v_error_message, 1000),
          updated_at = now()
      where id = v_vip_order.id
      returning * into v_vip_order;
    end if;

    update payments.telegram_webhook_events
    set user_id = coalesce(v_star_order.user_id, user_id),
        telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
        invoice_payload = coalesce(v_normalized_payload, invoice_payload),
        process_status = 'failed',
        processed_at = now(),
        processing_duration_ms = v_duration_ms,
        error_message = left(v_error_message, 1000)
    where id = v_event.id
    returning * into v_event;

    return jsonb_build_object(
      'payment_recorded', false,
      'idempotent', not v_event_inserted,
      'duplicate_update', not v_event_inserted,
      'duplicate_charge', false,
      'event_id', v_event.id,
      'star_order_id', v_star_order.id,
      'star_payment_id', null,
      'business_type', v_star_order.business_type,
      'business_id', v_star_order.business_id,
      'draw_order_id', v_draw_order_id,
      'vip_order_id', v_vip_order_id,
      'invoice_payload', v_normalized_payload,
      'telegram_payment_charge_id', v_telegram_payment_charge_id,
      'reason_code', v_reason_code,
      'error_message', v_error_message,
      'payment_order_status', v_star_order.status,
      'process_status', v_event.process_status
    );
  end if;

  insert into payments.star_payments (
    star_order_id,
    user_id,
    telegram_payment_charge_id,
    provider_payment_charge_id,
    xtr_amount,
    currency,
    invoice_payload,
    raw_update
  )
  values (
    v_star_order.id,
    v_star_order.user_id,
    v_telegram_payment_charge_id,
    v_provider_payment_charge_id,
    v_star_order.xtr_amount,
    'XTR',
    v_normalized_payload,
    coalesce(p_raw_update, '{}'::jsonb)
  )
  on conflict (telegram_payment_charge_id) do nothing
  returning * into v_star_payment;

  if v_star_payment.id is null then
    select * into v_existing_charge_payment
    from payments.star_payments
    where telegram_payment_charge_id = v_telegram_payment_charge_id
    for update;

    if v_existing_charge_payment.id is not null
       and v_existing_charge_payment.star_order_id = v_star_order.id
       and v_existing_charge_payment.invoice_payload = v_normalized_payload then
      update payments.telegram_webhook_events
      set user_id = v_star_order.user_id,
          telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
          invoice_payload = v_normalized_payload,
          process_status = 'ignored',
          processed_at = now(),
          processing_duration_ms = greatest(
            floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
            0
          ),
          error_message = null
      where id = v_event.id
      returning * into v_event;

      return jsonb_build_object(
        'payment_recorded', false,
        'idempotent', true,
        'duplicate_update', not v_event_inserted,
        'duplicate_charge', true,
        'event_id', v_event.id,
        'star_order_id', v_star_order.id,
        'star_payment_id', v_existing_charge_payment.id,
        'business_type', v_star_order.business_type,
        'business_id', v_star_order.business_id,
        'draw_order_id', v_draw_order_id,
        'vip_order_id', v_vip_order_id,
        'invoice_payload', v_normalized_payload,
        'telegram_payment_charge_id', v_telegram_payment_charge_id,
        'reason_code', null,
        'error_message', null,
        'payment_order_status', v_star_order.status,
        'process_status', v_event.process_status
      );
    end if;

    raise exception 'successful payment insert conflicted without matching payment row';
  end if;

  update payments.star_orders
  set status = 'paid',
      paid_at = coalesce(paid_at, v_star_payment.paid_at, now()),
      error_message = null,
      updated_at = now()
  where id = v_star_order.id
  returning * into v_star_order;

  if v_vip_order.id is not null then
    update vip.vip_orders
    set status = 'paid',
        paid_at = coalesce(paid_at, v_star_payment.paid_at, now()),
        error_message = null,
        updated_at = now()
    where id = v_vip_order.id
    returning * into v_vip_order;
  end if;

  v_duration_ms := greatest(
    floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer,
    0
  );

  update payments.telegram_webhook_events
  set user_id = v_star_order.user_id,
      telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
      invoice_payload = v_normalized_payload,
      process_status = 'processed',
      processed_at = now(),
      processing_duration_ms = v_duration_ms,
      error_message = null
  where id = v_event.id
  returning * into v_event;

  return jsonb_build_object(
    'payment_recorded', true,
    'idempotent', false,
    'duplicate_update', false,
    'duplicate_charge', false,
    'event_id', v_event.id,
    'star_order_id', v_star_order.id,
    'star_payment_id', v_star_payment.id,
    'business_type', v_star_order.business_type,
    'business_id', v_star_order.business_id,
    'draw_order_id', v_draw_order_id,
    'vip_order_id', v_vip_order_id,
    'invoice_payload', v_normalized_payload,
    'telegram_payment_charge_id', v_telegram_payment_charge_id,
    'reason_code', null,
    'error_message', null,
    'payment_order_status', v_star_order.status,
    'process_status', v_event.process_status,
    'paid_at', v_star_order.paid_at
  );
end;
$$;

create or replace function api.gacha_process_paid_order(
  p_star_order_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_raw_update jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_star_order payments.star_orders%rowtype;
  v_result jsonb;
  v_draw_order_id uuid;
  v_user_id uuid;
  v_draw_count integer;
  v_event_date date;
  v_progress_result jsonb;
begin
  if p_star_order_id is null then
    raise exception 'star_order_id is required';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id;

  if v_star_order.id is null then
    raise exception 'star order not found';
  end if;

  if v_star_order.business_type = 'vip_monthly' then
    return api.vip_process_paid_order(
      p_star_order_id,
      p_telegram_payment_charge_id,
      p_provider_payment_charge_id,
      p_raw_update
    );
  end if;

  v_result := api.gacha_process_paid_order_without_task_progress(
    p_star_order_id,
    p_telegram_payment_charge_id,
    p_provider_payment_charge_id,
    p_raw_update
  );

  v_draw_order_id := nullif(v_result ->> 'draw_order_id', '')::uuid;

  if v_draw_order_id is not null then
    select
      user_id,
      greatest(coalesce(draw_count, quantity, 1), 1),
      coalesce(opened_at, updated_at, now())::date
    into v_user_id, v_draw_count, v_event_date
    from gacha.draw_orders
    where id = v_draw_order_id;

    if v_user_id is not null then
      v_progress_result := api.task_record_progress(
        v_user_id,
        'gacha_open_success',
        v_draw_count,
        v_draw_order_id,
        coalesce(v_event_date, current_date)::text
      );

      v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function api.market_buy_listing(
  p_buyer_user_id uuid,
  p_listing_id uuid,
  p_quantity integer,
  p_expected_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_buyer_user_id uuid;
  v_seller_user_id uuid;
  v_fee_amount numeric(38,0);
  v_item_count integer;
  v_event_date date;
  v_progress_result jsonb;
  v_rebate_result jsonb;
begin
  v_result := api.market_buy_listing_without_task_progress(
    p_buyer_user_id,
    p_listing_id,
    p_quantity,
    p_expected_unit_price_kcoin,
    p_idempotency_key
  );

  v_order_id := nullif(v_result ->> 'order_id', '')::uuid;

  if v_order_id is not null then
    select
      buyer_user_id,
      seller_user_id,
      fee_amount_kcoin,
      greatest(coalesce(item_count, p_quantity, 1), 1),
      coalesce(completed_at, updated_at, created_at, now())::date
    into v_buyer_user_id, v_seller_user_id, v_fee_amount, v_item_count, v_event_date
    from market.orders
    where id = v_order_id;

    if v_buyer_user_id is not null then
      v_progress_result := api.task_record_progress(
        v_buyer_user_id,
        'market_order_completed',
        v_item_count,
        v_order_id,
        coalesce(v_event_date, current_date)::text
      );

      v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
    end if;

    if v_seller_user_id is not null and coalesce(v_fee_amount, 0) > 0 then
      v_rebate_result := api.vip_apply_market_fee_rebate(
        v_order_id,
        v_seller_user_id,
        v_fee_amount,
        'KCOIN',
        'vip_fee_rebate:market_order:' || v_order_id::text
      );

      v_result := v_result || jsonb_build_object('vip_fee_rebate', v_rebate_result);
    end if;
  end if;

  return v_result;
end;
$$;

comment on function api.vip_get_status(uuid) is 'Returns the trusted VIP monthly status and UTC daily claim state for one user.';
comment on function api.vip_create_order_checked(uuid, uuid, text, integer) is 'Creates a VIP monthly Stars order after checking plan price and idempotency.';
comment on function api.vip_process_paid_order(uuid, text, text, jsonb) is 'Fulfills a paid VIP monthly Stars order by opening or extending the subscription exactly once.';
comment on function api.vip_claim_daily_benefit(uuid, text) is 'Claims one UTC daily VIP benefit and credits FGEMS through economy.currency_ledger.';
comment on function api.vip_consume_daily_free_box(uuid, text) is 'Consumes one free box counter from today''s UTC VIP daily claim exactly once.';
comment on function api.vip_apply_market_fee_rebate(uuid, uuid, numeric, text, text) is 'Applies the VIP market fee rebate for a completed market order exactly once.';
comment on function api.vip_expire_subscriptions_job(integer) is 'Expires active VIP subscriptions whose current period has ended.';
comment on function api.gacha_process_paid_order(uuid, text, text, jsonb) is 'Historical Stars fulfillment entrypoint. Routes vip_monthly orders to VIP fulfillment and gacha_open orders to gacha fulfillment.';

revoke execute on function api.vip_get_status(uuid) from public, anon, authenticated;
revoke execute on function api.vip_create_order_checked(uuid, uuid, text, integer) from public, anon, authenticated;
revoke execute on function api.vip_process_paid_order(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function api.vip_claim_daily_benefit(uuid, text) from public, anon, authenticated;
revoke execute on function api.vip_consume_daily_free_box(uuid, text) from public, anon, authenticated;
revoke execute on function api.vip_apply_market_fee_rebate(uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke execute on function api.vip_expire_subscriptions_job(integer) from public, anon, authenticated;
revoke execute on function api.payment_mark_precheckout_checked(bigint, text, text, text, integer, bigint, jsonb, text, text, boolean) from public, anon, authenticated;
revoke execute on function api.payment_record_successful_payment(bigint, text, text, integer, text, text, bigint, jsonb, text, text, boolean) from public, anon, authenticated;
revoke execute on function api.gacha_process_paid_order(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function api.market_buy_listing(uuid, uuid, integer, numeric, text) from public, anon, authenticated;

grant execute on function api.vip_get_status(uuid) to service_role;
grant execute on function api.vip_create_order_checked(uuid, uuid, text, integer) to service_role;
grant execute on function api.vip_process_paid_order(uuid, text, text, jsonb) to service_role;
grant execute on function api.vip_claim_daily_benefit(uuid, text) to service_role;
grant execute on function api.vip_consume_daily_free_box(uuid, text) to service_role;
grant execute on function api.vip_apply_market_fee_rebate(uuid, uuid, numeric, text, text) to service_role;
grant execute on function api.vip_expire_subscriptions_job(integer) to service_role;
grant execute on function api.payment_mark_precheckout_checked(bigint, text, text, text, integer, bigint, jsonb, text, text, boolean) to service_role;
grant execute on function api.payment_record_successful_payment(bigint, text, text, integer, text, text, bigint, jsonb, text, text, boolean) to service_role;
grant execute on function api.gacha_process_paid_order(uuid, text, text, jsonb) to service_role;
grant execute on function api.market_buy_listing(uuid, uuid, integer, numeric, text) to service_role;

commit;
