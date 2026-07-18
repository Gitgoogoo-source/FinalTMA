create or replace function api.tasks_check_in(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_day integer;
  v_reward bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'tasks.check_in', p_operation_id, '{}'::jsonb);
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    insert into tasks.checkins (user_id) values (v_user_id) on conflict do nothing;
    select current_day into v_day from tasks.checkins where user_id = v_user_id for update;
    if exists (select 1 from tasks.checkins where user_id = v_user_id and last_claim_date = identity.utc_day()) then perform api.raise_business_error('CHECKIN_ALREADY_CLAIMED', '今日已签到'); end if;
    v_day := case when v_day = 7 then 1 else v_day + 1 end;
    update tasks.checkins set current_day = v_day, last_claim_date = identity.utc_day(), updated_at = now() where user_id = v_user_id;
    if v_day = 7 then
      insert into economy.entitlements (user_id, kind, source, operation_id) values (v_user_id, 'free_rare_box', 'checkin_day_7', p_operation_id);
      v_result := jsonb_build_object('day', v_day, 'reward_kind', 'free_rare_box', 'reward_amount', 1, 'claimed', true);
    else
      v_reward := (array[20,30,50,80,100,150])[v_day];
      perform economy.change_balance(v_user_id, 'FGEMS', v_reward, 'checkin', p_operation_id, v_day::text);
      v_result := jsonb_build_object('day', v_day, 'reward_kind', 'fgems', 'reward_amount', v_reward, 'claimed', true);
    end if;
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.tasks_claim(p_session_id uuid, p_operation_id uuid, p_task_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_definition tasks.definitions%rowtype;
  v_progress tasks.daily_progress%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'tasks.claim', p_operation_id, jsonb_build_object('task_code', p_task_code));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_definition from tasks.definitions where code = p_task_code;
    if v_definition.code is null then perform api.raise_business_error('TASK_NOT_FOUND', '任务不存在'); end if;
    insert into tasks.daily_progress (user_id, business_date, task_code) values (v_user_id, identity.utc_day(), p_task_code) on conflict do nothing;
    select * into v_progress from tasks.daily_progress where user_id = v_user_id and business_date = identity.utc_day() and task_code = p_task_code for update;
    if v_progress.claimed_at is not null then perform api.raise_business_error('TASK_ALREADY_CLAIMED', '任务奖励已领取'); end if;
    if v_progress.progress < v_definition.target then perform api.raise_business_error('TASK_NOT_COMPLETE', '任务尚未完成'); end if;
    update tasks.daily_progress set claimed_at = now(), claim_operation_id = p_operation_id, updated_at = now()
    where user_id = v_user_id and business_date = identity.utc_day() and task_code = p_task_code;
    perform economy.change_balance(v_user_id, 'FGEMS', v_definition.reward_fgems, 'task_reward', p_operation_id, p_task_code);
    v_result := jsonb_build_object('task_code', p_task_code, 'reward_fgems', v_definition.reward_fgems, 'claimed', true);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
