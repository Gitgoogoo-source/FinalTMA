create or replace function api.wallet_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select jsonb_build_object(
    'connected', true,
    'address', w.address,
    'network', w.network,
    'wallet_app_name', w.wallet_app_name,
    'verified_at', w.verified_at
  ) into v_result
  from onchain.wallets w where w.user_id = v_user_id and w.status = 'verified';
  return coalesce(v_result, jsonb_build_object(
    'connected', false,
    'address', null,
    'network', null,
    'wallet_app_name', null,
    'verified_at', null
  ));
end;
$$;

create or replace function api.wallet_create_challenge(
  p_session_id uuid,
  p_payload text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  delete from onchain.wallet_challenges
  where user_id = v_user_id and consumed_at is null and expires_at <= now();
  insert into onchain.wallet_challenges (user_id, challenge, expires_at)
  values (v_user_id, p_payload, p_expires_at);
  return jsonb_build_object('payload', p_payload, 'expires_at', p_expires_at);
end;
$$;
