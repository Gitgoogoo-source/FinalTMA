-- Phase 4 task center, task progress and referral read/write RPCs.
-- Scope: 第四阶段规划.md / 3.3 建议新增 RPC 清单.

begin;

create or replace function api.task_get_list(
  p_user_id uuid,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_task_type text;
  v_status text;
  v_period_key text;
  v_include_inactive boolean := false;
  v_limit integer := 100;
  v_tasks jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'filters must be a json object';
  end if;

  v_task_type := nullif(btrim(v_filters ->> 'task_type'), '');
  v_status := nullif(btrim(v_filters ->> 'status'), '');
  v_period_key := nullif(btrim(v_filters ->> 'period_key'), '');

  if v_filters ? 'include_inactive' then
    v_include_inactive := coalesce((v_filters ->> 'include_inactive')::boolean, false);
  end if;

  if v_filters ? 'limit' then
    v_limit := greatest(1, least(coalesce((v_filters ->> 'limit')::integer, 100), 200));
  end if;

  if v_status is not null
     and v_status not in ('in_progress', 'completed', 'claimed', 'expired') then
    raise exception 'invalid task status filter';
  end if;

  with task_rows as (
    select
      td.id,
      td.code,
      td.task_type,
      td.title,
      td.description,
      td.period_type,
      td.target_count,
      td.reward,
      td.action_type,
      td.action_url,
      td.active,
      td.sort_order,
      td.metadata,
      up.id as progress_id,
      up.period_key as progress_period_key,
      up.progress_count,
      up.target_count as progress_target_count,
      up.status as progress_status,
      up.completed_at,
      up.claimed_at,
      up.updated_at as progress_updated_at
    from tasks.task_definitions td
    left join lateral (
      select up_inner.*
      from tasks.user_task_progress up_inner
      where up_inner.user_id = p_user_id
        and up_inner.task_id = td.id
        and (v_period_key is null or up_inner.period_key = v_period_key)
      order by up_inner.updated_at desc, up_inner.created_at desc
      limit 1
    ) up on true
    where (v_include_inactive or td.active = true)
      and (v_task_type is null or td.task_type = v_task_type)
      and (v_status is null or coalesce(up.status, 'in_progress') = v_status)
    order by td.sort_order asc, td.code asc
    limit v_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'task_id', id,
      'code', code,
      'task_type', task_type,
      'title', title,
      'description', description,
      'period_type', period_type,
      'target_count', target_count,
      'reward', reward,
      'action_type', action_type,
      'action_url', action_url,
      'active', active,
      'sort_order', sort_order,
      'metadata', metadata,
      'progress', jsonb_build_object(
        'progress_id', progress_id,
        'period_key', progress_period_key,
        'progress_count', coalesce(progress_count, 0),
        'target_count', coalesce(progress_target_count, target_count),
        'status', coalesce(progress_status, 'in_progress'),
        'completed_at', completed_at,
        'claimed_at', claimed_at,
        'updated_at', progress_updated_at
      )
    )
    order by sort_order asc, code asc
  ), '[]'::jsonb)
  into v_tasks
  from task_rows;

  return jsonb_build_object(
    'tasks', v_tasks,
    'count', jsonb_array_length(v_tasks),
    'filters', v_filters,
    'server_time', now()
  );
end;
$$;

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
  v_today date := current_date;
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
    'server_time', now()
  );
end;
$$;

create or replace function api.task_record_progress(
  p_user_id uuid,
  p_action text,
  p_amount integer default 1,
  p_source_id uuid default null,
  p_period_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := nullif(btrim(p_action), '');
  v_amount integer := coalesce(p_amount, 1);
  v_user_status text;
  v_task tasks.task_definitions%rowtype;
  v_progress tasks.user_task_progress%rowtype;
  v_period_key text;
  v_already_recorded boolean;
  v_advanced_by integer;
  v_new_count integer;
  v_new_status text;
  v_updated jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_action is null then
    raise exception 'action is required';
  end if;
  if v_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_source_id is null then
    raise exception 'source_id is required';
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

  perform pg_advisory_xact_lock(hashtext('task_record_progress'), hashtext(p_user_id::text || ':' || v_action || ':' || p_source_id::text));

  for v_task in
    select *
    from tasks.task_definitions td
    where td.active = true
      and (
        td.action_type = v_action
        or td.metadata ->> 'progress_source' = v_action
      )
    order by td.sort_order asc, td.code asc
  loop
    v_period_key := coalesce(
      nullif(btrim(p_period_key), ''),
      case v_task.period_type
        when 'daily' then current_date::text
        when 'weekly' then to_char(current_date, 'IYYY-"W"IW')
        when 'event' then p_source_id::text
        else 'once'
      end
    );

    insert into tasks.user_task_progress (
      user_id,
      task_id,
      period_key,
      progress_count,
      target_count,
      status,
      source_events
    ) values (
      p_user_id,
      v_task.id,
      v_period_key,
      0,
      v_task.target_count,
      'in_progress',
      '[]'::jsonb
    )
    on conflict (user_id, task_id, period_key) do nothing;

    select *
    into v_progress
    from tasks.user_task_progress
    where user_id = p_user_id
      and task_id = v_task.id
      and period_key = v_period_key
    for update;

    select exists (
      select 1
      from jsonb_array_elements(coalesce(v_progress.source_events, '[]'::jsonb)) as event(value)
      where event.value ->> 'action' = v_action
        and event.value ->> 'source_id' = p_source_id::text
    )
    into v_already_recorded;

    if v_progress.status = 'claimed' or v_already_recorded then
      v_advanced_by := 0;
    else
      v_new_count := least(v_progress.progress_count + v_amount, v_progress.target_count);
      v_advanced_by := v_new_count - v_progress.progress_count;
      v_new_status := case
        when v_new_count >= v_progress.target_count then 'completed'
        else v_progress.status
      end;

      update tasks.user_task_progress
      set progress_count = v_new_count,
          target_count = v_task.target_count,
          status = v_new_status,
          completed_at = case
            when v_new_status = 'completed' and completed_at is null then now()
            else completed_at
          end,
          source_events = coalesce(source_events, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'action', v_action,
              'amount', v_amount,
              'advanced_by', v_advanced_by,
              'source_id', p_source_id,
              'recorded_at', now()
            )
          ),
          updated_at = now()
      where id = v_progress.id
      returning * into v_progress;
    end if;

    v_updated := v_updated || jsonb_build_array(
      jsonb_build_object(
        'progress_id', v_progress.id,
        'task_id', v_task.id,
        'code', v_task.code,
        'period_key', v_progress.period_key,
        'progress_count', v_progress.progress_count,
        'target_count', v_progress.target_count,
        'status', v_progress.status,
        'completed_at', v_progress.completed_at,
        'claimed_at', v_progress.claimed_at,
        'advanced_by', v_advanced_by,
        'idempotent', v_already_recorded
      )
    );
  end loop;

  return jsonb_build_object(
    'processed', true,
    'user_id', p_user_id,
    'action', v_action,
    'source_id', p_source_id,
    'updated_count', jsonb_array_length(v_updated),
    'progress', v_updated,
    'server_time', now()
  );
end;
$$;

create or replace function api.referral_bind_inviter(
  p_invitee_user_id uuid,
  p_invite_code text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite_code text := upper(nullif(btrim(p_invite_code), ''));
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_scoped_key text;
  v_request_hash text;
  v_existing_idempotency ops.idempotency_keys%rowtype;
  v_invitee core.users%rowtype;
  v_inviter core.users%rowtype;
  v_referral tasks.referrals%rowtype;
  v_response jsonb;
begin
  if p_invitee_user_id is null then
    raise exception 'invitee_user_id is required';
  end if;
  if v_invite_code is null then
    raise exception 'invite_code is required';
  end if;
  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata must be a json object';
  end if;

  v_scoped_key := 'referral_bind_inviter:' || v_idempotency_key;
  v_request_hash := md5(jsonb_build_object(
    'invitee_user_id', p_invitee_user_id,
    'invite_code', v_invite_code
  )::text);

  perform pg_advisory_xact_lock(hashtext('referral_bind_inviter'), hashtext(v_scoped_key));

  select *
  into v_existing_idempotency
  from ops.idempotency_keys
  where key = v_scoped_key
  for update;

  if v_existing_idempotency.key is not null then
    if v_existing_idempotency.scope <> 'referral_bind_inviter'
       or v_existing_idempotency.user_id is distinct from p_invitee_user_id
       or v_existing_idempotency.request_hash is distinct from v_request_hash then
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
    p_invitee_user_id,
    'referral_bind_inviter',
    v_request_hash,
    'started',
    now() + interval '5 minutes'
  );

  select *
  into v_invitee
  from core.users
  where id = p_invitee_user_id
  for update;

  if v_invitee.id is null then
    raise exception 'invitee user not found';
  end if;
  if v_invitee.status <> 'active' then
    raise exception 'invitee user is not active';
  end if;

  select *
  into v_inviter
  from core.users
  where invite_code = v_invite_code
  limit 1;

  if v_inviter.id is null or v_inviter.status <> 'active' then
    v_response := jsonb_build_object(
      'bound', false,
      'status', 'rejected',
      'reason', 'invite_code_not_found',
      'invite_code', v_invite_code,
      'idempotent', false
    );
  elsif v_inviter.id = p_invitee_user_id then
    insert into ops.risk_events (
      user_id,
      event_type,
      severity,
      source_type,
      detail
    ) values (
      p_invitee_user_id,
      'referral_self_invite',
      'medium',
      'referral_bind_inviter',
      jsonb_build_object('invite_code', v_invite_code, 'metadata', v_metadata)
    );

    v_response := jsonb_build_object(
      'bound', false,
      'status', 'rejected',
      'reason', 'self_invite_not_allowed',
      'invite_code', v_invite_code,
      'idempotent', false
    );
  else
    select *
    into v_referral
    from tasks.referrals
    where invitee_user_id = p_invitee_user_id
    for update;

    if v_referral.id is not null
       and v_referral.inviter_user_id <> v_inviter.id then
      insert into ops.risk_events (
        user_id,
        event_type,
        severity,
        source_type,
        source_id,
        detail
      ) values (
        p_invitee_user_id,
        'referral_rebind_attempt',
        'medium',
        'referral_bind_inviter',
        v_referral.id,
        jsonb_build_object(
          'existing_inviter_user_id', v_referral.inviter_user_id,
          'attempted_inviter_user_id', v_inviter.id,
          'invite_code', v_invite_code,
          'metadata', v_metadata
        )
      );

      v_response := jsonb_build_object(
        'bound', false,
        'status', 'conflict',
        'reason', 'referral_already_bound',
        'referral_id', v_referral.id,
        'idempotent', false
      );
    else
      if v_referral.id is null then
        update core.users
        set referred_by_user_id = v_inviter.id,
            updated_at = now()
        where id = p_invitee_user_id
          and referred_by_user_id is null;

        insert into tasks.referrals (
          inviter_user_id,
          invitee_user_id,
          invite_code,
          status,
          metadata
        ) values (
          v_inviter.id,
          p_invitee_user_id,
          v_invite_code,
          'pending',
          v_metadata
        )
        returning * into v_referral;
      end if;

      v_response := jsonb_build_object(
        'bound', true,
        'status', v_referral.status,
        'referral_id', v_referral.id,
        'inviter_user_id', v_referral.inviter_user_id,
        'invitee_user_id', v_referral.invitee_user_id,
        'invite_code', v_referral.invite_code,
        'created_at', v_referral.created_at,
        'idempotent', v_referral.created_at < now() - interval '1 millisecond'
      );
    end if;
  end if;

  update ops.idempotency_keys
  set response = v_response,
      status = 'completed',
      locked_until = null,
      updated_at = now()
  where key = v_scoped_key;

  return v_response;
end;
$$;

create or replace function api.referral_get_invite_stats(
  p_user_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referral_stats jsonb;
  v_reward_stats jsonb;
  v_commission_stats jsonb;
  v_share_stats jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'invalid date range';
  end if;

  select jsonb_build_object(
    'total_count', count(*)::integer,
    'pending_count', (count(*) filter (where status = 'pending'))::integer,
    'qualified_count', (count(*) filter (where status = 'qualified'))::integer,
    'rewarded_count', (count(*) filter (where status = 'rewarded'))::integer,
    'cancelled_count', (count(*) filter (where status = 'cancelled'))::integer
  )
  into v_referral_stats
  from tasks.referrals r
  where r.inviter_user_id = p_user_id
    and (p_from is null or r.created_at >= p_from)
    and (p_to is null or r.created_at < p_to);

  select coalesce(jsonb_object_agg(
    currency_code,
    jsonb_build_object(
      'amount', amount,
      'count', reward_count
    )
  ), '{}'::jsonb)
  into v_reward_stats
  from (
    select
      rr.currency_code,
      coalesce(sum(rr.amount), 0)::numeric(38,0) as amount,
      count(*)::integer as reward_count
    from tasks.referral_rewards rr
    where rr.user_id = p_user_id
      and rr.status = 'granted'
      and (p_from is null or rr.created_at >= p_from)
      and (p_to is null or rr.created_at < p_to)
    group by rr.currency_code
  ) reward_rows;

  select jsonb_build_object(
    'pending_count', (count(*) filter (where status = 'pending'))::integer,
    'pending_amount_kcoin', coalesce(sum(commission_amount_kcoin) filter (where status = 'pending'), 0)::numeric(38,0),
    'granted_count', (count(*) filter (where status = 'granted'))::integer,
    'granted_amount_kcoin', coalesce(sum(commission_amount_kcoin) filter (where status = 'granted'), 0)::numeric(38,0),
    'reversed_count', (count(*) filter (where status = 'reversed'))::integer,
    'reversed_amount_kcoin', coalesce(sum(commission_amount_kcoin) filter (where status = 'reversed'), 0)::numeric(38,0)
  )
  into v_commission_stats
  from tasks.referral_commissions rc
  where rc.inviter_user_id = p_user_id
    and (p_from is null or rc.created_at >= p_from)
    and (p_to is null or rc.created_at < p_to);

  select jsonb_build_object(
    'total_count', count(*)::integer,
    'copy_link_count', (count(*) filter (where share_type = 'copy_link'))::integer,
    'telegram_user_count', (count(*) filter (where share_type = 'telegram_user'))::integer,
    'telegram_group_count', (count(*) filter (where share_type = 'telegram_group'))::integer,
    'telegram_channel_count', (count(*) filter (where share_type = 'telegram_channel'))::integer,
    'card_share_count', (count(*) filter (where share_type = 'card_share'))::integer
  )
  into v_share_stats
  from tasks.share_events se
  where se.user_id = p_user_id
    and (p_from is null or se.created_at >= p_from)
    and (p_to is null or se.created_at < p_to);

  return jsonb_build_object(
    'referrals', coalesce(v_referral_stats, '{}'::jsonb),
    'rewards', coalesce(v_reward_stats, '{}'::jsonb),
    'commissions', coalesce(v_commission_stats, '{}'::jsonb),
    'shares', coalesce(v_share_stats, '{}'::jsonb),
    'date_range', jsonb_build_object('from', p_from, 'to', p_to),
    'server_time', now()
  );
end;
$$;

create or replace function api.referral_record_share_event(
  p_user_id uuid,
  p_share_type text,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share_type text := nullif(btrim(p_share_type), '');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_scoped_key text;
  v_request_hash text;
  v_existing_idempotency ops.idempotency_keys%rowtype;
  v_user_status text;
  v_event_id uuid;
  v_progress jsonb;
  v_response jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_share_type is null then
    raise exception 'share_type is required';
  end if;
  if v_share_type not in ('copy_link', 'telegram_user', 'telegram_group', 'telegram_channel', 'card_share') then
    raise exception 'invalid share_type';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a json object';
  end if;
  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
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

  v_scoped_key := 'referral_record_share_event:' || v_idempotency_key;
  v_request_hash := md5(jsonb_build_object(
    'user_id', p_user_id,
    'share_type', v_share_type,
    'payload', v_payload
  )::text);

  perform pg_advisory_xact_lock(hashtext('referral_record_share_event'), hashtext(v_scoped_key));

  select *
  into v_existing_idempotency
  from ops.idempotency_keys
  where key = v_scoped_key
  for update;

  if v_existing_idempotency.key is not null then
    if v_existing_idempotency.scope <> 'referral_record_share_event'
       or v_existing_idempotency.user_id is distinct from p_user_id
       or v_existing_idempotency.request_hash is distinct from v_request_hash then
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
    'referral_record_share_event',
    v_request_hash,
    'started',
    now() + interval '5 minutes'
  );

  insert into tasks.share_events (
    user_id,
    share_type,
    target,
    payload,
    idempotency_key
  ) values (
    p_user_id,
    v_share_type,
    nullif(v_payload ->> 'target', ''),
    v_payload,
    v_idempotency_key
  )
  returning id into v_event_id;

  v_progress := api.task_record_progress(
    p_user_id,
    'share_event_recorded',
    1,
    v_event_id,
    current_date::text
  );

  v_response := jsonb_build_object(
    'processed', true,
    'event_id', v_event_id,
    'share_type', v_share_type,
    'progress', v_progress,
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

create or replace function api.referral_get_records(
  p_user_id uuid,
  p_cursor timestamptz default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(btrim(p_status), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_records jsonb;
  v_next_cursor timestamptz;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_status is not null
     and v_status not in ('pending', 'qualified', 'rewarded', 'cancelled') then
    raise exception 'invalid referral status';
  end if;

  with rows as (
    select
      r.id,
      r.inviter_user_id,
      r.invitee_user_id,
      r.invite_code,
      r.status,
      r.first_open_order_id,
      r.qualified_at,
      r.rewarded_at,
      r.created_at,
      r.updated_at,
      u.username as invitee_username,
      p.display_name as invitee_display_name
    from tasks.referrals r
    join core.users u on u.id = r.invitee_user_id
    left join core.user_profiles p on p.user_id = r.invitee_user_id
    where r.inviter_user_id = p_user_id
      and (v_status is null or r.status = v_status)
      and (p_cursor is null or r.created_at < p_cursor)
    order by r.created_at desc, r.id desc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'referral_id', id,
      'inviter_user_id', inviter_user_id,
      'invitee_user_id', invitee_user_id,
      'invitee_username', invitee_username,
      'invitee_display_name', invitee_display_name,
      'invite_code', invite_code,
      'status', status,
      'first_open_order_id', first_open_order_id,
      'qualified_at', qualified_at,
      'rewarded_at', rewarded_at,
      'created_at', created_at,
      'updated_at', updated_at
    ) order by created_at desc, id desc), '[]'::jsonb),
    case when count(*) = v_limit then min(created_at) else null end
  into v_records, v_next_cursor
  from rows;

  return jsonb_build_object(
    'records', v_records,
    'count', jsonb_array_length(v_records),
    'next_cursor', v_next_cursor,
    'server_time', now()
  );
end;
$$;

create or replace function api.referral_get_commission_history(
  p_user_id uuid,
  p_cursor timestamptz default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(btrim(p_status), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_records jsonb;
  v_next_cursor timestamptz;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_status is not null
     and v_status not in ('pending', 'granted', 'reversed') then
    raise exception 'invalid commission status';
  end if;

  with rows as (
    select
      c.id,
      c.referral_id,
      c.inviter_user_id,
      c.invitee_user_id,
      c.source_type,
      c.source_id,
      c.base_amount_kcoin,
      c.commission_bps,
      c.commission_amount_kcoin,
      c.ledger_id,
      c.status,
      c.created_at,
      c.claimed_at,
      u.username as invitee_username,
      p.display_name as invitee_display_name
    from tasks.referral_commissions c
    join core.users u on u.id = c.invitee_user_id
    left join core.user_profiles p on p.user_id = c.invitee_user_id
    where c.inviter_user_id = p_user_id
      and (v_status is null or c.status = v_status)
      and (p_cursor is null or c.created_at < p_cursor)
    order by c.created_at desc, c.id desc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'commission_id', id,
      'referral_id', referral_id,
      'inviter_user_id', inviter_user_id,
      'invitee_user_id', invitee_user_id,
      'invitee_username', invitee_username,
      'invitee_display_name', invitee_display_name,
      'source_type', source_type,
      'source_id', source_id,
      'base_amount_kcoin', base_amount_kcoin,
      'commission_bps', commission_bps,
      'commission_amount_kcoin', commission_amount_kcoin,
      'ledger_id', ledger_id,
      'status', status,
      'created_at', created_at,
      'claimed_at', claimed_at
    ) order by created_at desc, id desc), '[]'::jsonb),
    case when count(*) = v_limit then min(created_at) else null end
  into v_records, v_next_cursor
  from rows;

  return jsonb_build_object(
    'commissions', v_records,
    'count', jsonb_array_length(v_records),
    'next_cursor', v_next_cursor,
    'server_time', now()
  );
end;
$$;

create or replace function api.get_user_task_center(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user core.users%rowtype;
  v_task_list jsonb;
  v_tasks jsonb;
  v_task_summary jsonb;
  v_balances jsonb;
  v_signin jsonb;
  v_invite_stats jsonb;
  v_records jsonb;
  v_commissions jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select *
  into v_user
  from core.users
  where id = p_user_id;

  if v_user.id is null then
    raise exception 'user not found';
  end if;

  v_task_list := api.task_get_list(p_user_id, '{}'::jsonb);
  v_tasks := coalesce(v_task_list -> 'tasks', '[]'::jsonb);

  select jsonb_build_object(
    'total_count', count(*)::integer,
    'completed_count', (count(*) filter (where task_item.value #>> '{progress,status}' = 'completed'))::integer,
    'claimed_count', (count(*) filter (where task_item.value #>> '{progress,status}' = 'claimed'))::integer,
    'claimable_count', (count(*) filter (where task_item.value #>> '{progress,status}' = 'completed'))::integer
  )
  into v_task_summary
  from jsonb_array_elements(v_tasks) as task_item(value);

  select coalesce(jsonb_object_agg(
    ub.currency_code,
    jsonb_build_object(
      'available', ub.available_amount,
      'locked', ub.locked_amount,
      'updated_at', ub.updated_at
    )
  ), '{}'::jsonb)
  into v_balances
  from economy.user_balances ub
  where ub.user_id = p_user_id;

  v_signin := api.signin_get_status(p_user_id, null);
  v_invite_stats := api.referral_get_invite_stats(p_user_id, null, null);
  v_records := api.referral_get_records(p_user_id, null, null, 20);
  v_commissions := api.referral_get_commission_history(p_user_id, null, null, 20);

  return jsonb_build_object(
    'user_id', p_user_id,
    'profile', jsonb_build_object(
      'status', v_user.status,
      'invite_code', v_user.invite_code,
      'referred_by_user_id', v_user.referred_by_user_id
    ),
    'tasks', v_tasks,
    'task_summary', coalesce(v_task_summary, jsonb_build_object('total_count', 0, 'completed_count', 0, 'claimed_count', 0, 'claimable_count', 0)),
    'signin', v_signin,
    'invite_stats', v_invite_stats,
    'referral_records', v_records -> 'records',
    'commission_history', v_commissions -> 'commissions',
    'commission_stats', v_invite_stats -> 'commissions',
    'balances', v_balances,
    'server_time', now()
  );
end;
$$;

revoke execute on function api.task_get_list(uuid, jsonb) from public, anon, authenticated;
revoke execute on function api.signin_get_status(uuid, uuid) from public, anon, authenticated;
revoke execute on function api.task_record_progress(uuid, text, integer, uuid, text) from public, anon, authenticated;
revoke execute on function api.referral_bind_inviter(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function api.referral_get_invite_stats(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function api.referral_record_share_event(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function api.referral_get_records(uuid, timestamptz, text, integer) from public, anon, authenticated;
revoke execute on function api.referral_get_commission_history(uuid, timestamptz, text, integer) from public, anon, authenticated;
revoke execute on function api.get_user_task_center(uuid) from public, anon, authenticated;

grant execute on function api.task_get_list(uuid, jsonb) to service_role;
grant execute on function api.signin_get_status(uuid, uuid) to service_role;
grant execute on function api.task_record_progress(uuid, text, integer, uuid, text) to service_role;
grant execute on function api.referral_bind_inviter(uuid, text, text, jsonb) to service_role;
grant execute on function api.referral_get_invite_stats(uuid, timestamptz, timestamptz) to service_role;
grant execute on function api.referral_record_share_event(uuid, text, jsonb, text) to service_role;
grant execute on function api.referral_get_records(uuid, timestamptz, text, integer) to service_role;
grant execute on function api.referral_get_commission_history(uuid, timestamptz, text, integer) to service_role;
grant execute on function api.get_user_task_center(uuid) to service_role;

commit;
