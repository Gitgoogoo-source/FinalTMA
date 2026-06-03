-- Phase 6 worker backend tests: job runs, locks, feature flags and service-role RPC gates.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops'
      and c.relname = 'job_runs'
      and c.relkind = 'r'
  ),
  'ops.job_runs exists'
);

select ok(
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops'
      and c.relname = 'job_locks'
      and c.relkind = 'r'
  ),
  'ops.job_locks exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'ops.job_runs'::regclass),
  'ops.job_runs has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'ops.job_locks'::regclass),
  'ops.job_locks has RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'ops.job_runs', 'SELECT'),
  'anon cannot select ops.job_runs'
);

select ok(
  not has_table_privilege('authenticated', 'ops.job_locks', 'SELECT'),
  'authenticated cannot select ops.job_locks'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.worker_try_acquire_lock(text,text,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'service_role can execute worker_try_acquire_lock'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'api.worker_try_acquire_lock(text,text,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot execute worker_try_acquire_lock'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.ops_read_feature_flag(text)',
    'EXECUTE'
  ),
  'service_role can execute ops_read_feature_flag'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'api.ops_read_feature_flag(text)',
    'EXECUTE'
  ),
  'authenticated cannot execute ops_read_feature_flag'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.worker_mark_stale_runs_failed(timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'service_role can execute worker_mark_stale_runs_failed'
);

create temporary table _phase6_worker_test_payloads (
  key text primary key,
  payload jsonb not null
) on commit drop;

insert into _phase6_worker_test_payloads (key, payload)
select
  'lock_1',
  api.worker_try_acquire_lock(
    'market_stats',
    'phase6-worker-lock-1',
    clock_timestamp() + interval '5 minutes',
    jsonb_build_object('test', 'phase6_worker_backend')
  );

select is(
  ((_phase6_worker_test_payloads.payload ->> 'acquired')::boolean),
  true,
  'first worker lock acquisition succeeds'
)
from _phase6_worker_test_payloads
where key = 'lock_1';

insert into _phase6_worker_test_payloads (key, payload)
select
  'lock_2',
  api.worker_try_acquire_lock(
    'market_stats',
    'phase6-worker-lock-2',
    clock_timestamp() + interval '5 minutes',
    jsonb_build_object('test', 'phase6_worker_backend')
  );

select is(
  ((_phase6_worker_test_payloads.payload ->> 'acquired')::boolean),
  false,
  'concurrent worker lock acquisition is skipped'
)
from _phase6_worker_test_payloads
where key = 'lock_2';

select is(
  _phase6_worker_test_payloads.payload ->> 'status',
  'already_running',
  'concurrent worker lock returns already_running status'
)
from _phase6_worker_test_payloads
where key = 'lock_2';

select ok(
  (api.worker_release_lock(
    'market_stats',
    'phase6-worker-lock-1',
    '{}'::jsonb
  ) ->> 'released')::boolean,
  'worker lock can be released by owner token'
);

insert into _phase6_worker_test_payloads (key, payload)
select
  'run_start',
  api.worker_start_run(
    'market_stats',
    'phase6-worker-run-request-1',
    'cron',
    null,
    'phase6-worker-run-idempotency-1',
    jsonb_build_object('limit', 10),
    '{}'::jsonb
  );

select is(
  _phase6_worker_test_payloads.payload ->> 'status',
  'running',
  'worker_start_run writes running status'
)
from _phase6_worker_test_payloads
where key = 'run_start';

insert into _phase6_worker_test_payloads (key, payload)
select
  'run_idempotent',
  api.worker_start_run(
    'market_stats',
    'phase6-worker-run-request-1-replay',
    'cron',
    null,
    'phase6-worker-run-idempotency-1',
    jsonb_build_object('limit', 10),
    '{}'::jsonb
  );

select is(
  ((_phase6_worker_test_payloads.payload ->> 'idempotent')::boolean),
  true,
  'worker_start_run replays same job idempotency key'
)
from _phase6_worker_test_payloads
where key = 'run_idempotent';

insert into _phase6_worker_test_payloads (key, payload)
select
  'run_finish',
  api.worker_finish_run(
    ((_phase6_worker_test_payloads.payload ->> 'id')::uuid),
    'success',
    7,
    0,
    null,
    jsonb_build_object('processed', 7),
    '{}'::jsonb
  )
from _phase6_worker_test_payloads
where key = 'run_start';

select is(
  _phase6_worker_test_payloads.payload ->> 'status',
  'success',
  'worker_finish_run writes success status'
)
from _phase6_worker_test_payloads
where key = 'run_finish';

select is(
  ((_phase6_worker_test_payloads.payload ->> 'processed_count')::integer),
  7,
  'worker_finish_run writes processed_count'
)
from _phase6_worker_test_payloads
where key = 'run_finish';

insert into _phase6_worker_test_payloads (key, payload)
select
  'feature_flag_read',
  api.ops_read_feature_flag('FEATURE_WORKERS_PAGE_ENABLED');

select is(
  ((_phase6_worker_test_payloads.payload ->> 'found')::boolean),
  true,
  'ops_read_feature_flag finds existing flags'
)
from _phase6_worker_test_payloads
where key = 'feature_flag_read';

select is(
  ((_phase6_worker_test_payloads.payload ->> 'enabled')::boolean),
  true,
  'ops_read_feature_flag returns enabled value'
)
from _phase6_worker_test_payloads
where key = 'feature_flag_read';

insert into _phase6_worker_test_payloads (key, payload)
select
  'feature_flag_missing',
  api.ops_read_feature_flag('FEATURE_DOES_NOT_EXIST_FOR_TEST');

select is(
  ((_phase6_worker_test_payloads.payload ->> 'found')::boolean),
  false,
  'ops_read_feature_flag returns found=false for missing flags'
)
from _phase6_worker_test_payloads
where key = 'feature_flag_missing';

insert into _phase6_worker_test_payloads (key, payload)
select
  'run_stale_no_lock',
  api.worker_start_run(
    'market_stats',
    'phase6-worker-stale-no-lock',
    'cron',
    null,
    null,
    jsonb_build_object('test', 'stale_no_lock'),
    '{}'::jsonb
  );

update ops.job_runs
set started_at = clock_timestamp() - interval '1 hour'
where id = (
  select (payload ->> 'id')::uuid
  from _phase6_worker_test_payloads
  where key = 'run_stale_no_lock'
);

insert into _phase6_worker_test_payloads (key, payload)
select
  'run_stale_with_lock',
  api.worker_start_run(
    'leaderboard',
    'phase6-worker-stale-with-lock',
    'cron',
    null,
    null,
    jsonb_build_object('test', 'stale_with_lock'),
    '{}'::jsonb
  );

update ops.job_runs
set started_at = clock_timestamp() - interval '1 hour'
where id = (
  select (payload ->> 'id')::uuid
  from _phase6_worker_test_payloads
  where key = 'run_stale_with_lock'
);

insert into _phase6_worker_test_payloads (key, payload)
select
  'stale_lock',
  api.worker_try_acquire_lock(
    'leaderboard',
    'phase6-worker-stale-lock',
    clock_timestamp() + interval '5 minutes',
    jsonb_build_object('test', 'stale_cleanup_lock')
  );

insert into _phase6_worker_test_payloads (key, payload)
select
  'stale_cleanup',
  api.worker_mark_stale_runs_failed(
    clock_timestamp() - interval '10 minutes',
    jsonb_build_object('test', 'phase6_worker_backend')
  );

select is(
  ((_phase6_worker_test_payloads.payload ->> 'marked_failed_count')::integer),
  1,
  'worker_mark_stale_runs_failed only marks stale runs without an active lock'
)
from _phase6_worker_test_payloads
where key = 'stale_cleanup';

select is(
  (
    select status
    from ops.job_runs
    where id = (
      select (payload ->> 'id')::uuid
      from _phase6_worker_test_payloads
      where key = 'run_stale_no_lock'
    )
  ),
  'failed',
  'stale run without active lock is marked failed'
);

select is(
  (
    select status
    from ops.job_runs
    where id = (
      select (payload ->> 'id')::uuid
      from _phase6_worker_test_payloads
      where key = 'run_stale_with_lock'
    )
  ),
  'running',
  'stale run with active lock remains running'
);

select ok(
  (api.worker_release_lock(
    'leaderboard',
    'phase6-worker-stale-lock',
    '{}'::jsonb
  ) ->> 'released')::boolean,
  'stale cleanup test lock can be released'
);

select ok(
  exists (
    select 1
    from ops.feature_flags
    where key = 'FEATURE_WORKERS_PAGE_ENABLED'
      and enabled = true
  ),
  'workers page feature flag is seeded enabled'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = 'worker_expire_market_listings'
  ),
  'worker_expire_market_listings RPC exists'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = 'worker_cleanup_idempotency_keys'
  ),
  'worker_cleanup_idempotency_keys RPC exists'
);

select * from finish();

rollback;
