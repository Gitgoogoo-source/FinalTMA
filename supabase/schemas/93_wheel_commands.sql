create or replace function api.wheel_spin(
  p_session_id uuid,
  p_operation_id uuid,
  p_count integer
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
  v_spin_count integer;
  v_normal integer;
  v_rare integer;
  v_cost bigint;
  v_random integer;
  v_kind text;
  v_rolled text;
  v_amount bigint;
  v_replaced text;
  v_milestone bigint := 0;
  v_rewards jsonb := '[]'::jsonb;
  v_i integer;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'wheel.spin', p_operation_id, jsonb_build_object('count', p_count));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_count not in (1, 10) then perform api.raise_business_error('WHEEL_COUNT_INVALID', '转盘次数无效'); end if;
    insert into wheel.daily (user_id, business_date) values (v_user_id, identity.utc_day()) on conflict do nothing;
    select spin_count, normal_entitlements, rare_entitlements into v_spin_count, v_normal, v_rare
    from wheel.daily where user_id = v_user_id and business_date = identity.utc_day() for update;
    if v_spin_count + p_count > 20 then perform api.raise_business_error('WHEEL_DAILY_LIMIT', '今日转盘次数不足'); end if;
    v_cost := case when p_count = 10 then 180 else 20 end;
    perform economy.change_balance(v_user_id, 'KCOIN', -v_cost, 'wheel', p_operation_id, p_count::text);
    for v_i in 1..p_count loop
      v_random := identity.random_basis_points();
      if v_random < 2400 then v_kind := 'fgems'; v_amount := 20;
      elsif v_random < 4100 then v_kind := 'fgems'; v_amount := 30;
      elsif v_random < 4800 then v_kind := 'fgems'; v_amount := 50;
      elsif v_random < 4950 then v_kind := 'fgems'; v_amount := 100;
      elsif v_random < 7050 then v_kind := 'kcoin'; v_amount := 10;
      elsif v_random < 8250 then v_kind := 'kcoin'; v_amount := 20;
      elsif v_random < 8950 then v_kind := 'kcoin'; v_amount := 30;
      elsif v_random < 9350 then v_kind := 'kcoin'; v_amount := 50;
      elsif v_random < 9550 then v_kind := 'kcoin'; v_amount := 100;
      elsif v_random < 9980 then v_kind := 'free_normal_box'; v_amount := 1;
      else v_kind := 'free_rare_box'; v_amount := 1;
      end if;
      v_rolled := v_kind;
      v_replaced := null;
      if v_kind = 'free_normal_box' then
        if v_normal >= 3 then v_replaced := v_kind; v_kind := 'fgems'; v_amount := 30; else v_normal := v_normal + 1; end if;
      elsif v_kind = 'free_rare_box' then
        if v_rare >= 1 then v_replaced := v_kind; v_kind := 'fgems'; v_amount := 100; else v_rare := v_rare + 1; end if;
      end if;
      if v_kind in ('kcoin', 'fgems') then
        perform economy.change_balance(v_user_id, upper(v_kind), v_amount, 'wheel_reward', p_operation_id, v_i::text);
      else
        insert into economy.entitlements (user_id, kind, source, operation_id) values (v_user_id, v_kind, 'wheel', p_operation_id);
      end if;
      insert into wheel.results (operation_id, sequence, rolled_kind, delivered_kind, amount, replaced)
      values (p_operation_id, v_i, v_rolled, v_kind, v_amount, v_replaced is not null);
      v_rewards := v_rewards || jsonb_build_array(jsonb_build_object('order', v_i, 'kind', v_kind, 'amount', v_amount, 'replaced_kind', v_replaced));
    end loop;
    if v_spin_count < 10 and v_spin_count + p_count >= 10 then v_milestone := v_milestone + 25; end if;
    if v_spin_count < 20 and v_spin_count + p_count >= 20 then v_milestone := v_milestone + 25; end if;
    if v_milestone > 0 then perform economy.change_balance(v_user_id, 'FGEMS', v_milestone, 'wheel_milestone', p_operation_id, identity.utc_day()::text); end if;
    update wheel.daily set spin_count = v_spin_count + p_count, normal_entitlements = v_normal, rare_entitlements = v_rare, updated_at = now()
    where user_id = v_user_id and business_date = identity.utc_day();
    perform tasks.progress(v_user_id, 'wheel_spin');
    v_result := jsonb_build_object('count', p_count, 'cost_kcoin', v_cost, 'rewards', v_rewards, 'milestone_fgems', v_milestone, 'spin_count', v_spin_count + p_count, 'assets', economy.assets(v_user_id));
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
