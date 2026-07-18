create or replace function api.identity_create_session(
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_referral_code text,
  p_token_hash text,
  p_auth_date timestamptz,
  p_expires_at timestamptz,
  p_start_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user identity.users%rowtype;
  v_session_id uuid;
  v_new_user boolean;
begin
  perform pg_advisory_xact_lock(p_telegram_id);
  insert into identity.users (telegram_id, username, first_name, last_name, language_code, referral_code)
  values (p_telegram_id, p_username, p_first_name, p_last_name, p_language_code, p_referral_code)
  on conflict (telegram_id) do nothing
  returning * into v_user;
  v_new_user := v_user.id is not null;
  if not v_new_user then
    update identity.users
    set username = p_username, first_name = p_first_name, last_name = p_last_name,
        language_code = p_language_code, updated_at = now()
    where telegram_id = p_telegram_id
    returning * into v_user;
  end if;

  update identity.sessions set revoked_at = now()
  where user_id = v_user.id and revoked_at is null;
  insert into identity.sessions (user_id, token_hash, auth_date, expires_at, new_user, start_param)
  values (v_user.id, p_token_hash, p_auth_date, p_expires_at, v_new_user, p_start_param)
  returning id into v_session_id;
  insert into economy.balances (user_id, currency)
  values (v_user.id, 'KCOIN'), (v_user.id, 'FGEMS')
  on conflict do nothing;

  return jsonb_build_object(
    'session_id', v_session_id,
    'user_id', v_user.id,
    'account_status', v_user.status,
    'new_user', v_new_user,
    'expires_at', p_expires_at,
    'start_param', p_start_param
  );
end;
$$;

create or replace function api.identity_bootstrap(p_session_id uuid)
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
    'user', jsonb_build_object(
      'id', u.id,
      'telegram_id', u.telegram_id::text,
      'username', u.username,
      'first_name', u.first_name,
      'status', u.status,
      'referral_code', u.referral_code
    ),
    'assets', economy.assets(v_user_id),
    'entitlements', jsonb_build_object(
      'free_normal_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_normal_box' and status = 'unused'),
      'free_rare_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused')
    ),
    'catalog_version', 'v1',
    'blocking_operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at)
      from operations.operations o
      where o.user_id = v_user_id and o.status in ('pending', 'unknown')
    ), '[]'::jsonb),
    'pending_payments', coalesce((
      select jsonb_agg(payments.order_json(p) order by p.created_at desc)
      from payments.orders p
      where p.user_id = v_user_id and p.status in ('pending', 'paid')
    ), '[]'::jsonb),
    'pending_mints', coalesce((
      select jsonb_agg(onchain.mint_json(m) order by m.created_at desc)
      from onchain.mints m
      where m.user_id = v_user_id and m.status in ('reserved', 'submitted', 'unknown')
    ), '[]'::jsonb),
    'server_time', now()
  ) into v_result
  from identity.users u where u.id = v_user_id;
  return v_result;
end;
$$;
