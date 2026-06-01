-- ops_check_rate_limit.sql
-- Centralized API rate limit bucket update used by Vercel Functions.

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
