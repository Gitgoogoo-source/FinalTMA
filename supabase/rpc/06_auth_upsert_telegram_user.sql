-- auth_upsert_telegram_user.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.auth_upsert_telegram_user

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
  v_referrer_id uuid;
  v_invite_code text;
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
  returning id, invite_code into v_user_id, v_invite_code;

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

  if p_start_param is not null and length(trim(p_start_param)) > 0 then
    select id into v_referrer_id
    from core.users
    where invite_code = upper(trim(p_start_param))
    limit 1;

    if v_referrer_id is not null and v_referrer_id <> v_user_id then
      update core.users
      set referred_by_user_id = coalesce(referred_by_user_id, v_referrer_id),
          updated_at = now()
      where id = v_user_id and referred_by_user_id is null;

      insert into tasks.referrals (inviter_user_id, invitee_user_id, invite_code, status)
      values (v_referrer_id, v_user_id, upper(trim(p_start_param)), 'pending')
      on conflict (invitee_user_id) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'telegram_user_id', p_telegram_user_id,
    'invite_code', v_invite_code
  );
end;
$$;


-- ============================================================
