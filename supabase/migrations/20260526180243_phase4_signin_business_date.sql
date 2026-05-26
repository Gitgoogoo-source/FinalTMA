-- Phase 4 sign-in hardening:
-- Use the database-owned Asia/Shanghai business date for both sign-in status
-- and claiming. Deprecated client date/timezone arguments are kept only for
-- RPC signature compatibility and are intentionally ignored.

begin;

create or replace function api.signin_get_status(
  p_user_id uuid,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign tasks.signin_campaigns%rowtype;
  v_state tasks.user_signin_states%rowtype;
  v_days jsonb := '[]'::jsonb;
  v_base_position integer := 0;
  v_next_day_index integer;
  v_signed_today boolean := false;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
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
    return jsonb_build_object(
      'campaign', null,
      'days', '[]'::jsonb,
      'current_streak', 0,
      'cycle_position', 0,
      'total_signins', 0,
      'already_claimed_today', false,
      'next_day_index', null,
      'server_date', v_today,
      'server_timezone', 'Asia/Shanghai',
      'server_time', now()
    );
  end if;

  select *
  into v_state
  from tasks.user_signin_states
  where user_id = p_user_id
    and campaign_id = v_campaign.id;

  select exists (
    select 1
    from tasks.user_signins us
    where us.user_id = p_user_id
      and us.campaign_id = v_campaign.id
      and us.signin_date = v_today
      and us.status = 'claimed'
  )
  into v_signed_today;

  if v_state.user_id is null then
    v_base_position := 0;
    v_next_day_index := 1;
  elsif v_state.last_signin_date = v_today then
    v_base_position := least(v_state.cycle_position, v_campaign.cycle_days);
    v_next_day_index := null;
  elsif v_state.last_signin_date = v_today - 1
        and v_state.cycle_position < v_campaign.cycle_days then
    v_base_position := greatest(v_state.cycle_position, 0);
    v_next_day_index := v_base_position + 1;
  else
    v_base_position := 0;
    v_next_day_index := 1;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day_index', sd.day_index,
      'title', sd.title,
      'reward', sd.reward,
      'status', case
        when sd.day_index <= v_base_position then 'claimed'
        when v_next_day_index is not null and sd.day_index = v_next_day_index then 'available'
        else 'locked'
      end,
      'claimed', sd.day_index <= v_base_position,
      'available', v_next_day_index is not null and sd.day_index = v_next_day_index,
      'last_claimed_at', last_signin.created_at,
      'last_claimed_date', last_signin.signin_date
    )
    order by sd.day_index asc
  ), '[]'::jsonb)
  into v_days
  from tasks.signin_days sd
  left join lateral (
    select us.created_at, us.signin_date
    from tasks.user_signins us
    where us.user_id = p_user_id
      and us.campaign_id = sd.campaign_id
      and us.day_index = sd.day_index
      and us.status = 'claimed'
    order by us.signin_date desc, us.created_at desc
    limit 1
  ) last_signin on true
  where sd.campaign_id = v_campaign.id;

  return jsonb_build_object(
    'campaign', jsonb_build_object(
      'campaign_id', v_campaign.id,
      'code', v_campaign.code,
      'title', v_campaign.title,
      'description', v_campaign.description,
      'cycle_days', v_campaign.cycle_days,
      'active', v_campaign.active,
      'starts_at', v_campaign.starts_at,
      'ends_at', v_campaign.ends_at
    ),
    'days', v_days,
    'current_streak', coalesce(v_state.current_streak, 0),
    'cycle_position', coalesce(v_state.cycle_position, 0),
    'total_signins', coalesce(v_state.total_signins, 0),
    'last_signin_date', v_state.last_signin_date,
    'already_claimed_today', coalesce(v_signed_today, false),
    'next_day_index', v_next_day_index,
    'server_date', v_today,
    'server_timezone', 'Asia/Shanghai',
    'server_time', now()
  );
end;
$$;

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
  v_business_date date := (now() at time zone 'Asia/Shanghai')::date;
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
    'business_date', v_business_date,
    'business_timezone', 'Asia/Shanghai'
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
    and signin_date = v_business_date
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
          'business_timezone', 'Asia/Shanghai'
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
      v_business_date::text
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
      'business_date', v_business_date,
      'business_timezone', 'Asia/Shanghai',
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

  if v_state.last_signin_date = v_business_date - 1 then
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
    v_business_date,
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
      last_signin_date = v_business_date,
      total_signins = total_signins + 1,
      metadata = metadata || jsonb_build_object(
        'last_signin_id', v_existing.id,
        'last_idempotency_key', v_idempotency_key,
        'last_request_fingerprint', v_request_fingerprint,
        'business_timezone', 'Asia/Shanghai'
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
    v_business_date::text
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
    'business_date', v_business_date,
    'business_timezone', 'Asia/Shanghai',
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
    null,
    null,
    'legacy:task_daily_check_in:' || gen_random_uuid()::text
  );
end;
$$;

revoke execute on function api.signin_get_status(uuid, uuid)
  from public, anon, authenticated;
grant execute on function api.signin_get_status(uuid, uuid)
  to service_role;

revoke execute on function api.task_daily_check_in(uuid, uuid, date, integer, text)
  from public, anon, authenticated;
grant execute on function api.task_daily_check_in(uuid, uuid, date, integer, text)
  to service_role;

revoke execute on function api.task_daily_check_in(uuid)
  from public, anon, authenticated;
grant execute on function api.task_daily_check_in(uuid)
  to service_role;

commit;
