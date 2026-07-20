create table wheel.daily (
  user_id uuid not null references identity.users(id) on delete cascade,
  business_date date not null,
  spin_count smallint not null default 0 check (spin_count between 0 and 20),
  normal_entitlements smallint not null default 0 check (normal_entitlements between 0 and 3),
  rare_entitlements smallint not null default 0 check (rare_entitlements between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date)
);

create table wheel.results (
  operation_id uuid not null references operations.operations(id) on delete cascade,
  sequence smallint not null check (sequence between 1 and 10),
  rolled_kind text not null,
  delivered_kind text not null,
  amount bigint not null check (amount > 0),
  replaced boolean not null default false,
  primary key (operation_id, sequence)
);

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

create or replace function api.wheel_recoverable_results(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at)
      from operations.operations o
      where o.user_id = v_user_id
        and o.use_case = 'wheel.spin'
        and o.result_acknowledged_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.wheel_acknowledge_result(
  p_session_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_operation operations.operations%rowtype;
begin
  select * into v_operation
  from operations.operations o
  where o.id = p_operation_id
    and o.user_id = v_user_id
    and o.use_case = 'wheel.spin'
  for update;
  if v_operation.id is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '转盘操作记录不存在');
  end if;
  if v_operation.status not in ('succeeded', 'failed') then
    perform api.raise_business_error('OPERATION_NOT_ACKNOWLEDGEABLE', '转盘结果尚未确定');
  end if;
  if v_operation.result_acknowledged_at is null then
    update operations.operations
    set result_acknowledged_at = now(), updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  end if;
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'acknowledged_at', v_operation.result_acknowledged_at
  );
end;
$$;

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
  v_reward_fgems bigint := 0;
  v_reward_kcoin bigint := 0;
  v_reward_normal integer := 0;
  v_reward_rare integer := 0;
  v_replaced_normal integer := 0;
  v_replaced_rare integer := 0;
  v_rewards jsonb := '[]'::jsonb;
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
      if v_kind = 'fgems' then v_reward_fgems := v_reward_fgems + v_amount;
      elsif v_kind = 'kcoin' then v_reward_kcoin := v_reward_kcoin + v_amount;
      elsif v_kind = 'free_normal_box' then v_reward_normal := v_reward_normal + v_amount;
      else v_reward_rare := v_reward_rare + v_amount;
      end if;
      if v_replaced = 'free_normal_box' then v_replaced_normal := v_replaced_normal + 1;
      elsif v_replaced = 'free_rare_box' then v_replaced_rare := v_replaced_rare + 1;
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
    v_result := jsonb_build_object(
      'count', p_count,
      'cost_kcoin', v_cost,
      'kcoin_returned', v_reward_kcoin,
      'net_kcoin_change', v_reward_kcoin - v_cost,
      'rewards', v_rewards,
      'reward_summary', jsonb_build_object(
        'fgems', v_reward_fgems,
        'kcoin', v_reward_kcoin,
        'free_normal_box', v_reward_normal,
        'free_rare_box', v_reward_rare,
        'replaced_free_normal_box', v_replaced_normal,
        'replaced_free_rare_box', v_replaced_rare
      ),
      'milestone', jsonb_build_object(
        'awarded_fgems', v_milestone,
        'milestone_10_claimed', v_spin_count + p_count >= 10,
        'milestone_20_claimed', v_spin_count + p_count >= 20
      ),
      'entitlements', jsonb_build_object(
        'free_normal_box', (
          select count(*) from economy.entitlements
          where user_id = v_user_id and kind = 'free_normal_box' and status = 'unused'
        ),
        'free_rare_box', (
          select count(*) from economy.entitlements
          where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused'
        )
      ),
      'spin_count', v_spin_count + p_count,
      'remaining', 20 - v_spin_count - p_count,
      'daily_limit', 20,
      'assets', economy.assets(v_user_id)
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
