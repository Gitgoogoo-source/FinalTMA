begin;

create or replace function api.ops_read_feature_flag(
  p_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(trim(coalesce(p_key, '')), '');
  v_flag ops.feature_flags%rowtype;
begin
  if v_key is null then
    raise exception 'FEATURE_FLAG_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_flag
  from ops.feature_flags
  where key = v_key;

  if v_flag.key is null then
    return jsonb_build_object(
      'found', false,
      'key', v_key,
      'enabled', null
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'key', v_flag.key,
    'enabled', v_flag.enabled
  );
end;
$$;

comment on function api.ops_read_feature_flag(text) is
  'Service-role feature flag read facade. Keeps ops.feature_flags internal and avoids relying on Data API exposure for the ops schema.';

create or replace function api.worker_mark_stale_runs_failed(
  p_cutoff timestamptz,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_context jsonb := coalesce(p_request_context, '{}'::jsonb);
  v_updated integer := 0;
begin
  if p_cutoff is null or p_cutoff > v_now then
    raise exception 'WORKER_STALE_CUTOFF_INVALID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_context) <> 'object' then
    raise exception 'WORKER_REQUEST_CONTEXT_INVALID' using errcode = 'P0001';
  end if;

  update ops.job_runs jr
  set status = 'failed',
      finished_at = v_now,
      failed_count = greatest(jr.failed_count, 1),
      error_message = coalesce(
        nullif(trim(coalesce(jr.error_message, '')), ''),
        'Stale worker run marked failed because it exceeded the worker timeout and no active lock exists.'
      ),
      result = jr.result || jsonb_build_object(
        'stale_cleanup',
        jsonb_build_object(
          'cutoff', p_cutoff,
          'marked_at', v_now
        )
      ),
      metadata = jr.metadata || jsonb_build_object(
        'stale_cleanup_request_context',
        v_context
      )
  where jr.status = 'running'
    and jr.started_at < p_cutoff
    and not exists (
      select 1
      from ops.job_locks jl
      where jl.job_name = jr.job_name
        and jl.expires_at > v_now
    );

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'status', 'success',
    'marked_failed_count', v_updated,
    'cutoff', p_cutoff,
    'server_time', v_now
  );
end;
$$;

comment on function api.worker_mark_stale_runs_failed(timestamptz, jsonb) is
  'Marks abandoned running worker runs failed when they are older than the supplied cutoff and no active lock exists for the job.';

revoke all on function api.ops_read_feature_flag(text)
from public, anon, authenticated;
revoke all on function api.worker_mark_stale_runs_failed(timestamptz, jsonb)
from public, anon, authenticated;

grant execute on function api.ops_read_feature_flag(text) to service_role;
grant execute on function api.worker_mark_stale_runs_failed(timestamptz, jsonb)
to service_role;

select api.worker_mark_stale_runs_failed(
  clock_timestamp() - interval '10 minutes',
  jsonb_build_object(
    'source', 'migration.20260603170455_worker_feature_flag_rpc_and_stale_run_cleanup',
    'reason', 'cleanup_abandoned_running_worker_runs'
  )
);

commit;
