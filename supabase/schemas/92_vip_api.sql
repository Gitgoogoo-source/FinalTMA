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
