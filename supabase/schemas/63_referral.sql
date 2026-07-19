create table referral.relationships (
  invitee_id uuid primary key references identity.users(id) on delete cascade,
  inviter_id uuid not null references identity.users(id) on delete cascade,
  bound_at timestamptz not null default now(),
  first_recharge_at timestamptz,
  reward_fgems bigint not null default 0 check (reward_fgems in (0, 500)),
  reward_operation_id uuid references operations.operations(id),
  unique (inviter_id, invitee_id),
  check (inviter_id <> invitee_id)
);

create index referrals_inviter_bound_idx on referral.relationships (inviter_id, bound_at);
create index referrals_inviter_recharge_idx on referral.relationships (inviter_id, first_recharge_at) where first_recharge_at is not null;

create table referral.milestones (
  user_id uuid not null references identity.users(id) on delete cascade,
  threshold smallint not null check (threshold in (5, 10)),
  operation_id uuid not null references operations.operations(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, threshold)
);

create or replace function api.referral_get(p_session_id uuid, p_bot_username text, p_mini_app_short_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_code text;
begin
  select referral_code into v_code from identity.users where id = v_user_id;
  return jsonb_build_object(
    'referral_code', v_code,
    'link', 'https://t.me/' || p_bot_username || '/' || p_mini_app_short_name || '?startapp=' || v_code,
    'share_text', '邀请好友一起开盲盒。好友通过你的链接加入并完成首次有效充值后，你可获得500 Fgems；累计邀请5位有效充值好友可额外获得1次免费普通盲盒资格，累计邀请10位有效充值好友可额外获得1次免费稀有盲盒资格。',
    'bound_friends', (select count(*) from referral.relationships where inviter_id = v_user_id),
    'valid_recharge_friends', (select count(*) from referral.relationships where inviter_id = v_user_id and first_recharge_at is not null),
    'reward_fgems_total', (select coalesce(sum(reward_fgems), 0) from referral.relationships where inviter_id = v_user_id),
    'rewarded_today', (select count(*) from referral.relationships where inviter_id = v_user_id and first_recharge_at::date = identity.utc_day() and reward_fgems = 500),
    'rewarded_lifetime', (select count(*) from referral.relationships where inviter_id = v_user_id and reward_fgems = 500),
    'milestone_5_status', case when exists(select 1 from referral.milestones where user_id = v_user_id and threshold = 5) then 'granted' else 'pending' end,
    'milestone_10_status', case when exists(select 1 from referral.milestones where user_id = v_user_id and threshold = 10) then 'granted' else 'pending' end
  );
end;
$$;

create or replace function api.referral_bind(
  p_session_id uuid,
  p_operation_id uuid,
  p_code text
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
  v_candidate identity.entry_candidates%rowtype;
  v_inviter_id uuid;
  v_inviter_status text;
  v_result jsonb;
begin
  v_operation := operations.begin_command(p_session_id, 'referral.bind', p_operation_id, jsonb_build_object('code', p_code));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  select * into v_candidate from identity.entry_candidates where user_id = v_user_id for update;

  if exists (select 1 from referral.relationships where invitee_id = v_user_id) then
    if v_candidate.user_id is not null and v_candidate.status = 'pending' then
      update identity.entry_candidates
      set status = 'rejected', result_code = 'REFERRAL_ALREADY_BOUND', operation_id = p_operation_id,
          settled_at = now()
      where user_id = v_user_id;
    end if;
    return operations.fail_command(p_operation_id, 'REFERRAL_ALREADY_BOUND', '{}'::jsonb);
  end if;
  if v_candidate.user_id is null then
    return operations.fail_command(p_operation_id, 'REFERRAL_OLD_USER', '{}'::jsonb);
  end if;
  if v_candidate.code is distinct from p_code then
    return operations.fail_command(p_operation_id, 'REFERRAL_INELIGIBLE', '{}'::jsonb);
  end if;
  if v_candidate.status = 'rejected' then
    return operations.fail_command(p_operation_id, v_candidate.result_code, '{}'::jsonb);
  end if;
  if v_candidate.status = 'bound' then
    return operations.fail_command(p_operation_id, 'REFERRAL_ALREADY_BOUND', '{}'::jsonb);
  end if;
  if now() > v_candidate.expires_at then
    update identity.entry_candidates
    set status = 'rejected', result_code = 'REFERRAL_CANDIDATE_EXPIRED', operation_id = p_operation_id,
        settled_at = now()
    where user_id = v_user_id;
    return operations.fail_command(p_operation_id, 'REFERRAL_CANDIDATE_EXPIRED', '{}'::jsonb);
  end if;
  if exists (select 1 from payments.orders where user_id = v_user_id and status = 'delivered') then
    update identity.entry_candidates
    set status = 'rejected', result_code = 'REFERRAL_ALREADY_RECHARGED', operation_id = p_operation_id,
        settled_at = now()
    where user_id = v_user_id;
    return operations.fail_command(p_operation_id, 'REFERRAL_ALREADY_RECHARGED', '{}'::jsonb);
  end if;

  select id, status into v_inviter_id, v_inviter_status
  from identity.users where referral_code = p_code;
  if v_inviter_id is null then
    update identity.entry_candidates
    set status = 'rejected', result_code = 'REFERRAL_CODE_INVALID', operation_id = p_operation_id,
        settled_at = now()
    where user_id = v_user_id;
    return operations.fail_command(p_operation_id, 'REFERRAL_CODE_INVALID', '{}'::jsonb);
  end if;
  if v_inviter_id = v_user_id then
    update identity.entry_candidates
    set status = 'rejected', result_code = 'REFERRAL_SELF_BIND', operation_id = p_operation_id,
        settled_at = now()
    where user_id = v_user_id;
    return operations.fail_command(p_operation_id, 'REFERRAL_SELF_BIND', '{}'::jsonb);
  end if;
  if v_inviter_status <> 'normal' then
    update identity.entry_candidates
    set status = 'rejected', result_code = 'REFERRAL_INVITER_UNAVAILABLE', operation_id = p_operation_id,
        settled_at = now()
    where user_id = v_user_id;
    return operations.fail_command(p_operation_id, 'REFERRAL_INVITER_UNAVAILABLE', '{}'::jsonb);
  end if;

  update identity.users set invited_by = v_inviter_id, updated_at = now()
  where id = v_user_id and invited_by is null;
  insert into referral.relationships (invitee_id, inviter_id) values (v_user_id, v_inviter_id);
  update identity.entry_candidates
  set status = 'bound', result_code = 'REFERRAL_BOUND', operation_id = p_operation_id,
      inviter_id = v_inviter_id, settled_at = now()
  where user_id = v_user_id;
  update identity.sessions set referral_processed_at = now() where id = p_session_id;
  v_result := jsonb_build_object('bound', true, 'referral_code', p_code);
  return operations.complete_command(p_operation_id, v_result);
end;
$$;

create or replace function api.referral_share_event(
  p_session_id uuid,
  p_operation_id uuid,
  p_event text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'referral.share_event', p_operation_id, jsonb_build_object('event', p_event));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    if p_event = 'copy_link' then perform tasks.progress(v_operation.user_id, 'copy_referral');
    elsif p_event = 'telegram_invite' then perform tasks.progress(v_operation.user_id, 'telegram_invite');
    else perform api.raise_business_error('SHARE_EVENT_INVALID', '分享事件无效'); end if;
    v_result := jsonb_build_object('recorded', true, 'event', p_event);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
