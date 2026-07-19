create table operations.operations (
  id uuid primary key,
  user_id uuid not null references identity.users(id) on delete cascade,
  use_case text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, use_case, id)
);

create index operations_user_created_idx on operations.operations (user_id, created_at desc);
create index operations_pending_idx on operations.operations (created_at) where status in ('pending', 'unknown');

create table operations.webhook_events (
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table operations.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  processed_count integer not null default 0 check (processed_count >= 0),
  details jsonb not null default '{}'::jsonb,
  scan_from timestamptz,
  scan_to timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index job_runs_name_started_idx on operations.job_runs (job_name, started_at desc);

create table operations.invariant_violations (
  id bigint generated always as identity primary key,
  code text not null,
  subject text not null,
  details jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index invariant_violations_open_idx on operations.invariant_violations (code, detected_at) where resolved_at is null;
create unique index invariant_violations_open_subject_idx on operations.invariant_violations (code, subject) where resolved_at is null;

create or replace function operations.operation_json(p_operation operations.operations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'operation_id', p_operation.id,
    'use_case', p_operation.use_case,
    'status', p_operation.status,
    'result', p_operation.result,
    'error_code', p_operation.error_code,
    'created_at', p_operation.created_at,
    'updated_at', p_operation.updated_at
  )
$$;

create or replace function operations.begin_command(
  p_session_id uuid,
  p_use_case text,
  p_operation_id uuid,
  p_request jsonb
)
returns operations.operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_hash text := encode(extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256'), 'hex');
  v_operation operations.operations%rowtype;
begin
  insert into operations.operations (id, user_id, use_case, request_hash, request)
  values (p_operation_id, v_user_id, p_use_case, v_hash, p_request)
  on conflict (id) do nothing
  returning * into v_operation;

  if v_operation.id is null then
    select * into v_operation from operations.operations where id = p_operation_id for update;
    if v_operation.user_id <> v_user_id or v_operation.use_case <> p_use_case or v_operation.request_hash <> v_hash then
      perform api.raise_business_error('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求');
    end if;
  end if;
  return v_operation;
end;
$$;

create or replace function operations.complete_command(p_operation_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'succeeded', result = p_result, error_code = null,
      updated_at = now(), completed_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.pending_command(p_operation_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'pending', result = p_result, error_code = null, updated_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.fail_command(p_operation_id uuid, p_code text, p_detail jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'failed', result = p_detail, error_code = p_code,
      updated_at = now(), completed_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.replay_if_finished(p_operation operations.operations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p_operation.status <> 'pending' or p_operation.result is not null
    then operations.operation_json(p_operation)
    else null
  end
$$;

create or replace function api.operations_get(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select operations.operation_json(o) into v_result
  from operations.operations o
  where o.id = p_operation_id and o.user_id = v_user_id;
  if v_result is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '操作记录不存在');
  end if;
  return v_result;
end;
$$;
