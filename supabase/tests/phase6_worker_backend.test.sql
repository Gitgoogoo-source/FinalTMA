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
