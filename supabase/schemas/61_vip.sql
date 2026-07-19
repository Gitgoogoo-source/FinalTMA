create table vip.subscriptions (
  user_id uuid primary key references identity.users(id) on delete cascade,
  period_id uuid not null default extensions.gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  renewal_count smallint not null default 0 check (renewal_count between 0 and 2),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table vip.claims (
  user_id uuid not null references identity.users(id) on delete cascade,
  benefit_date date not null,
  benefit text not null check (benefit in ('fgems', 'free_rare_box')),
  operation_id uuid not null references operations.operations(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, benefit_date, benefit)
);

create or replace function vip.status_json(p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_subscription vip.subscriptions%rowtype;
  v_active boolean;
begin
  select * into v_subscription from vip.subscriptions where user_id = p_user_id;
  v_active := v_subscription.user_id is not null and identity.utc_day() between v_subscription.starts_on and v_subscription.ends_on;
  return jsonb_build_object(
    'active', v_active,
    'starts_on', case when v_subscription.user_id is null then null else v_subscription.starts_on end,
    'ends_on', case when v_subscription.user_id is null then null else v_subscription.ends_on end,
    'renewals_used', coalesce(v_subscription.renewal_count, 0),
    'can_purchase', not v_active,
    'can_renew', v_active and v_subscription.renewal_count < 2,
    'fgems_claimed_today', exists(select 1 from vip.claims where user_id = p_user_id and benefit_date = identity.utc_day() and benefit = 'fgems'),
    'free_box_claimed_today', exists(select 1 from vip.claims where user_id = p_user_id and benefit_date = identity.utc_day() and benefit = 'free_rare_box')
  );
end;
$$;

create or replace function api.vip_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_pending jsonb;
begin
  select payments.order_json(p) into v_pending
  from payments.orders p
  where p.user_id = v_user_id and p.kind = 'vip' and p.status in ('pending', 'paid')
  order by p.created_at desc limit 1;
  return vip.status_json(v_user_id) || jsonb_build_object('pending_order', v_pending);
end;
$$;

create or replace function api.vip_claim(
  p_session_id uuid,
  p_operation_id uuid,
  p_benefit text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_result jsonb;
  v_detail text;
begin
  if p_benefit not in ('fgems', 'free_rare_box') then perform api.raise_business_error('VIP_BENEFIT_INVALID', '月卡权益无效'); end if;
  v_operation := operations.begin_command(
    p_session_id,
    case p_benefit when 'fgems' then 'vip.claim_fgems' else 'vip.claim_free_box' end,
    p_operation_id,
    '{}'::jsonb
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if not exists (select 1 from vip.subscriptions where user_id = v_user_id and identity.utc_day() between starts_on and ends_on) then perform api.raise_business_error('VIP_INACTIVE', '月卡未生效'); end if;
    insert into vip.claims (user_id, benefit_date, benefit, operation_id)
    values (v_user_id, identity.utc_day(), p_benefit, p_operation_id)
    on conflict do nothing;
    if not found then perform api.raise_business_error('VIP_ALREADY_CLAIMED', '今日权益已领取'); end if;
    if p_benefit = 'fgems' then
      perform economy.change_balance(v_user_id, 'FGEMS', 100, 'vip_daily', p_operation_id, identity.utc_day()::text);
      v_result := jsonb_build_object('kind', 'fgems', 'amount', 100, 'claimed', true);
    else
      insert into economy.entitlements (user_id, kind, source, operation_id) values (v_user_id, 'free_rare_box', 'vip_daily', p_operation_id);
      v_result := jsonb_build_object('kind', 'free_rare_box', 'amount', 1, 'claimed', true);
    end if;
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
