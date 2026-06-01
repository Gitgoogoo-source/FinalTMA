create or replace function api.auth_create_session(
  p_user_id uuid,
  p_session_token_hash text,
  p_expires_at timestamptz,
  p_telegram_auth_date timestamptz default null,
  p_init_data_hash text default null,
  p_ip_hash text default null,
  p_user_agent text default null,
  p_device_id text default null,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_revoked_replayed_sessions integer := 0;
  v_revoked_device_sessions integer := 0;
  v_revoked_over_limit_sessions integer := 0;
  v_max_active_sessions integer := 10;
begin
  if p_user_id is null or p_session_token_hash is null or p_expires_at is null then
    raise exception 'user_id, token hash and expires_at are required';
  end if;

  if p_expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;

  if not exists (
    select 1
    from core.users u
    where u.id = p_user_id
      and u.status = 'active'
  ) then
    raise exception 'auth_user_not_active_or_missing';
  end if;

  if p_init_data_hash is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        'auth_init_data:' || p_user_id::text || ':' || p_init_data_hash,
        0
      )
    );

    if exists (
      select 1
      from core.app_sessions s
      where s.user_id = p_user_id
        and s.init_data_hash = p_init_data_hash
        and s.revoked_at is null
        and s.expires_at > now()
        and not (
          (p_device_id is not null and s.device_id = p_device_id)
          or (
            p_ip_hash is not null
            and p_user_agent is not null
            and s.ip_hash = p_ip_hash
            and s.user_agent = p_user_agent
          )
        )
    ) then
      raise exception 'auth_init_data_replayed';
    end if;

    update core.app_sessions s
    set revoked_at = now()
    where s.user_id = p_user_id
      and s.init_data_hash = p_init_data_hash
      and s.revoked_at is null
      and s.expires_at > now()
      and (
        (p_device_id is not null and s.device_id = p_device_id)
        or (
          p_ip_hash is not null
          and p_user_agent is not null
          and s.ip_hash = p_ip_hash
          and s.user_agent = p_user_agent
        )
      );

    get diagnostics v_revoked_replayed_sessions = row_count;
  end if;

  if p_device_id is not null then
    update core.app_sessions s
    set revoked_at = now()
    where s.user_id = p_user_id
      and s.device_id = p_device_id
      and s.revoked_at is null
      and s.expires_at > now();

    get diagnostics v_revoked_device_sessions = row_count;
  end if;

  insert into core.app_sessions (
    user_id, session_token_hash, expires_at, telegram_auth_date,
    init_data_hash, ip_hash, user_agent, device_id, platform, last_seen_at
  ) values (
    p_user_id, p_session_token_hash, p_expires_at, p_telegram_auth_date,
    p_init_data_hash, p_ip_hash, p_user_agent, p_device_id, p_platform, now()
  ) returning id into v_session_id;

  with ranked_sessions as (
    select
      s.id,
      row_number() over (order by s.created_at desc, s.id desc) as session_rank
    from core.app_sessions s
    where s.user_id = p_user_id
      and s.revoked_at is null
      and s.expires_at > now()
  )
  update core.app_sessions s
  set revoked_at = now()
  from ranked_sessions r
  where s.id = r.id
    and r.session_rank > v_max_active_sessions;

  get diagnostics v_revoked_over_limit_sessions = row_count;

  if p_device_id is not null then
    insert into core.user_devices (user_id, device_key, platform, user_agent, last_seen_at)
    values (p_user_id, p_device_id, p_platform, p_user_agent, now())
    on conflict (user_id, device_key) do update
    set platform = excluded.platform,
        user_agent = excluded.user_agent,
        last_seen_at = now();
  end if;

  return jsonb_build_object(
    'session_id', v_session_id,
    'expires_at', p_expires_at,
    'revoked_replayed_session_count', v_revoked_replayed_sessions,
    'revoked_device_session_count', v_revoked_device_sessions,
    'revoked_over_limit_session_count', v_revoked_over_limit_sessions
  );
end;
$$;

revoke execute on function api.auth_create_session(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function api.auth_create_session(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text
) to service_role;
