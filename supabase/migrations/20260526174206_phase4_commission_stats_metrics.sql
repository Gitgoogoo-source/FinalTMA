-- Phase 4 / 10.1 commission statistics metrics.
-- Adds explicit invite/commission accounting fields without changing claim flow.

begin;

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
  v_invited_count integer := 0;
  v_pending_referral_count integer := 0;
  v_qualified_count integer := 0;
  v_rewarded_count integer := 0;
  v_cancelled_count integer := 0;
  v_first_open_count integer := 0;
  v_valid_invite_count integer := 0;
  v_reward_stats jsonb;
  v_reward_kcoin numeric(38,0) := 0;
  v_pending_commission_count integer := 0;
  v_pending_commission_kcoin numeric(38,0) := 0;
  v_granted_commission_count integer := 0;
  v_granted_commission_kcoin numeric(38,0) := 0;
  v_reversed_commission_count integer := 0;
  v_reversed_commission_kcoin numeric(38,0) := 0;
  v_total_commission_count integer := 0;
  v_total_commission_kcoin numeric(38,0) := 0;
  v_commission_setting jsonb;
  v_commission_bps integer := 1000;
  v_share_total_count integer := 0;
  v_share_copy_link_count integer := 0;
  v_share_telegram_user_count integer := 0;
  v_share_telegram_group_count integer := 0;
  v_share_telegram_channel_count integer := 0;
  v_share_card_share_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'invalid date range';
  end if;

  select value
  into v_commission_setting
  from ops.system_settings
  where key = 'REFERRAL_COMMISSION_BPS';

  if jsonb_typeof(v_commission_setting) = 'object'
     and v_commission_setting ? 'commission_bps'
     and (v_commission_setting ->> 'commission_bps') ~ '^[0-9]+$' then
    v_commission_bps := (v_commission_setting ->> 'commission_bps')::integer;
  end if;

  if v_commission_bps < 0 or v_commission_bps > 10000 then
    raise exception 'commission_bps must be between 0 and 10000';
  end if;

  select
    count(*)::integer,
    (count(*) filter (where status = 'pending'))::integer,
    (count(*) filter (where status = 'qualified'))::integer,
    (count(*) filter (where status = 'rewarded'))::integer,
    (count(*) filter (where status = 'cancelled'))::integer,
    (count(*) filter (where first_open_order_id is not null))::integer,
    (count(*) filter (
      where status in ('qualified', 'rewarded')
         or first_open_order_id is not null
    ))::integer
  into
    v_invited_count,
    v_pending_referral_count,
    v_qualified_count,
    v_rewarded_count,
    v_cancelled_count,
    v_first_open_count,
    v_valid_invite_count
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

  v_reward_kcoin := coalesce((v_reward_stats #>> '{KCOIN,amount}')::numeric, 0);

  select
    (count(*) filter (where status = 'pending'))::integer,
    coalesce(sum(commission_amount_kcoin) filter (where status = 'pending'), 0)::numeric(38,0),
    (count(*) filter (where status = 'granted'))::integer,
    coalesce(sum(commission_amount_kcoin) filter (where status = 'granted'), 0)::numeric(38,0),
    (count(*) filter (where status = 'reversed'))::integer,
    coalesce(sum(commission_amount_kcoin) filter (where status = 'reversed'), 0)::numeric(38,0)
  into
    v_pending_commission_count,
    v_pending_commission_kcoin,
    v_granted_commission_count,
    v_granted_commission_kcoin,
    v_reversed_commission_count,
    v_reversed_commission_kcoin
  from tasks.referral_commissions rc
  where rc.inviter_user_id = p_user_id
    and (p_from is null or rc.created_at >= p_from)
    and (p_to is null or rc.created_at < p_to);

  v_total_commission_count := v_pending_commission_count + v_granted_commission_count;
  v_total_commission_kcoin := v_pending_commission_kcoin + v_granted_commission_kcoin;

  select
    count(*)::integer,
    (count(*) filter (where share_type = 'copy_link'))::integer,
    (count(*) filter (where share_type = 'telegram_user'))::integer,
    (count(*) filter (where share_type = 'telegram_group'))::integer,
    (count(*) filter (where share_type = 'telegram_channel'))::integer,
    (count(*) filter (where share_type = 'card_share'))::integer
  into
    v_share_total_count,
    v_share_copy_link_count,
    v_share_telegram_user_count,
    v_share_telegram_group_count,
    v_share_telegram_channel_count,
    v_share_card_share_count
  from tasks.share_events se
  where se.user_id = p_user_id
    and (p_from is null or se.created_at >= p_from)
    and (p_to is null or se.created_at < p_to);

  return jsonb_build_object(
    'referrals', jsonb_build_object(
      'total_count', v_invited_count,
      'pending_count', v_pending_referral_count,
      'qualified_count', v_qualified_count,
      'rewarded_count', v_rewarded_count,
      'cancelled_count', v_cancelled_count,
      'first_open_count', v_first_open_count,
      'valid_count', v_valid_invite_count
    ),
    'rewards', coalesce(v_reward_stats, '{}'::jsonb),
    'commissions', jsonb_build_object(
      'pending_count', v_pending_commission_count,
      'pending_amount_kcoin', v_pending_commission_kcoin,
      'granted_count', v_granted_commission_count,
      'granted_amount_kcoin', v_granted_commission_kcoin,
      'reversed_count', v_reversed_commission_count,
      'reversed_amount_kcoin', v_reversed_commission_kcoin,
      'total_count', v_total_commission_count,
      'total_amount_kcoin', v_total_commission_kcoin,
      'current_bps', v_commission_bps,
      'current_rate', v_commission_bps::numeric / 10000
    ),
    'shares', jsonb_build_object(
      'total_count', v_share_total_count,
      'copy_link_count', v_share_copy_link_count,
      'telegram_user_count', v_share_telegram_user_count,
      'telegram_group_count', v_share_telegram_group_count,
      'telegram_channel_count', v_share_telegram_channel_count,
      'card_share_count', v_share_card_share_count
    ),
    'summary', jsonb_build_object(
      'invited_count', v_invited_count,
      'valid_invite_count', v_valid_invite_count,
      'first_open_count', v_first_open_count,
      'total_reward_kcoin', v_reward_kcoin,
      'pending_commission_kcoin', v_pending_commission_kcoin,
      'granted_commission_kcoin', v_granted_commission_kcoin,
      'commission_kcoin', v_granted_commission_kcoin,
      'total_commission_kcoin', v_total_commission_kcoin,
      'commission_bps', v_commission_bps,
      'commission_rate', v_commission_bps::numeric / 10000,
      'share_count', v_share_total_count
    ),
    'date_range', jsonb_build_object('from', p_from, 'to', p_to),
    'server_time', now()
  );
end;
$$;

revoke execute on function api.referral_get_invite_stats(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function api.referral_get_invite_stats(uuid, timestamptz, timestamptz)
  to service_role;

commit;
