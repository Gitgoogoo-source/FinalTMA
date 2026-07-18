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
  v_session identity.sessions%rowtype;
  v_inviter_id uuid;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'referral.bind', p_operation_id, jsonb_build_object('code', upper(p_code)));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_session from identity.sessions where id = p_session_id and user_id = v_user_id for update;
    if exists (select 1 from referral.relationships where invitee_id = v_user_id) then perform api.raise_business_error('REFERRAL_ALREADY_BOUND', '邀请关系已绑定'); end if;
    if not v_session.new_user or v_session.created_at < now() - interval '10 minutes' or v_session.start_param is distinct from p_code then perform api.raise_business_error('REFERRAL_INVALID', '邀请关系不符合绑定条件'); end if;
    select id into v_inviter_id from identity.users where referral_code = upper(p_code) and status = 'normal';
    if v_inviter_id is null then perform api.raise_business_error('REFERRAL_INVALID', '邀请码无效'); end if;
    if v_inviter_id = v_user_id then perform api.raise_business_error('REFERRAL_SELF_BIND', '不能绑定自己的邀请码'); end if;
    if exists (select 1 from payments.orders where user_id = v_user_id and status = 'delivered')
      or exists (select 1 from referral.relationships where inviter_id = v_user_id)
      or exists (select 1 from identity.users where id = v_inviter_id and invited_by is not null) then
      perform api.raise_business_error('REFERRAL_INVALID', '邀请关系不符合单层规则');
    end if;
    update identity.users set invited_by = v_inviter_id, updated_at = now() where id = v_user_id and invited_by is null;
    insert into referral.relationships (invitee_id, inviter_id) values (v_user_id, v_inviter_id);
    update identity.sessions set referral_processed_at = now() where id = p_session_id;
    v_result := jsonb_build_object('bound', true, 'referral_code', upper(p_code));
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
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
