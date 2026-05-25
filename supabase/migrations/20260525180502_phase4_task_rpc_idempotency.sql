-- Phase 4 task RPC idempotency compatibility.
-- Scope: use the Phase 4 idempotency fields in task sign-in and claim RPCs,
-- while keeping the old RPC signatures as compatibility wrappers.

begin;

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
  v_response jsonb;
  v_total_signins integer;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  if v_local_date < current_date - 1 or v_local_date > current_date + 1 then
    raise exception 'signin date out of range';
  end if;

  select * into v_campaign
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

  select * into v_existing_idempotency
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

  select * into v_state
  from tasks.user_signin_states
  where user_id = p_user_id
    and campaign_id = v_campaign.id
  for update;

  select * into v_existing
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

    select count(*)::integer into v_total_signins
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

  select reward into v_reward
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

create or replace function api.task_claim_reward(
  p_user_id uuid,
  p_task_id uuid,
  p_period_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress tasks.user_task_progress%rowtype;
  v_task tasks.task_definitions%rowtype;
  v_claim tasks.task_claims%rowtype;
  v_period_key text := coalesce(nullif(btrim(p_period_key), ''), 'once');
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_scoped_key text;
  v_request_fingerprint text;
  v_existing_idempotency ops.idempotency_keys%rowtype;
  v_rewards_result jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_user_id is null or p_task_id is null then
    raise exception 'user_id and task_id are required';
  end if;

  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  v_scoped_key := 'task_claim_reward:' || v_idempotency_key;
  v_request_fingerprint := md5(jsonb_build_object(
    'user_id', p_user_id,
    'task_id', p_task_id,
    'period_key', v_period_key
  )::text);

  perform pg_advisory_xact_lock(hashtext('task_claim_reward'), hashtext(v_scoped_key));

  select * into v_existing_idempotency
  from ops.idempotency_keys
  where key = v_scoped_key
  for update;

  if v_existing_idempotency.key is not null then
    if v_existing_idempotency.scope <> 'task_claim_reward'
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
    'task_claim_reward',
    v_request_fingerprint,
    'started',
    now() + interval '5 minutes'
  );

  select * into v_task
  from tasks.task_definitions
  where id = p_task_id
    and active = true;

  if v_task.id is null then
    raise exception 'task not found';
  end if;

  select * into v_progress
  from tasks.user_task_progress
  where user_id = p_user_id
    and task_id = p_task_id
    and period_key = v_period_key
  for update;

  if v_progress.id is null then
    raise exception 'task progress not found';
  end if;

  select * into v_claim
  from tasks.task_claims
  where idempotency_key = v_idempotency_key
  for update;

  if v_claim.id is not null then
    if v_claim.user_id is distinct from p_user_id
       or v_claim.task_id is distinct from p_task_id
       or v_claim.period_key is distinct from v_period_key
       or v_claim.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency conflict';
    end if;

    v_response := jsonb_build_object(
      'claim_id', v_claim.id,
      'task_id', v_claim.task_id,
      'period_key', v_claim.period_key,
      'status', 'claimed',
      'reward', v_claim.reward,
      'ledger_results', '[]'::jsonb,
      'claimed_at', v_claim.claimed_at,
      'idempotent', true
    );

    update ops.idempotency_keys
    set response = v_response,
        status = 'completed',
        locked_until = null,
        updated_at = now()
    where key = v_scoped_key;

    return v_response;
  end if;

  if v_progress.status = 'claimed' then
    select * into v_claim
    from tasks.task_claims
    where user_id = p_user_id
      and task_id = p_task_id
      and period_key = v_period_key
    for update;

    if v_claim.id is null then
      raise exception 'task claim integrity violation';
    end if;

    if v_claim.idempotency_key is null then
      update tasks.task_claims
      set idempotency_key = v_idempotency_key,
          request_fingerprint = v_request_fingerprint,
          metadata = metadata || jsonb_build_object('idempotency_key_backfilled_at', now())
      where id = v_claim.id
      returning * into v_claim;
    end if;

    v_response := jsonb_build_object(
      'claim_id', v_claim.id,
      'task_id', v_claim.task_id,
      'period_key', v_claim.period_key,
      'status', 'claimed',
      'reward', v_claim.reward,
      'ledger_results', '[]'::jsonb,
      'claimed_at', v_claim.claimed_at,
      'idempotent', true
    );

    update ops.idempotency_keys
    set response = v_response,
        status = 'completed',
        locked_until = null,
        updated_at = now()
    where key = v_scoped_key;

    return v_response;
  end if;

  if v_progress.status <> 'completed' then
    raise exception 'task is not completed';
  end if;

  insert into tasks.task_claims (
    user_id,
    task_id,
    period_key,
    reward,
    idempotency_key,
    request_fingerprint
  ) values (
    p_user_id,
    p_task_id,
    v_period_key,
    v_task.reward,
    v_idempotency_key,
    v_request_fingerprint
  )
  returning * into v_claim;

  v_rewards_result := api._apply_reward_json(
    p_user_id,
    v_task.reward,
    'task_claim',
    v_claim.id,
    'task_claim:' || v_idempotency_key
  );

  update tasks.user_task_progress
  set status = 'claimed',
      claimed_at = now(),
      updated_at = now()
  where id = v_progress.id;

  v_response := jsonb_build_object(
    'claim_id', v_claim.id,
    'task_id', v_claim.task_id,
    'period_key', v_claim.period_key,
    'status', 'claimed',
    'reward', v_task.reward,
    'ledger_results', v_rewards_result,
    'claimed_at', v_claim.claimed_at,
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
begin
  return api.task_claim_reward(
    p_user_id,
    p_task_id,
    p_period_key,
    'legacy:task_claim_reward:' || gen_random_uuid()::text
  );
end;
$$;

revoke execute on function api.task_daily_check_in(uuid) from public, anon, authenticated;
revoke execute on function api.task_daily_check_in(uuid, uuid, date, integer, text) from public, anon, authenticated;
revoke execute on function api.task_claim_reward(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function api.task_claim_reward(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function api.task_daily_check_in(uuid) to service_role;
grant execute on function api.task_daily_check_in(uuid, uuid, date, integer, text) to service_role;
grant execute on function api.task_claim_reward(uuid, uuid, text) to service_role;
grant execute on function api.task_claim_reward(uuid, uuid, text, text) to service_role;

commit;
