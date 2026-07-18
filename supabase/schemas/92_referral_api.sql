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
