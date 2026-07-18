create table ops.webhook_events (
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table ops.refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  payment_id uuid not null references economy.payments(id),
  provider_event_id text not null unique,
  stars bigint not null check (stars > 0),
  created_at timestamptz not null default now()
);

create index refunds_payment_idx on ops.refunds (payment_id);

create table ops.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  processed_count integer not null default 0 check (processed_count >= 0),
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index job_runs_name_started_idx on ops.job_runs (job_name, started_at desc);

create table ops.invariant_violations (
  id bigint generated always as identity primary key,
  code text not null,
  subject text not null,
  details jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index invariant_violations_open_idx on ops.invariant_violations (code, detected_at) where resolved_at is null;
create unique index invariant_violations_open_subject_idx on ops.invariant_violations (code, subject) where resolved_at is null;

create table ops.auth_attempts (
  id bigint generated always as identity primary key,
  key_hash text not null,
  attempted_at timestamptz not null default now()
);

create index auth_attempts_key_time_idx on ops.auth_attempts (key_hash, attempted_at desc);
