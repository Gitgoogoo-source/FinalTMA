create table if not exists ops.telegram_init_data_consumptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  init_data_hash text not null check (length(btrim(init_data_hash)) > 0),
  telegram_auth_date timestamptz,
  consumed_until timestamptz not null,
  session_id uuid references core.app_sessions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, init_data_hash)
);

create index if not exists telegram_init_data_consumptions_user_expires_idx
  on ops.telegram_init_data_consumptions (user_id, consumed_until desc);

create index if not exists telegram_init_data_consumptions_expires_idx
  on ops.telegram_init_data_consumptions (consumed_until);

drop trigger if exists telegram_init_data_consumptions_set_updated_at
  on ops.telegram_init_data_consumptions;

create trigger telegram_init_data_consumptions_set_updated_at
  before update on ops.telegram_init_data_consumptions
  for each row execute function core.set_updated_at();

insert into ops.telegram_init_data_consumptions (
  user_id,
  init_data_hash,
  telegram_auth_date,
  consumed_until,
  session_id,
  metadata,
  created_at,
  updated_at
)
select
  s.user_id,
  s.init_data_hash,
  min(s.telegram_auth_date),
  max(
    greatest(
      s.expires_at,
      coalesce(s.telegram_auth_date, s.created_at, now()) + interval '24 hours'
    )
  ),
  (array_agg(s.id order by s.created_at asc, s.id asc))[1],
  jsonb_build_object('source', 'app_sessions_backfill'),
  min(s.created_at),
  now()
from core.app_sessions s
where s.init_data_hash is not null
  and length(btrim(s.init_data_hash)) > 0
group by s.user_id, s.init_data_hash
on conflict (user_id, init_data_hash) do nothing;

alter table ops.telegram_init_data_consumptions enable row level security;

revoke all privileges on table ops.telegram_init_data_consumptions
  from public, anon, authenticated;

grant all privileges on table ops.telegram_init_data_consumptions to service_role;

drop policy if exists ops_telegram_init_data_consumptions_deny_client_access
  on ops.telegram_init_data_consumptions;

create policy ops_telegram_init_data_consumptions_deny_client_access
  on ops.telegram_init_data_consumptions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function api.ops_check_rate_limit(
  p_key text,
  p_action text,
  p_scope text,
  p_identifier_hash text,
  p_limit integer,
  p_window_ms integer,
  p_block_ms integer default null,
  p_now timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_window_ms integer := coalesce(p_window_ms, 60000);
  v_block_ms integer := coalesce(p_block_ms, p_window_ms, 60000);
  v_window_interval interval;
  v_block_interval interval;
  v_window_start timestamptz;
  v_reset_at timestamptz;
  v_window_key text;
  v_current_count integer := 0;
  v_blocked_until timestamptz;
  v_reason text := 'allowed';
  v_allowed boolean := true;
  v_retry_after_ms integer := 0;
begin
  if p_key is null or length(btrim(p_key)) = 0 then
    raise exception 'rate_limit_key_required';
  end if;

  if p_action is null or length(btrim(p_action)) = 0 then
    raise exception 'rate_limit_action_required';
  end if;

  if p_scope is null or length(btrim(p_scope)) = 0 then
    raise exception 'rate_limit_scope_required';
  end if;

  if p_limit is null or p_limit < 1 then
    raise exception 'rate_limit_limit_invalid';
  end if;

  if v_window_ms < 1000 then
    raise exception 'rate_limit_window_invalid';
  end if;

  if v_block_ms < 1000 then
    raise exception 'rate_limit_block_invalid';
  end if;

  v_window_interval := make_interval(secs => v_window_ms::double precision / 1000.0);
  v_block_interval := make_interval(secs => v_block_ms::double precision / 1000.0);
  v_window_start := to_timestamp(
    floor((extract(epoch from v_now) * 1000.0) / v_window_ms) * v_window_ms / 1000.0
  );
  v_reset_at := v_window_start + v_window_interval;
  v_window_key := to_char(
    v_window_start at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) || ':' || v_window_ms::text;

  perform pg_advisory_xact_lock(hashtextextended('api_rate_limit:' || p_key, 0));

  select r.request_count, r.blocked_until
  into v_current_count, v_blocked_until
  from ops.api_rate_limits r
  where r.scope = p_scope
    and r.subject_key = p_key
    and r.blocked_until is not null
    and r.blocked_until > v_now
  order by r.blocked_until desc
  limit 1;

  if v_blocked_until is not null and v_blocked_until > v_now then
    v_allowed := false;
    v_reason := 'blocked';
    v_retry_after_ms := greatest(
      0,
      ceil(extract(epoch from (v_blocked_until - v_now)) * 1000.0)::integer
    );

    return jsonb_build_object(
      'allowed', v_allowed,
      'current_count', v_current_count,
      'max_hits', p_limit,
      'remaining', 0,
      'reset_at', v_reset_at,
      'retry_after_ms', v_retry_after_ms,
      'blocked_until', v_blocked_until,
      'reason', v_reason
    );
  end if;

  insert into ops.api_rate_limits (
    scope,
    subject_key,
    window_key,
    request_count,
    blocked_until,
    metadata
  )
  values (
    p_scope,
    p_key,
    v_window_key,
    1,
    case when 1 > p_limit then v_now + v_block_interval else null end,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'action', p_action,
        'identifier_hash', p_identifier_hash
      )
  )
  on conflict (scope, subject_key, window_key)
  do update
  set request_count = ops.api_rate_limits.request_count + 1,
      blocked_until = case
        when ops.api_rate_limits.blocked_until is not null
          and ops.api_rate_limits.blocked_until > v_now
          then ops.api_rate_limits.blocked_until
        when ops.api_rate_limits.request_count + 1 > p_limit
          then v_now + v_block_interval
        else null
      end,
      metadata = coalesce(ops.api_rate_limits.metadata, '{}'::jsonb)
        || excluded.metadata,
      updated_at = now()
  returning request_count, blocked_until
  into v_current_count, v_blocked_until;

  if v_blocked_until is not null and v_blocked_until > v_now then
    v_allowed := false;
    v_reason := 'limit_exceeded';
    v_retry_after_ms := greatest(
      0,
      ceil(extract(epoch from (v_blocked_until - v_now)) * 1000.0)::integer
    );
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'current_count', v_current_count,
    'max_hits', p_limit,
    'remaining', greatest(0, p_limit - v_current_count),
    'reset_at', v_reset_at,
    'retry_after_ms', v_retry_after_ms,
    'blocked_until', v_blocked_until,
    'reason', v_reason
  );
end;
$$;

revoke execute on function api.ops_check_rate_limit(
  text,
  text,
  text,
  text,
  integer,
  integer,
  integer,
  timestamptz,
  jsonb
) from public, anon, authenticated;

grant execute on function api.ops_check_rate_limit(
  text,
  text,
  text,
  text,
  integer,
  integer,
  integer,
  timestamptz,
  jsonb
) to service_role;

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
  v_consumption_id uuid;
  v_now timestamptz := now();
  v_consumed_until timestamptz;
  v_revoked_replayed_sessions integer := 0;
  v_revoked_device_sessions integer := 0;
  v_revoked_over_limit_sessions integer := 0;
  v_max_active_sessions integer := 10;
begin
  if p_user_id is null or p_session_token_hash is null or p_expires_at is null then
    raise exception 'user_id, token hash and expires_at are required';
  end if;

  if p_expires_at <= v_now then
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

    v_consumed_until := greatest(
      p_expires_at,
      coalesce(p_telegram_auth_date, v_now) + interval '24 hours'
    );

    insert into ops.telegram_init_data_consumptions (
      user_id,
      init_data_hash,
      telegram_auth_date,
      consumed_until,
      metadata
    )
    values (
      p_user_id,
      p_init_data_hash,
      p_telegram_auth_date,
      v_consumed_until,
      jsonb_build_object(
        'source', 'auth_create_session',
        'device_id', p_device_id,
        'platform', p_platform
      )
    )
    on conflict (user_id, init_data_hash)
    do update
    set telegram_auth_date = excluded.telegram_auth_date,
        consumed_until = excluded.consumed_until,
        session_id = null,
        metadata = excluded.metadata,
        updated_at = v_now
    where ops.telegram_init_data_consumptions.consumed_until <= v_now
    returning id into v_consumption_id;

    if v_consumption_id is null then
      raise exception 'auth_init_data_replayed';
    end if;
  end if;

  if p_device_id is not null then
    update core.app_sessions s
    set revoked_at = v_now
    where s.user_id = p_user_id
      and s.device_id = p_device_id
      and s.revoked_at is null
      and s.expires_at > v_now;

    get diagnostics v_revoked_device_sessions = row_count;
  end if;

  insert into core.app_sessions (
    user_id, session_token_hash, expires_at, telegram_auth_date,
    init_data_hash, ip_hash, user_agent, device_id, platform, last_seen_at
  ) values (
    p_user_id, p_session_token_hash, p_expires_at, p_telegram_auth_date,
    p_init_data_hash, p_ip_hash, p_user_agent, p_device_id, p_platform, v_now
  ) returning id into v_session_id;

  if p_init_data_hash is not null then
    update ops.telegram_init_data_consumptions c
    set session_id = v_session_id,
        metadata = coalesce(c.metadata, '{}'::jsonb)
          || jsonb_build_object('session_id', v_session_id)
    where c.user_id = p_user_id
      and c.init_data_hash = p_init_data_hash;
  end if;

  with ranked_sessions as (
    select
      s.id,
      row_number() over (order by s.created_at desc, s.id desc) as session_rank
    from core.app_sessions s
    where s.user_id = p_user_id
      and s.revoked_at is null
      and s.expires_at > v_now
  )
  update core.app_sessions s
  set revoked_at = v_now
  from ranked_sessions r
  where s.id = r.id
    and r.session_rank > v_max_active_sessions;

  get diagnostics v_revoked_over_limit_sessions = row_count;

  if p_device_id is not null then
    insert into core.user_devices (user_id, device_key, platform, user_agent, last_seen_at)
    values (p_user_id, p_device_id, p_platform, p_user_agent, v_now)
    on conflict (user_id, device_key) do update
    set platform = excluded.platform,
        user_agent = excluded.user_agent,
        last_seen_at = v_now;
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
