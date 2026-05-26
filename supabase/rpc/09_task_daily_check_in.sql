-- task_daily_check_in.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.task_daily_check_in

create or replace function api.task_daily_check_in(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign tasks.signin_campaigns%rowtype;
  v_existing tasks.user_signins%rowtype;
  v_count integer;
  v_day_index integer;
  v_reward jsonb;
  v_signin_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select * into v_campaign
  from tasks.signin_campaigns
  where active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_campaign.id is null then
    raise exception 'active sign-in campaign not found';
  end if;

  select * into v_existing
  from tasks.user_signins
  where user_id = p_user_id
    and campaign_id = v_campaign.id
    and signin_date = current_date;

  if v_existing.id is not null then
    return jsonb_build_object('signin_id', v_existing.id, 'already_claimed', true, 'day_index', v_existing.day_index, 'reward', v_existing.reward);
  end if;

  select count(*)::integer into v_count
  from tasks.user_signins
  where user_id = p_user_id and campaign_id = v_campaign.id and status = 'claimed';

  v_day_index := least(v_count + 1, v_campaign.cycle_days);

  select reward into v_reward
  from tasks.signin_days
  where campaign_id = v_campaign.id and day_index = v_day_index;

  v_reward := coalesce(v_reward, '[]'::jsonb);

  insert into tasks.user_signins (user_id, campaign_id, day_index, signin_date, reward, status)
  values (p_user_id, v_campaign.id, v_day_index, current_date, v_reward, 'claimed')
  returning id into v_signin_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_reward, 'daily_check_in', v_signin_id, 'daily_check_in:' || v_signin_id::text
  );

  return jsonb_build_object(
    'signin_id', v_signin_id,
    'already_claimed', false,
    'day_index', v_day_index,
    'reward', v_reward,
    'ledger_results', v_rewards_result
  );
end;
$$;


-- ============================================================
