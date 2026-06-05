-- Split VIP daily benefits into two independent user actions:
-- 1) claim daily FGEMS
-- 2) claim daily free premium_egg entitlement
--
-- Old combined rows are backfilled as both benefits already claimed, so old
-- users keep the state they already had.

begin;

alter table vip.vip_daily_claims
  add column if not exists fgems_claimed_at timestamptz,
  add column if not exists fgems_idempotency_key text,
  add column if not exists free_box_claimed_at timestamptz,
  add column if not exists free_box_idempotency_key text;

alter table vip.vip_daily_claims
  drop constraint if exists vip_daily_claims_fgems_idempotency_key_check,
  add constraint vip_daily_claims_fgems_idempotency_key_check
    check (
      fgems_idempotency_key is null
      or nullif(btrim(fgems_idempotency_key), '') is not null
    );

alter table vip.vip_daily_claims
  drop constraint if exists vip_daily_claims_free_box_idempotency_key_check,
  add constraint vip_daily_claims_free_box_idempotency_key_check
    check (
      free_box_idempotency_key is null
      or nullif(btrim(free_box_idempotency_key), '') is not null
    );

create unique index if not exists vip_daily_claims_fgems_idempotency_key_uidx
  on vip.vip_daily_claims (fgems_idempotency_key)
  where fgems_idempotency_key is not null;

create unique index if not exists vip_daily_claims_free_box_idempotency_key_uidx
  on vip.vip_daily_claims (free_box_idempotency_key)
  where free_box_idempotency_key is not null;

update vip.vip_daily_claims
set fgems_claimed_at = coalesce(fgems_claimed_at, claimed_at),
    fgems_idempotency_key = coalesce(fgems_idempotency_key, idempotency_key)
where fgems_claimed_at is null
  and (fgems_ledger_id is not null or fgems_amount > 0);

update vip.vip_daily_claims
set free_box_claimed_at = coalesce(free_box_claimed_at, claimed_at),
    free_box_idempotency_key = coalesce(free_box_idempotency_key, idempotency_key)
where free_box_claimed_at is null
  and free_box_count > 0;

comment on column vip.vip_daily_claims.fgems_claimed_at is
  'UTC daily VIP FGEMS claim timestamp. Null means the user has not claimed FGEMS for this day.';
comment on column vip.vip_daily_claims.fgems_idempotency_key is
  'Client idempotency key used for the daily FGEMS claim action.';
comment on column vip.vip_daily_claims.free_box_claimed_at is
  'UTC daily VIP free-box entitlement claim timestamp. Null means the user has not claimed the free box entitlement for this day.';
comment on column vip.vip_daily_claims.free_box_idempotency_key is
  'Client idempotency key used for the daily free-box entitlement claim action.';

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
  v_claim vip.vip_daily_claims%rowtype;
  v_claim_id uuid := pg_catalog.gen_random_uuid();
  v_row_key text := null;
  v_credit jsonb := null;
  v_ledger_id uuid := null;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_daily_benefit_claim'),
    pg_catalog.hashtext(p_user_id::text || ':' || v_today::text)
  );

  select * into v_claim
  from vip.vip_daily_claims
  where fgems_idempotency_key = v_key
  for update;

  if v_claim.id is not null then
    if v_claim.user_id <> p_user_id then
      raise exception 'idempotency key conflict';
    end if;

    return jsonb_build_object(
      'claim_id', v_claim.id,
      'subscription_id', v_claim.subscription_id,
      'claim_date', v_claim.claim_date,
      'fgems_amount', v_claim.fgems_amount,
      'fgems_ledger_id', v_claim.fgems_ledger_id,
      'fgems_claimed', v_claim.fgems_claimed_at is not null,
      'fgems_claimed_at', v_claim.fgems_claimed_at,
      'free_box_count', v_claim.free_box_count,
      'free_box_used_count', v_claim.free_box_used_count,
      'remaining_free_box_count', case
        when v_claim.free_box_claimed_at is not null then greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0)
        else 0
      end,
      'free_box_available', v_claim.free_box_claimed_at is not null and greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0) > 0,
      'free_box_claimed', v_claim.free_box_claimed_at is not null,
      'free_box_claimed_at', v_claim.free_box_claimed_at,
      'already_claimed', true,
      'idempotent', true
    );
  end if;

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
  if coalesce(v_plan.daily_fgems, 0) <= 0 then
    raise exception 'VIP_DAILY_FGEMS_NOT_AVAILABLE';
  end if;

  select * into v_claim
  from vip.vip_daily_claims
  where user_id = p_user_id
    and claim_date = v_today
  for update;

  if v_claim.id is not null and v_claim.fgems_claimed_at is not null then
    return jsonb_build_object(
      'claim_id', v_claim.id,
      'subscription_id', v_claim.subscription_id,
      'claim_date', v_claim.claim_date,
      'fgems_amount', v_claim.fgems_amount,
      'fgems_ledger_id', v_claim.fgems_ledger_id,
      'fgems_claimed', true,
      'fgems_claimed_at', v_claim.fgems_claimed_at,
      'free_box_count', v_claim.free_box_count,
      'free_box_used_count', v_claim.free_box_used_count,
      'remaining_free_box_count', case
        when v_claim.free_box_claimed_at is not null then greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0)
        else 0
      end,
      'free_box_available', v_claim.free_box_claimed_at is not null and greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0) > 0,
      'free_box_claimed', v_claim.free_box_claimed_at is not null,
      'free_box_claimed_at', v_claim.free_box_claimed_at,
      'already_claimed', true,
      'idempotent', false
    );
  end if;

  if v_claim.id is null then
    v_row_key := 'vip:daily_claim_row:' || p_user_id::text || ':' || v_today::text;

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
      0,
      0,
      0,
      'claimed',
      v_row_key,
      jsonb_build_object('business_day', 'UTC', 'split_daily_benefits', true)
    )
    returning * into v_claim;
  end if;

  v_credit := api._credit_balance(
    p_user_id,
    'FGEMS',
    v_plan.daily_fgems,
    'vip_daily_claim',
    v_claim.id,
    null,
    'vip:daily_fgems:' || p_user_id::text || ':' || v_today::text,
    'VIP daily FGEMS',
    jsonb_build_object('claim_date', v_today, 'subscription_id', v_subscription.id)
  );
  v_ledger_id := (v_credit ->> 'ledger_id')::uuid;

  update vip.vip_daily_claims
  set fgems_amount = v_plan.daily_fgems,
      fgems_ledger_id = v_ledger_id,
      fgems_claimed_at = now(),
      fgems_idempotency_key = v_key
  where id = v_claim.id
  returning * into v_claim;

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
    v_claim.id,
    'vip:benefit:daily_fgems:' || p_user_id::text || ':' || v_today::text,
    jsonb_build_object('ledger_id', v_ledger_id, 'claim_date', v_today, 'request_idempotency_key', v_key)
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'claim_id', v_claim.id,
    'subscription_id', v_claim.subscription_id,
    'claim_date', v_claim.claim_date,
    'fgems_amount', v_claim.fgems_amount,
    'fgems_ledger_id', v_claim.fgems_ledger_id,
    'fgems_ledger', v_credit,
    'fgems_claimed', true,
    'fgems_claimed_at', v_claim.fgems_claimed_at,
    'free_box_count', v_claim.free_box_count,
    'free_box_used_count', v_claim.free_box_used_count,
    'remaining_free_box_count', case
      when v_claim.free_box_claimed_at is not null then greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0)
      else 0
    end,
    'free_box_available', v_claim.free_box_claimed_at is not null and greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0) > 0,
    'free_box_claimed', v_claim.free_box_claimed_at is not null,
    'free_box_claimed_at', v_claim.free_box_claimed_at,
    'already_claimed', false,
    'idempotent', false
  );
end;
$$;

create or replace function api.vip_claim_daily_free_box(
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
  v_claim vip.vip_daily_claims%rowtype;
  v_claim_id uuid := pg_catalog.gen_random_uuid();
  v_row_key text := null;
  v_remaining_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_daily_benefit_claim'),
    pg_catalog.hashtext(p_user_id::text || ':' || v_today::text)
  );

  select * into v_claim
  from vip.vip_daily_claims
  where free_box_idempotency_key = v_key
  for update;

  if v_claim.id is not null then
    if v_claim.user_id <> p_user_id then
      raise exception 'idempotency key conflict';
    end if;

    v_remaining_count := greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0);

    return jsonb_build_object(
      'claim_id', v_claim.id,
      'subscription_id', v_claim.subscription_id,
      'claim_date', v_claim.claim_date,
      'free_box_count', v_claim.free_box_count,
      'free_box_used_count', v_claim.free_box_used_count,
      'remaining_free_box_count', v_remaining_count,
      'free_box_available', v_remaining_count > 0,
      'free_box_claimed', v_claim.free_box_claimed_at is not null,
      'free_box_claimed_at', v_claim.free_box_claimed_at,
      'fgems_claimed', v_claim.fgems_claimed_at is not null,
      'already_claimed', true,
      'idempotent', true
    );
  end if;

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
  if coalesce(v_plan.daily_free_box_count, 0) <= 0 then
    raise exception 'VIP_FREE_BOX_NOT_AVAILABLE';
  end if;

  select * into v_claim
  from vip.vip_daily_claims
  where user_id = p_user_id
    and claim_date = v_today
  for update;

  if v_claim.id is not null and v_claim.free_box_claimed_at is not null then
    v_remaining_count := greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0);

    return jsonb_build_object(
      'claim_id', v_claim.id,
      'subscription_id', v_claim.subscription_id,
      'claim_date', v_claim.claim_date,
      'free_box_count', v_claim.free_box_count,
      'free_box_used_count', v_claim.free_box_used_count,
      'remaining_free_box_count', v_remaining_count,
      'free_box_available', v_remaining_count > 0,
      'free_box_claimed', true,
      'free_box_claimed_at', v_claim.free_box_claimed_at,
      'fgems_claimed', v_claim.fgems_claimed_at is not null,
      'already_claimed', true,
      'idempotent', false
    );
  end if;

  if v_claim.id is null then
    v_row_key := 'vip:daily_claim_row:' || p_user_id::text || ':' || v_today::text;

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
      0,
      0,
      0,
      'claimed',
      v_row_key,
      jsonb_build_object('business_day', 'UTC', 'split_daily_benefits', true)
    )
    returning * into v_claim;
  end if;

  update vip.vip_daily_claims
  set free_box_count = v_plan.daily_free_box_count,
      free_box_claimed_at = now(),
      free_box_idempotency_key = v_key,
      status = case
        when v_plan.daily_free_box_count <= free_box_used_count then 'used'
        else 'claimed'
      end
  where id = v_claim.id
  returning * into v_claim;

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
    v_claim.id,
    'vip:benefit:daily_free_box:' || p_user_id::text || ':' || v_today::text,
    jsonb_build_object('claim_date', v_today, 'request_idempotency_key', v_key)
  )
  on conflict (idempotency_key) do nothing;

  v_remaining_count := greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0);

  return jsonb_build_object(
    'claim_id', v_claim.id,
    'subscription_id', v_claim.subscription_id,
    'claim_date', v_claim.claim_date,
    'free_box_count', v_claim.free_box_count,
    'free_box_used_count', v_claim.free_box_used_count,
    'remaining_free_box_count', v_remaining_count,
    'free_box_available', v_remaining_count > 0,
    'free_box_claimed', true,
    'free_box_claimed_at', v_claim.free_box_claimed_at,
    'fgems_claimed', v_claim.fgems_claimed_at is not null,
    'already_claimed', false,
    'idempotent', false
  );
end;
$$;

alter function if exists api.vip_consume_daily_free_box(uuid, text)
rename to vip_consume_daily_free_box_legacy;

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
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_today date := (now() at time zone 'UTC')::date;
  v_user_status text;
  v_subscription vip.vip_subscriptions%rowtype;
  v_claim vip.vip_daily_claims%rowtype;
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

  if v_claim.id is null or v_claim.free_box_claimed_at is null then
    raise exception 'VIP_DAILY_FREE_BOX_NOT_CLAIMED';
  end if;

  return api.vip_consume_daily_free_box_legacy(p_user_id, p_idempotency_key);
end;
$$;

alter function if exists api.vip_open_daily_free_premium_egg(uuid, text)
rename to vip_open_daily_free_premium_egg_legacy;

create or replace function api.vip_open_daily_free_premium_egg(
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_today date := (now() at time zone 'UTC')::date;
  v_user_status text;
  v_subscription vip.vip_subscriptions%rowtype;
  v_claim vip.vip_daily_claims%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_open_daily_free_premium_egg'),
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

  if v_claim.id is null or v_claim.free_box_claimed_at is null then
    raise exception 'VIP_DAILY_FREE_BOX_NOT_CLAIMED';
  end if;

  return api.vip_open_daily_free_premium_egg_legacy(p_user_id, p_idempotency_key);
end;
$$;

comment on function api.vip_claim_daily_benefit(uuid, text) is
  'Claims one UTC daily VIP FGEMS benefit only and credits FGEMS through economy.currency_ledger.';
comment on function api.vip_claim_daily_free_box(uuid, text) is
  'Claims one UTC daily VIP free-box entitlement without crediting FGEMS.';
comment on function api.vip_consume_daily_free_box(uuid, text) is
  'Consumes one already-claimed free box counter from today''s UTC VIP daily claim.';
comment on function api.vip_open_daily_free_premium_egg(uuid, text) is
  'Requires an explicit daily free-box claim, then opens one free premium_egg.';

revoke execute on function api.vip_claim_daily_benefit(uuid, text) from public, anon, authenticated;
revoke execute on function api.vip_claim_daily_free_box(uuid, text) from public, anon, authenticated;
revoke execute on function api.vip_consume_daily_free_box(uuid, text) from public, anon, authenticated;
revoke execute on function api.vip_open_daily_free_premium_egg(uuid, text) from public, anon, authenticated;
revoke execute on function api.vip_consume_daily_free_box_legacy(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function api.vip_open_daily_free_premium_egg_legacy(uuid, text) from public, anon, authenticated, service_role;

grant execute on function api.vip_claim_daily_benefit(uuid, text) to service_role;
grant execute on function api.vip_claim_daily_free_box(uuid, text) to service_role;
grant execute on function api.vip_consume_daily_free_box(uuid, text) to service_role;
grant execute on function api.vip_open_daily_free_premium_egg(uuid, text) to service_role;

commit;
