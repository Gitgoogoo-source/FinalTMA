-- Phase 6 worker backend: durable job runs, visible locks, and service-role RPCs.

create table if not exists ops.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null check (
    job_name in (
      'reconciliation',
      'market_stats',
      'leaderboard',
      'retry_payments',
      'retry_mints',
      'expire_listings',
      'campaign_close',
      'cleanup_idempotency'
    )
  ),
  request_id text not null,
  triggered_by text not null check (triggered_by in ('cron', 'admin', 'script', 'system')),
  triggered_by_admin_user_id uuid references ops.admin_users(id) on delete set null,
  idempotency_key text,
  status text not null default 'running' check (
    status in (
      'running',
      'success',
      'partial_failed',
      'failed',
      'skipped',
      'already_running'
    )
  ),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  processed_count integer not null default 0 check (processed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_message text,
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

comment on table ops.job_runs is
  'Durable run history for Vercel cron jobs and admin-triggered workers.';

create unique index if not exists job_runs_job_idempotency_idx
  on ops.job_runs (job_name, idempotency_key)
  where idempotency_key is not null;

create index if not exists job_runs_job_started_idx
  on ops.job_runs (job_name, started_at desc, id desc);

create index if not exists job_runs_status_started_idx
  on ops.job_runs (status, started_at desc);

create table if not exists ops.job_locks (
  job_name text primary key check (
    job_name in (
      'reconciliation',
      'market_stats',
      'leaderboard',
      'retry_payments',
      'retry_mints',
      'expire_listings',
      'campaign_close',
      'cleanup_idempotency'
    )
  ),
  locked_by text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > locked_at)
);

comment on table ops.job_locks is
  'Visible expiring worker locks used to avoid concurrent runs of the same job.';

create index if not exists job_locks_expires_at_idx
  on ops.job_locks (expires_at);

alter table ops.job_runs enable row level security;
alter table ops.job_locks enable row level security;

revoke all on table ops.job_runs from public, anon, authenticated;
revoke all on table ops.job_locks from public, anon, authenticated;
grant select, insert, update, delete on table ops.job_runs to service_role;
grant select, insert, update, delete on table ops.job_locks to service_role;

create trigger job_runs_set_updated_at
  before update on ops.job_runs
  for each row execute function core.set_updated_at();

create trigger job_locks_set_updated_at
  before update on ops.job_locks
  for each row execute function core.set_updated_at();

insert into ops.feature_flags (key, enabled, description, rollout)
values
  ('FEATURE_WORKERS_PAGE_ENABLED', true, 'Allow admins with ops:read to view worker run history.', '{}'::jsonb),
  ('FEATURE_WORKERS_MANUAL_RUN_ENABLED', true, 'Allow admins with ops:write to manually run workers with confirmation.', '{}'::jsonb),
  ('FEATURE_RECONCILIATION_WORKER_ENABLED', true, 'Allow scheduled and manual reconciliation workers.', '{}'::jsonb),
  ('FEATURE_MARKET_STATS_WORKER_ENABLED', true, 'Allow scheduled and manual market stats workers.', '{}'::jsonb),
  ('FEATURE_LEADERBOARD_WORKER_ENABLED', true, 'Allow scheduled and manual leaderboard rebuild workers.', '{}'::jsonb),
  ('FEATURE_RETRY_PAYMENTS_WORKER_ENABLED', true, 'Allow scheduled and manual payment retry workers.', '{}'::jsonb),
  ('FEATURE_RETRY_MINTS_WORKER_ENABLED', true, 'Allow scheduled and manual mint retry workers.', '{}'::jsonb),
  ('FEATURE_EXPIRE_LISTINGS_WORKER_ENABLED', true, 'Allow scheduled and manual listing expiration workers.', '{}'::jsonb),
  ('FEATURE_CAMPAIGN_CLOSE_WORKER_ENABLED', true, 'Allow scheduled and manual campaign and blind-box close workers.', '{}'::jsonb),
  ('FEATURE_CLEANUP_IDEMPOTENCY_WORKER_ENABLED', true, 'Allow scheduled and manual idempotency cleanup workers.', '{}'::jsonb)
on conflict (key) do update
set description = excluded.description,
    rollout = ops.feature_flags.rollout || excluded.rollout;

alter table ops.risk_events
  drop constraint if exists risk_events_event_type_check;

alter table ops.risk_events
  add constraint risk_events_event_type_check
  check (
    event_type in (
      'admin_asset_compensation',
      'admin_drop_pool_published',
      'admin_feature_flag_update',
      'admin_inventory_lock_released',
      'admin_mint_retry',
      'admin_payment_dispute_resolved',
      'admin_payment_fulfillment_retry',
      'admin_payment_support_config_update',
      'admin_refund_record_created',
      'admin_star_refund_requested',
      'admin_user_ban',
      'cron_box_activation_blocked',
      'gacha_fulfillment_duplicate_or_conflicting_charge',
      'gacha_fulfillment_failed',
      'gacha_fulfillment_mismatch',
      'gacha_fulfillment_payment_insert_conflict',
      'gacha_fulfillment_star_order_missing',
      'gacha_fulfillment_validation_failed',
      'gacha_high_frequency',
      'gacha_stock_mismatch',
      'ledger_balance_mismatch',
      'market_abnormal_cancel_rate',
      'market_price_manipulation',
      'market_self_trade',
      'mint_confirmed_queue_not_minted',
      'mint_retry_exceeded',
      'multi_account_wallet',
      'negative_balance_detected',
      'onchain_nft_owner_mismatch',
      'payment_disputed',
      'payment_duplicate_webhook',
      'payment_paid_not_fulfilled',
      'referral_abuse',
      'referral_multi_account',
      'referral_rebind_attempt',
      'referral_self_invite',
      'referral_self_loop',
      'wallet_nft_owner_mismatch',
      'wallet_proof_replay',
      'wallet_sync_stuck',
      'worker_failed'
    )
  );

comment on constraint risk_events_event_type_check on ops.risk_events is
  'Rejects direct table writes with event_type outside the canonical risk event whitelist.';

create or replace function api.worker_try_acquire_lock(
  p_job_name text,
  p_lock_token text,
  p_expires_at timestamptz,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lock ops.job_locks%rowtype;
  v_existing ops.job_locks%rowtype;
begin
  if p_job_name not in (
    'reconciliation',
    'market_stats',
    'leaderboard',
    'retry_payments',
    'retry_mints',
    'expire_listings',
    'campaign_close',
    'cleanup_idempotency'
  ) then
    raise exception 'WORKER_JOB_INVALID';
  end if;

  if nullif(trim(p_lock_token), '') is null then
    raise exception 'WORKER_LOCK_TOKEN_REQUIRED';
  end if;

  if p_expires_at <= v_now then
    raise exception 'WORKER_LOCK_EXPIRES_AT_INVALID';
  end if;

  insert into ops.job_locks (
    job_name,
    locked_by,
    locked_at,
    expires_at,
    metadata
  )
  values (
    p_job_name,
    p_lock_token,
    v_now,
    p_expires_at,
    jsonb_build_object('request_context', coalesce(p_request_context, '{}'::jsonb))
  )
  on conflict (job_name) do update
  set locked_by = excluded.locked_by,
      locked_at = excluded.locked_at,
      expires_at = excluded.expires_at,
      metadata = jsonb_build_object(
        'previous_locked_by', ops.job_locks.locked_by,
        'previous_expires_at', ops.job_locks.expires_at,
        'request_context', coalesce(p_request_context, '{}'::jsonb)
      )
  where ops.job_locks.expires_at <= v_now
     or ops.job_locks.locked_by = p_lock_token
  returning * into v_lock;

  if v_lock.job_name is null then
    select *
    into v_existing
    from ops.job_locks
    where job_name = p_job_name;

    return jsonb_build_object(
      'acquired', false,
      'status', 'already_running',
      'job_name', p_job_name,
      'locked_by', v_existing.locked_by,
      'locked_at', v_existing.locked_at,
      'expires_at', v_existing.expires_at
    );
  end if;

  return jsonb_build_object(
    'acquired', true,
    'status', 'running',
    'job_name', v_lock.job_name,
    'locked_by', v_lock.locked_by,
    'locked_at', v_lock.locked_at,
    'expires_at', v_lock.expires_at
  );
end;
$$;

create or replace function api.worker_release_lock(
  p_job_name text,
  p_lock_token text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from ops.job_locks
  where job_name = p_job_name
    and locked_by = p_lock_token;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'released', v_deleted > 0,
    'job_name', p_job_name,
    'request_context', coalesce(p_request_context, '{}'::jsonb)
  );
end;
$$;

create or replace function api.worker_start_run(
  p_job_name text,
  p_request_id text,
  p_triggered_by text,
  p_triggered_by_admin_user_id uuid,
  p_idempotency_key text,
  p_params jsonb,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run ops.job_runs%rowtype;
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
begin
  if p_job_name not in (
    'reconciliation',
    'market_stats',
    'leaderboard',
    'retry_payments',
    'retry_mints',
    'expire_listings',
    'campaign_close',
    'cleanup_idempotency'
  ) then
    raise exception 'WORKER_JOB_INVALID';
  end if;

  if p_triggered_by not in ('cron', 'admin', 'script', 'system') then
    raise exception 'WORKER_TRIGGER_INVALID';
  end if;

  if nullif(trim(p_request_id), '') is null then
    raise exception 'WORKER_REQUEST_ID_REQUIRED';
  end if;

  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'WORKER_PARAMS_INVALID';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    select *
    into v_run
    from ops.job_runs
    where job_name = p_job_name
      and idempotency_key = p_idempotency_key;

    if v_run.id is not null then
      return to_jsonb(v_run) || jsonb_build_object('idempotent', true);
    end if;
  end if;

  insert into ops.job_runs (
    job_name,
    request_id,
    triggered_by,
    triggered_by_admin_user_id,
    idempotency_key,
    status,
    started_at,
    params,
    metadata
  )
  values (
    p_job_name,
    p_request_id,
    p_triggered_by,
    p_triggered_by_admin_user_id,
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    'running',
    clock_timestamp(),
    v_params,
    jsonb_build_object('request_context', coalesce(p_request_context, '{}'::jsonb))
  )
  returning * into v_run;

  return to_jsonb(v_run) || jsonb_build_object('idempotent', false);
end;
$$;

create or replace function api.worker_finish_run(
  p_job_run_id uuid,
  p_status text,
  p_processed_count integer,
  p_failed_count integer,
  p_error_message text,
  p_result jsonb,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run ops.job_runs%rowtype;
  v_result jsonb := coalesce(p_result, '{}'::jsonb);
begin
  if p_status not in ('success', 'partial_failed', 'failed', 'skipped', 'already_running') then
    raise exception 'WORKER_STATUS_INVALID';
  end if;

  if coalesce(p_processed_count, 0) < 0 or coalesce(p_failed_count, 0) < 0 then
    raise exception 'WORKER_COUNTS_INVALID';
  end if;

  if jsonb_typeof(v_result) <> 'object' then
    raise exception 'WORKER_RESULT_INVALID';
  end if;

  update ops.job_runs
  set status = p_status,
      finished_at = clock_timestamp(),
      processed_count = coalesce(p_processed_count, 0),
      failed_count = coalesce(p_failed_count, 0),
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      result = v_result,
      metadata = metadata || jsonb_build_object(
        'finish_request_context',
        coalesce(p_request_context, '{}'::jsonb)
      )
  where id = p_job_run_id
  returning * into v_run;

  if v_run.id is null then
    raise exception 'WORKER_RUN_NOT_FOUND';
  end if;

  return to_jsonb(v_run);
end;
$$;

revoke all on function api.worker_try_acquire_lock(text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function api.worker_release_lock(text, text, jsonb) from public, anon, authenticated;
revoke all on function api.worker_start_run(text, text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.worker_finish_run(uuid, text, integer, integer, text, jsonb, jsonb) from public, anon, authenticated;

grant execute on function api.worker_try_acquire_lock(text, text, timestamptz, jsonb) to service_role;
grant execute on function api.worker_release_lock(text, text, jsonb) to service_role;
grant execute on function api.worker_start_run(text, text, text, uuid, text, jsonb, jsonb) to service_role;
grant execute on function api.worker_finish_run(uuid, text, integer, integer, text, jsonb, jsonb) to service_role;

create or replace function api.worker_expire_market_listings(
  p_limit integer,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_now timestamptz := clock_timestamp();
  v_listing_ids uuid[];
  v_item_ids uuid[];
  v_listing_count integer := 0;
  v_listing_item_count integer := 0;
  v_item_count integer := 0;
  v_lock_count integer := 0;
begin
  with due as (
    select l.id
    from market.listings l
    where l.status = 'active'
      and l.expires_at is not null
      and l.expires_at <= v_now
    order by l.expires_at asc, l.id asc
    limit v_limit
    for update skip locked
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_listing_ids
  from due;

  if cardinality(v_listing_ids) = 0 then
    return jsonb_build_object(
      'expired_listing_count', 0,
      'expired_item_count', 0,
      'released_lock_count', 0,
      'server_time', v_now,
      'request_context', coalesce(p_request_context, '{}'::jsonb)
    );
  end if;

  select coalesce(array_agg(li.item_instance_id), '{}'::uuid[])
  into v_item_ids
  from market.listing_items li
  where li.listing_id = any(v_listing_ids)
    and li.status = 'reserved';

  update market.listings
  set status = 'expired',
      updated_at = v_now,
      metadata = metadata || jsonb_build_object(
        'expired_by_worker_at', v_now,
        'worker_request_context', coalesce(p_request_context, '{}'::jsonb)
      )
  where id = any(v_listing_ids)
    and status = 'active';

  get diagnostics v_listing_count = row_count;

  update market.listing_items
  set status = 'expired'
  where listing_id = any(v_listing_ids)
    and status = 'reserved';

  get diagnostics v_listing_item_count = row_count;

  update inventory.item_instances
  set status = 'available',
      updated_at = v_now,
      lock_version = lock_version + 1
  where id = any(v_item_ids)
    and status = 'listed';

  get diagnostics v_item_count = row_count;

  update inventory.inventory_locks
  set status = 'expired',
      released_at = v_now,
      updated_at = v_now,
      metadata = metadata || jsonb_build_object(
        'expired_by_worker_at', v_now,
        'worker_request_context', coalesce(p_request_context, '{}'::jsonb)
      )
  where item_instance_id = any(v_item_ids)
    and lock_type = 'market_listing'
    and status = 'active';

  get diagnostics v_lock_count = row_count;

  insert into market.listing_events (
    listing_id,
    user_id,
    event_type,
    before_state,
    after_state,
    metadata
  )
  select
    l.id,
    l.seller_user_id,
    'expired',
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'expired'),
    jsonb_build_object(
      'source', 'worker.expire_listings',
      'request_context', coalesce(p_request_context, '{}'::jsonb)
    )
  from market.listings l
  where l.id = any(v_listing_ids);

  return jsonb_build_object(
    'expired_listing_count', v_listing_count,
    'expired_listing_item_count', v_listing_item_count,
    'expired_item_count', v_item_count,
    'released_lock_count', v_lock_count,
    'server_time', v_now,
    'request_context', coalesce(p_request_context, '{}'::jsonb)
  );
end;
$$;

create or replace function api.worker_cleanup_idempotency_keys(
  p_cutoff timestamptz,
  p_limit integer,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := coalesce(p_cutoff, clock_timestamp() - interval '7 days');
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_deleted_count integer := 0;
begin
  with doomed as (
    select k.key
    from ops.idempotency_keys k
    where k.status in ('completed', 'failed')
      and k.updated_at < v_cutoff
      and (k.locked_until is null or k.locked_until < clock_timestamp())
    order by k.updated_at asc, k.key asc
    limit v_limit
    for update skip locked
  ),
  deleted as (
    delete from ops.idempotency_keys k
    using doomed
    where k.key = doomed.key
    returning k.key
  )
  select count(*)::integer
  into v_deleted_count
  from deleted;

  insert into ops.app_events (user_id, event_name, event_source, payload)
  values (
    null,
    'worker_cleanup_idempotency_completed',
    'worker',
    jsonb_build_object(
      'deleted_count', v_deleted_count,
      'cutoff', v_cutoff,
      'limit', v_limit,
      'request_context', coalesce(p_request_context, '{}'::jsonb)
    )
  );

  return jsonb_build_object(
    'deleted_count', v_deleted_count,
    'cutoff', v_cutoff,
    'limit', v_limit,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function api.worker_expire_market_listings(integer, jsonb) from public, anon, authenticated;
revoke all on function api.worker_cleanup_idempotency_keys(timestamptz, integer, jsonb) from public, anon, authenticated;

grant execute on function api.worker_expire_market_listings(integer, jsonb) to service_role;
grant execute on function api.worker_cleanup_idempotency_keys(timestamptz, integer, jsonb) to service_role;
