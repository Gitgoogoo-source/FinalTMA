-- task_daily_check_in.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.task_daily_check_in

create or replace function api.task_daily_check_in(
  p_user_id uuid,
  p_campaign_id uuid,
  p_local_date date,
  p_timezone_offset_minutes integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_status text;
  v_campaign tasks.signin_campaigns%rowtype;
  v_state tasks.user_signin_states%rowtype;
  v_existing tasks.user_signins%rowtype;
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_scoped_key text;
  v_request_fingerprint text;
  v_existing_idempotency ops.idempotency_keys%rowtype;
  v_local_date date := coalesce(p_local_date, current_date);
  v_timezone_offset_minutes integer := coalesce(p_timezone_offset_minutes, 0);
  v_day_index integer;
  v_current_streak integer;
  v_reward jsonb;
  v_rewards_result jsonb := '[]'::jsonb;
  v_progress_result jsonb := null;
  v_response jsonb;
  v_total_signins integer;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select status
  into v_user_status
  from core.users
  where id = p_user_id;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  if v_local_date < current_date - 1 or v_local_date > current_date + 1 then
    raise exception 'signin date out of range';
  end if;

  select *
  into v_campaign
  from tasks.signin_campaigns
  where (p_campaign_id is null or id = p_campaign_id)
    and active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_campaign.id is null then
    raise exception 'active sign-in campaign not found';
  end if;

  v_scoped_key := 'task_daily_check_in:' || v_idempotency_key;
  v_request_fingerprint := md5(jsonb_build_object(
    'user_id', p_user_id,
    'campaign_id', v_campaign.id,
    'local_date', v_local_date,
    'timezone_offset_minutes', v_timezone_offset_minutes
  )::text);

  perform pg_advisory_xact_lock(hashtext('task_daily_check_in'), hashtext(v_scoped_key));

  select *
  into v_existing_idempotency
  from ops.idempotency_keys
  where key = v_scoped_key
  for update;

  if v_existing_idempotency.key is not null then
    if v_existing_idempotency.scope <> 'task_daily_check_in'
       or v_existing_idempotency.user_id is distinct from p_user_id
       or v_existing_idempotency.request_hash is distinct from v_request_fingerprint then
      raise exception 'idempotency conflict';
    end if;

    if v_existing_idempotency.status = 'completed'
       and v_existing_idempotency.response is not null then
      return v_existing_idempotency.response || jsonb_build_object('idempotent', true);
    end if;

    raise exception 'idempotency request is still in progress';
  end if;

  insert into ops.idempotency_keys (
    key,
    user_id,
    scope,
    request_hash,
    status,
    locked_until
  ) values (
    v_scoped_key,
    p_user_id,
    'task_daily_check_in',
    v_request_fingerprint,
    'started',
    now() + interval '5 minutes'
  );

  insert into tasks.user_signin_states (user_id, campaign_id)
  values (p_user_id, v_campaign.id)
  on conflict (user_id, campaign_id) do nothing;

  select *
  into v_state
  from tasks.user_signin_states
  where user_id = p_user_id
    and campaign_id = v_campaign.id
  for update;

  select *
  into v_existing
  from tasks.user_signins
  where user_id = p_user_id
    and campaign_id = v_campaign.id
    and signin_date = v_local_date
  for update;

  if v_existing.id is not null then
    if v_existing.idempotency_key is null then
      update tasks.user_signins
      set idempotency_key = v_idempotency_key,
          request_fingerprint = v_request_fingerprint
      where id = v_existing.id
      returning * into v_existing;
    end if;

    select count(*)::integer
    into v_total_signins
    from tasks.user_signins
    where user_id = p_user_id
      and campaign_id = v_campaign.id
      and status = 'claimed';

    update tasks.user_signin_states
    set current_streak = greatest(v_state.current_streak, 1),
        cycle_position = greatest(v_state.cycle_position, v_existing.day_index),
        last_signin_date = greatest(coalesce(v_state.last_signin_date, v_existing.signin_date), v_existing.signin_date),
        total_signins = greatest(v_state.total_signins, coalesce(v_total_signins, 0)),
        metadata = v_state.metadata || jsonb_build_object(
          'last_idempotency_key', v_idempotency_key,
          'last_request_fingerprint', v_request_fingerprint,
          'last_timezone_offset_minutes', v_timezone_offset_minutes
        ),
        updated_at = now()
    where user_id = p_user_id
      and campaign_id = v_campaign.id
    returning * into v_state;

    v_progress_result := api.task_record_progress(
      p_user_id,
      'signin_success',
      1,
      v_existing.id,
      v_local_date::text
    );

    v_response := jsonb_build_object(
      'signin_id', v_existing.id,
      'campaign_id', v_campaign.id,
      'already_claimed', true,
      'day_index', v_existing.day_index,
      'current_streak', v_state.current_streak,
      'cycle_position', v_state.cycle_position,
      'total_signins', v_state.total_signins,
      'reward', v_existing.reward,
      'ledger_results', '[]'::jsonb,
      'progress_result', v_progress_result,
      'checked_in_at', v_existing.created_at,
      'idempotent', false
    );

    update ops.idempotency_keys
    set response = v_response,
        status = 'completed',
        locked_until = null,
        updated_at = now()
    where key = v_scoped_key;

    return v_response;
  end if;

  if v_state.last_signin_date = v_local_date - 1 then
    v_current_streak := v_state.current_streak + 1;
    v_day_index := case
      when v_state.cycle_position >= v_campaign.cycle_days then 1
      else greatest(v_state.cycle_position, 0) + 1
    end;
  else
    v_current_streak := 1;
    v_day_index := 1;
  end if;

  select reward
  into v_reward
  from tasks.signin_days
  where campaign_id = v_campaign.id
    and day_index = v_day_index;

  if v_reward is null or jsonb_typeof(v_reward) <> 'array' then
    raise exception 'signin reward config invalid';
  end if;

  insert into tasks.user_signins (
    user_id,
    campaign_id,
    day_index,
    signin_date,
    reward,
    status,
    idempotency_key,
    request_fingerprint
  ) values (
    p_user_id,
    v_campaign.id,
    v_day_index,
    v_local_date,
    v_reward,
    'claimed',
    v_idempotency_key,
    v_request_fingerprint
  )
  returning * into v_existing;

  v_rewards_result := api._apply_reward_json(
    p_user_id,
    v_reward,
    'daily_check_in',
    v_existing.id,
    'daily_check_in:' || v_idempotency_key
  );

  update tasks.user_signin_states
  set current_streak = v_current_streak,
      cycle_position = v_day_index,
      last_signin_date = v_local_date,
      total_signins = total_signins + 1,
      metadata = metadata || jsonb_build_object(
        'last_signin_id', v_existing.id,
        'last_idempotency_key', v_idempotency_key,
        'last_request_fingerprint', v_request_fingerprint,
        'last_timezone_offset_minutes', v_timezone_offset_minutes
      ),
      updated_at = now()
  where user_id = p_user_id
    and campaign_id = v_campaign.id
  returning * into v_state;

  v_progress_result := api.task_record_progress(
    p_user_id,
    'signin_success',
    1,
    v_existing.id,
    v_local_date::text
  );

  v_response := jsonb_build_object(
    'signin_id', v_existing.id,
    'campaign_id', v_campaign.id,
    'already_claimed', false,
    'day_index', v_day_index,
    'current_streak', v_state.current_streak,
    'cycle_position', v_state.cycle_position,
    'total_signins', v_state.total_signins,
    'reward', v_reward,
    'ledger_results', v_rewards_result,
    'progress_result', v_progress_result,
    'checked_in_at', v_existing.created_at,
    'idempotent', false
  );

  update ops.idempotency_keys
  set response = v_response,
      status = 'completed',
      locked_until = null,
      updated_at = now()
  where key = v_scoped_key;

  return v_response;
end;
$$;

create or replace function api.task_daily_check_in(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return api.task_daily_check_in(
    p_user_id,
    null,
    current_date,
    0,
    'legacy:task_daily_check_in:' || gen_random_uuid()::text
  );
end;
$$;


-- ============================================================
