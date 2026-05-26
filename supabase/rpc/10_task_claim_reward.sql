-- task_claim_reward.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.task_claim_reward

create or replace function api.task_claim_reward(
  p_user_id uuid,
  p_task_id uuid,
  p_period_key text default 'once'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress tasks.user_task_progress%rowtype;
  v_task tasks.task_definitions%rowtype;
  v_claim_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null or p_task_id is null then
    raise exception 'user_id and task_id are required';
  end if;

  select * into v_task from tasks.task_definitions where id = p_task_id and active = true;
  if v_task.id is null then
    raise exception 'task not found';
  end if;

  select * into v_progress
  from tasks.user_task_progress
  where user_id = p_user_id and task_id = p_task_id and period_key = coalesce(p_period_key, 'once')
  for update;

  if v_progress.id is null then
    raise exception 'task progress not found';
  end if;
  if v_progress.status = 'claimed' then
    select id into v_claim_id
    from tasks.task_claims
    where user_id = p_user_id and task_id = p_task_id and period_key = coalesce(p_period_key, 'once');
    return jsonb_build_object('claim_id', v_claim_id, 'status', 'claimed', 'idempotent', true);
  end if;
  if v_progress.status <> 'completed' then
    raise exception 'task is not completed';
  end if;

  insert into tasks.task_claims (user_id, task_id, period_key, reward)
  values (p_user_id, p_task_id, coalesce(p_period_key, 'once'), v_task.reward)
  returning id into v_claim_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_task.reward, 'task_claim', v_claim_id, 'task_claim:' || v_claim_id::text
  );

  update tasks.user_task_progress
  set status = 'claimed', claimed_at = now(), updated_at = now()
  where id = v_progress.id;

  return jsonb_build_object('claim_id', v_claim_id, 'reward', v_task.reward, 'ledger_results', v_rewards_result);
end;
$$;


-- ============================================================
