create or replace function api.auth_upsert_telegram_user(
  p_telegram_user_id bigint,
  p_username text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_language_code text default null,
  p_is_premium boolean default false,
  p_photo_url text default null,
  p_start_param text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_invite_code text;
  v_user_status text;
  v_start_param text := upper(nullif(btrim(p_start_param), ''));
begin
  if p_telegram_user_id is null then
    raise exception 'telegram_user_id is required';
  end if;

  insert into core.users (
    telegram_user_id, username, first_name, last_name, language_code,
    is_premium, photo_url, last_seen_at, last_auth_at, metadata
  ) values (
    p_telegram_user_id, p_username, p_first_name, p_last_name, p_language_code,
    coalesce(p_is_premium, false), p_photo_url, now(), now(), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (telegram_user_id) do update
  set username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      language_code = excluded.language_code,
      is_premium = excluded.is_premium,
      photo_url = coalesce(excluded.photo_url, core.users.photo_url),
      last_seen_at = now(),
      last_auth_at = now(),
      updated_at = now()
  returning id, invite_code, status into v_user_id, v_invite_code, v_user_status;

  insert into core.user_profiles (user_id, display_name, avatar_url, selected_language)
  values (
    v_user_id,
    nullif(trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '')), ''),
    p_photo_url,
    p_language_code
  )
  on conflict (user_id) do update
  set display_name = coalesce(excluded.display_name, core.user_profiles.display_name),
      avatar_url = coalesce(excluded.avatar_url, core.user_profiles.avatar_url),
      selected_language = coalesce(excluded.selected_language, core.user_profiles.selected_language),
      updated_at = now();

  insert into economy.user_balances (user_id, currency_code)
  values (v_user_id, 'KCOIN'), (v_user_id, 'FGEMS')
  on conflict (user_id, currency_code) do nothing;

  if v_start_param is not null and v_user_status = 'active' then
    perform api.referral_bind_inviter(
      v_user_id,
      v_start_param,
      'auth-upsert-referral:' || v_user_id::text || ':' || md5(v_start_param),
      jsonb_build_object(
        'surface', 'auth_upsert_telegram_user',
        'source', 'telegram_start_param',
        'auth_source', coalesce(coalesce(p_metadata, '{}'::jsonb) ->> 'source', 'unknown')
      )
    );
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'telegram_user_id', p_telegram_user_id,
    'invite_code', v_invite_code
  );
end;
$$;
