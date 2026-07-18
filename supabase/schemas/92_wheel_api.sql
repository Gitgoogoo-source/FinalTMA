create or replace function api.wheel_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_count integer;
begin
  select coalesce(spin_count, 0) into v_count
  from wheel.daily where user_id = v_user_id and business_date = identity.utc_day();
  v_count := coalesce(v_count, 0);
  return jsonb_build_object(
    'spin_count', v_count,
    'remaining', 20 - v_count,
    'daily_limit', 20,
    'single_cost', 20,
    'ten_cost', 180,
    'milestone_10_claimed', v_count >= 10,
    'milestone_20_claimed', v_count >= 20
  );
end;
$$;
