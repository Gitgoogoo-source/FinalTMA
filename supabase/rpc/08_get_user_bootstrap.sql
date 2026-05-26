-- get_user_bootstrap.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.get_user_bootstrap

create or replace function api.get_user_bootstrap(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
  v_balances jsonb;
  v_wallet jsonb;
  v_flags jsonb;
  v_notifications integer;
  v_feature_flags jsonb;
begin
  select jsonb_build_object(
    'id', u.id,
    'telegram_user_id', u.telegram_user_id,
    'username', u.username,
    'first_name', u.first_name,
    'last_name', u.last_name,
    'display_name', p.display_name,
    'avatar_url', coalesce(p.avatar_url, u.photo_url),
    'invite_code', u.invite_code,
    'status', u.status
  ) into v_profile
  from core.users u
  left join core.user_profiles p on p.user_id = u.id
  where u.id = p_user_id;

  if v_profile is null then
    raise exception 'user not found';
  end if;

  select coalesce(jsonb_object_agg(currency_code, jsonb_build_object('available', available_amount, 'locked', locked_amount)), '{}'::jsonb)
  into v_balances
  from economy.user_balances
  where user_id = p_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'chain', chain,
    'network', network,
    'address', address,
    'is_primary', is_primary,
    'status', status,
    'verified_at', verified_at,
    'last_sync_at', last_sync_at
  ) order by is_primary desc, created_at desc), '[]'::jsonb)
  into v_wallet
  from core.user_wallets
  where user_id = p_user_id and status = 'connected';

  select coalesce(jsonb_agg(jsonb_build_object('flag_code', flag_code, 'flag_level', flag_level, 'reason', reason)), '[]'::jsonb)
  into v_flags
  from core.user_flags
  where user_id = p_user_id and active = true and (ends_at is null or ends_at > now());

  select count(*)::integer into v_notifications
  from core.notifications
  where user_id = p_user_id and read_at is null;

  select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb)
  into v_feature_flags
  from ops.feature_flags;

  return jsonb_build_object(
    'profile', v_profile,
    'balances', v_balances,
    'wallets', v_wallet,
    'flags', v_flags,
    'unread_notifications', v_notifications,
    'feature_flags', v_feature_flags,
    'server_time', now()
  );
end;
$$;


-- ============================================================
