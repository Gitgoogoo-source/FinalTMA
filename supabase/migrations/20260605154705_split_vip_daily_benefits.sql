-- Split VIP daily benefits into two independent user actions:
-- 1) claim daily FGEMS
-- 2) claim daily free premium egg entitlement
--
-- Existing rows created by the previous combined claim RPC are backfilled as
-- both benefits already claimed, so old users do not lose entitlement state.

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
  else
    v_remaining_free_box_count := 0;
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
      'free_box_claimed', v_claim.free_box_claimed_at is not null,
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
      'free_box_claimed', v_claim.free_box_claimed_at is not null,
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
    'free_box_claimed', v_claim.free_box_claimed_at is not null,
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

  if v_claim.id is null or v_claim.free_box_claimed_at is null then
    raise exception 'VIP_DAILY_FREE_BOX_NOT_CLAIMED';
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

-- Keep the free premium egg RPC mostly intact, but remove the previous auto
-- daily-benefit claim. Users must explicitly claim the free-box entitlement.
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
  v_scoped_key text;
  v_today date := (now() at time zone 'UTC')::date;
  v_user_status text;
  v_subscription vip.vip_subscriptions%rowtype;
  v_claim vip.vip_daily_claims%rowtype;
  v_existing_ledger vip.vip_benefit_ledger%rowtype;
  v_existing_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_pool gacha.drop_pool_versions%rowtype;
  v_draw_order_id uuid := pg_catalog.gen_random_uuid();
  v_invoice_payload text;
  v_draw_i integer;
  v_pity record;
  v_use_pity boolean;
  v_reward record;
  v_total_weight numeric(38,8);
  v_roll numeric(38,8);
  v_form_id uuid;
  v_power integer;
  v_item_id uuid;
  v_should_reset boolean;
  v_results jsonb := '[]'::jsonb;
  v_referral_first_open jsonb := '{}'::jsonb;
  v_progress_result jsonb := '{}'::jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;

  v_scoped_key := 'vip:free_premium_egg:' || v_key;

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

  select * into v_existing_ledger
  from vip.vip_benefit_ledger
  where idempotency_key = v_scoped_key
  for update;

  if v_existing_ledger.id is not null then
    if v_existing_ledger.user_id <> p_user_id
       or v_existing_ledger.benefit_type <> 'daily_free_box'
       or v_existing_ledger.entry_type <> 'consume' then
      raise exception 'idempotency key conflict';
    end if;

    select * into v_existing_order
    from gacha.draw_orders
    where id = nullif(v_existing_ledger.metadata ->> 'draw_order_id', '')::uuid;

    select * into v_claim
    from vip.vip_daily_claims
    where id = v_existing_ledger.source_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'draw_index', dr.draw_index,
      'template_id', dr.template_id,
      'form_id', dr.form_id,
      'rarity_code', dr.rarity_code,
      'item_instance_id', dr.item_instance_id,
      'was_pity', dr.was_pity
    ) order by dr.draw_index), '[]'::jsonb)
    into v_results
    from gacha.draw_results dr
    where dr.draw_order_id = v_existing_order.id;

    return jsonb_build_object(
      'draw_order_id', v_existing_order.id,
      'box_slug', 'premium_egg',
      'status', coalesce(v_existing_order.status, 'completed'),
      'payment_status', 'vip_daily_free',
      'draw_count', coalesce(v_existing_order.draw_count, v_existing_order.quantity, 1),
      'quantity', coalesce(v_existing_order.quantity, 1),
      'xtr_amount', 0,
      'total_price_stars', 0,
      'claim_id', v_claim.id,
      'free_box_count', coalesce(v_claim.free_box_count, 0),
      'free_box_used_count', coalesce(v_claim.free_box_used_count, 0),
      'remaining_free_box_count', greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0),
      'consume_ledger_id', v_existing_ledger.id,
      'results', coalesce(v_results, '[]'::jsonb),
      'idempotent', true,
      'result_ready', v_existing_order.status in ('opened', 'completed')
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

  if v_claim.id is null or v_claim.free_box_claimed_at is null then
    raise exception 'VIP_DAILY_FREE_BOX_NOT_CLAIMED';
  end if;
  if v_claim.free_box_count <= 0 then
    raise exception 'VIP_FREE_BOX_NOT_AVAILABLE';
  end if;
  if v_claim.free_box_used_count >= v_claim.free_box_count then
    raise exception 'VIP_FREE_BOX_ALREADY_USED';
  end if;

  select * into v_box
  from gacha.blind_boxes
  where slug = 'premium_egg'
  for update;

  if v_box.id is null then
    raise exception 'blind box not found';
  end if;
  if v_box.status <> 'active' then
    raise exception 'blind box is not active: %', v_box.status;
  end if;
  if v_box.starts_at is not null and v_box.starts_at > now() then
    raise exception 'blind box has not started';
  end if;
  if v_box.ends_at is not null and v_box.ends_at <= now() then
    raise exception 'blind box has ended';
  end if;
  if v_box.remaining_stock is not null and v_box.remaining_stock <= 0 then
    raise exception 'stock is insufficient';
  end if;

  select * into v_pool
  from gacha.drop_pool_versions
  where box_id = v_box.id
    and status = 'active'
    and (effective_from is null or effective_from <= now())
    and (effective_to is null or effective_to > now())
  order by version_no desc
  limit 1;

  if v_pool.id is null then
    raise exception 'active drop pool not found';
  end if;

  v_invoice_payload :=
    'vipfree_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into gacha.draw_orders (
    id,
    user_id,
    box_id,
    pool_version_id,
    payment_star_order_id,
    status,
    quantity,
    draw_count,
    unit_price_stars,
    discount_bps,
    total_price_stars,
    open_reward_kcoin,
    invoice_payload,
    idempotency_key,
    paid_at,
    payment_provider,
    payment_status,
    star_amount,
    metadata
  ) values (
    v_draw_order_id,
    p_user_id,
    v_box.id,
    v_pool.id,
    null,
    'opening',
    1,
    1,
    0,
    0,
    0,
    0,
    v_invoice_payload,
    v_scoped_key,
    now(),
    'vip_daily_free',
    'paid',
    0,
    jsonb_build_object(
      'source_type', 'vip_daily_free_box',
      'box_slug', v_box.slug,
      'box_tier', v_box.tier,
      'claim_id', v_claim.id,
      'subscription_id', v_claim.subscription_id,
      'price_source', 'vip_daily_free'
    )
  )
  returning * into v_existing_order;

  for v_draw_i in 1..1 loop
    select null::uuid as id into v_reward;
    select null::uuid as id, 0::integer as current_count into v_pity;
    v_use_pity := false;

    select pr.*, coalesce(ups.current_count, 0) as current_count
    into v_pity
    from gacha.pity_rules pr
    left join gacha.user_pity_states ups
      on ups.pity_rule_id = pr.id
     and ups.user_id = p_user_id
     and ups.box_id = v_box.id
    where pr.box_id = v_box.id
      and pr.active = true
      and (pr.pool_version_id is null or pr.pool_version_id = v_pool.id)
    order by pr.priority asc, pr.created_at asc
    limit 1;

    if v_pity.id is not null then
      insert into gacha.user_pity_states (
        user_id,
        box_id,
        pity_rule_id,
        current_count,
        total_draws
      ) values (
        p_user_id,
        v_box.id,
        v_pity.id,
        0,
        0
      )
      on conflict (user_id, box_id, pity_rule_id) do nothing;

      select pr.*, ups.current_count
      into v_pity
      from gacha.pity_rules pr
      join gacha.user_pity_states ups
        on ups.pity_rule_id = pr.id
       and ups.user_id = p_user_id
       and ups.box_id = v_box.id
      where pr.id = v_pity.id
      for update of ups;

      v_use_pity := (v_pity.current_count + 1 >= v_pity.threshold);
    end if;

    if v_use_pity and v_pity.guaranteed_template_id is not null then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = v_pool.id
        and dpi.template_id = v_pity.guaranteed_template_id
        and (v_pity.guaranteed_form_id is null or dpi.form_id = v_pity.guaranteed_form_id)
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by dpi.sort_order asc, random()
      limit 1;
    elsif v_use_pity then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      join catalog.rarities rr on rr.code = dpi.rarity_code
      join catalog.rarities target on target.code = v_pity.target_rarity_code
      where dpi.pool_version_id = v_pool.id
        and dpi.is_pity_eligible = true
        and rr.sort_order >= target.sort_order
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by rr.sort_order desc, dpi.drop_weight desc, random()
      limit 1;
    end if;

    if v_reward.id is null then
      select coalesce(sum(drop_weight), 0) into v_total_weight
      from gacha.drop_pool_items
      where pool_version_id = v_pool.id
        and (stock_remaining is null or stock_remaining > 0);

      if v_total_weight <= 0 then
        raise exception 'drop pool has no available rewards';
      end if;

      v_roll := (random()::numeric * v_total_weight);

      select x.* into v_reward
      from (
        select dpi.*,
               sum(dpi.drop_weight) over (order by dpi.sort_order asc, dpi.id asc) as running_weight
        from gacha.drop_pool_items dpi
        where dpi.pool_version_id = v_pool.id
          and (stock_remaining is null or stock_remaining > 0)
      ) x
      where x.running_weight >= v_roll
      order by x.running_weight asc
      limit 1;
    else
      v_roll := null;
    end if;

    if v_reward.id is null then
      raise exception 'failed to select reward';
    end if;

    if v_reward.stock_remaining is not null then
      update gacha.drop_pool_items
      set stock_remaining = stock_remaining - 1,
          updated_at = now()
      where id = v_reward.id
        and stock_remaining > 0
      returning * into v_reward;

      if not found then
        raise exception 'stock is insufficient';
      end if;
    end if;

    v_form_id := v_reward.form_id;
    if v_form_id is null then
      select id into v_form_id
      from catalog.collectible_forms
      where template_id = v_reward.template_id
      order by is_default desc, form_index asc
      limit 1;
    end if;

    select ct.base_power + coalesce(cf.base_power_bonus, 0)
    into v_power
    from catalog.collectible_templates ct
    left join catalog.collectible_forms cf on cf.id = v_form_id
    where ct.id = v_reward.template_id;

    insert into inventory.item_instances (
      owner_user_id,
      template_id,
      form_id,
      level,
      power,
      status,
      source_type,
      source_id,
      metadata
    ) values (
      p_user_id,
      v_reward.template_id,
      v_form_id,
      1,
      coalesce(v_power, 0),
      'available',
      'gacha',
      v_draw_order_id,
      jsonb_build_object(
        'box_id', v_box.id,
        'draw_order_id', v_draw_order_id,
        'drop_pool_item_id', v_reward.id,
        'source_type', 'vip_daily_free_box',
        'claim_id', v_claim.id
      )
    )
    returning id into v_item_id;

    insert into inventory.item_instance_events (
      item_instance_id,
      user_id,
      event_type,
      source_type,
      source_id,
      after_state
    ) values (
      v_item_id,
      p_user_id,
      'obtained_from_gacha',
      'gacha',
      v_draw_order_id,
      jsonb_build_object(
        'template_id', v_reward.template_id,
        'form_id', v_form_id,
        'rarity_code', v_reward.rarity_code,
        'source_type', 'vip_daily_free_box'
      )
    );

    insert into album.user_discoveries (
      user_id,
      template_id,
      first_item_instance_id,
      first_source_type,
      first_source_id
    ) values (
      p_user_id,
      v_reward.template_id,
      v_item_id,
      'gacha',
      v_draw_order_id
    ) on conflict (user_id, template_id) do nothing;

    insert into gacha.draw_results (
      draw_order_id,
      user_id,
      box_id,
      pool_version_id,
      draw_index,
      drop_pool_item_id,
      item_instance_id,
      template_id,
      form_id,
      rarity_code,
      was_pity,
      random_roll,
      metadata
    ) values (
      v_draw_order_id,
      p_user_id,
      v_box.id,
      v_pool.id,
      v_draw_i,
      v_reward.id,
      v_item_id,
      v_reward.template_id,
      v_form_id,
      v_reward.rarity_code,
      v_use_pity,
      v_roll,
      jsonb_build_object(
        'serial_item_id', v_item_id,
        'source_type', 'vip_daily_free_box',
        'claim_id', v_claim.id
      )
    );

    if v_pity.id is not null then
      select exists (
        select 1
        from catalog.rarities got
        join catalog.rarities target
          on target.code = coalesce(v_pity.reset_on_rarity_code, v_pity.target_rarity_code)
        where got.code = v_reward.rarity_code
          and got.sort_order >= target.sort_order
      ) into v_should_reset;

      update gacha.user_pity_states
      set current_count = case when v_should_reset then 0 else current_count + 1 end,
          total_draws = total_draws + 1,
          last_hit_at = case when v_should_reset then now() else last_hit_at end,
          updated_at = now()
      where user_id = p_user_id
        and box_id = v_box.id
        and pity_rule_id = v_pity.id;
    end if;
  end loop;

  update vip.vip_daily_claims
  set free_box_used_count = free_box_used_count + 1,
      free_box_used_at = now(),
      status = case
        when free_box_used_count + 1 >= free_box_count then 'used'
        else 'partially_used'
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
    v_claim.subscription_id,
    'daily_free_box',
    'consume',
    1,
    null,
    'vip_daily_claim',
    v_claim.id,
    v_scoped_key,
    jsonb_build_object(
      'claim_date', v_today,
      'draw_order_id', v_draw_order_id,
      'box_slug', 'premium_egg'
    )
  )
  returning * into v_existing_ledger;

  insert into gacha.draw_audit (
    draw_order_id,
    user_id,
    pool_version_id,
    rules_snapshot
  ) values (
    v_draw_order_id,
    p_user_id,
    v_pool.id,
    jsonb_build_object(
      'box_id', v_box.id,
      'draw_count', 1,
      'quantity', 1,
      'open_reward_kcoin', 0,
      'source_type', 'vip_daily_free_box',
      'claim_id', v_claim.id
    )
  );

  update gacha.draw_orders
  set status = 'completed',
      opened_at = now(),
      updated_at = now()
  where id = v_draw_order_id
  returning * into v_existing_order;

  v_referral_first_open := api.referral_process_first_open(p_user_id, v_draw_order_id);

  v_progress_result := api.task_record_progress(
    p_user_id,
    'gacha_open_success',
    1,
    v_draw_order_id,
    coalesce(v_existing_order.opened_at::date, current_date)::text
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_index', dr.draw_index,
    'template_id', dr.template_id,
    'form_id', dr.form_id,
    'rarity_code', dr.rarity_code,
    'item_instance_id', dr.item_instance_id,
    'was_pity', dr.was_pity
  ) order by dr.draw_index), '[]'::jsonb)
  into v_results
  from gacha.draw_results dr
  where dr.draw_order_id = v_draw_order_id;

  return jsonb_build_object(
    'draw_order_id', v_draw_order_id,
    'box_slug', 'premium_egg',
    'status', 'completed',
    'payment_status', 'vip_daily_free',
    'draw_count', 1,
    'quantity', 1,
    'xtr_amount', 0,
    'total_price_stars', 0,
    'claim_id', v_claim.id,
    'free_box_count', v_claim.free_box_count,
    'free_box_used_count', v_claim.free_box_used_count,
    'remaining_free_box_count', greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0),
    'consume_ledger_id', v_existing_ledger.id,
    'results', coalesce(v_results, '[]'::jsonb),
    'referral_first_open', coalesce(v_referral_first_open, '{}'::jsonb),
    'task_progress', coalesce(v_progress_result, '{}'::jsonb),
    'idempotent', false,
    'result_ready', true
  );
end;
$$;

comment on function api.vip_claim_daily_benefit(uuid, text) is
  'Claims one UTC daily VIP FGEMS benefit only and credits FGEMS through economy.currency_ledger.';
comment on function api.vip_claim_daily_free_box(uuid, text) is
  'Claims one UTC daily VIP free-box entitlement without crediting FGEMS.';
comment on function api.vip_consume_daily_free_box(uuid, text) is
  'Consumes one already-claimed free box counter from today''s UTC VIP daily claim exactly once.';
comment on function api.vip_open_daily_free_premium_egg(uuid, text) is
  'Consumes one already-claimed daily free box counter and opens one premium_egg.';

revoke execute on function api.vip_claim_daily_free_box(uuid, text) from public, anon, authenticated;
grant execute on function api.vip_claim_daily_free_box(uuid, text) to service_role;

commit;
