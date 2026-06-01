-- Phase 6 step 2.12 daily reports / commercial BI.
--
-- Adds durable report snapshots and service-role-only RPC facades. Admin pages
-- read these snapshots; only the daily worker scans the raw business tables.

begin;

alter table ops.job_runs
  drop constraint if exists job_runs_job_name_check;

alter table ops.job_runs
  add constraint job_runs_job_name_check
  check (
    job_name in (
      'reconciliation',
      'market_stats',
      'leaderboard',
      'retry_payments',
      'retry_mints',
      'expire_listings',
      'campaign_close',
      'cleanup_idempotency',
      'daily_reports'
    )
  );

alter table ops.job_locks
  drop constraint if exists job_locks_job_name_check;

alter table ops.job_locks
  add constraint job_locks_job_name_check
  check (
    job_name in (
      'reconciliation',
      'market_stats',
      'leaderboard',
      'retry_payments',
      'retry_mints',
      'expire_listings',
      'campaign_close',
      'cleanup_idempotency',
      'daily_reports'
    )
  );

insert into ops.feature_flags (key, enabled, description, rollout)
values (
  'FEATURE_DAILY_REPORTS_WORKER_ENABLED',
  true,
  'Allow scheduled and manual daily commercial BI report snapshots.',
  '{}'::jsonb
)
on conflict (key) do update
set description = excluded.description,
    rollout = ops.feature_flags.rollout || excluded.rollout;

update ops.admin_roles
set permissions = (
  select jsonb_agg(permission order by permission)
  from (
    select distinct permission
    from jsonb_array_elements_text(
      ops.admin_roles.permissions || '["reports:read","reports:export"]'::jsonb
    ) as role_permissions(permission)
  ) permissions
)
where code = 'OPS';

create table if not exists ops.daily_business_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  campaign_id uuid references catalog.banner_campaigns(id) on delete set null,
  box_id uuid references gacha.blind_boxes(id) on delete set null,
  cohort_key text not null default 'all',
  scope_key text not null,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, scope_key)
);

create table if not exists ops.daily_economy_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  currency_code text not null default 'all',
  source_type text not null default 'all',
  cohort_key text not null default 'all',
  scope_key text not null,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, scope_key)
);

create table if not exists ops.daily_gacha_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  campaign_id uuid references catalog.banner_campaigns(id) on delete set null,
  box_id uuid references gacha.blind_boxes(id) on delete set null,
  series_id uuid references catalog.series(id) on delete set null,
  template_id uuid references catalog.collectible_templates(id) on delete set null,
  rarity_code text not null default 'all',
  cohort_key text not null default 'all',
  scope_key text not null,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, scope_key)
);

create table if not exists ops.daily_market_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  series_id uuid references catalog.series(id) on delete set null,
  template_id uuid references catalog.collectible_templates(id) on delete set null,
  rarity_code text not null default 'all',
  cohort_key text not null default 'all',
  scope_key text not null,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, scope_key)
);

create table if not exists ops.daily_referral_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  campaign_id uuid references catalog.banner_campaigns(id) on delete set null,
  cohort_key text not null default 'all',
  scope_key text not null,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, scope_key)
);

create index if not exists daily_business_reports_date_idx
  on ops.daily_business_reports (report_date desc);
create index if not exists daily_business_reports_dims_idx
  on ops.daily_business_reports (campaign_id, box_id, cohort_key);

create index if not exists daily_economy_reports_date_idx
  on ops.daily_economy_reports (report_date desc);
create index if not exists daily_economy_reports_dims_idx
  on ops.daily_economy_reports (currency_code, source_type, cohort_key);

create index if not exists daily_gacha_reports_date_idx
  on ops.daily_gacha_reports (report_date desc);
create index if not exists daily_gacha_reports_dims_idx
  on ops.daily_gacha_reports (campaign_id, box_id, series_id, template_id, rarity_code, cohort_key);

create index if not exists daily_market_reports_date_idx
  on ops.daily_market_reports (report_date desc);
create index if not exists daily_market_reports_dims_idx
  on ops.daily_market_reports (series_id, template_id, rarity_code, cohort_key);

create index if not exists daily_referral_reports_date_idx
  on ops.daily_referral_reports (report_date desc);
create index if not exists daily_referral_reports_dims_idx
  on ops.daily_referral_reports (campaign_id, cohort_key);

alter table ops.daily_business_reports enable row level security;
alter table ops.daily_economy_reports enable row level security;
alter table ops.daily_gacha_reports enable row level security;
alter table ops.daily_market_reports enable row level security;
alter table ops.daily_referral_reports enable row level security;

revoke all on table ops.daily_business_reports from public, anon, authenticated;
revoke all on table ops.daily_economy_reports from public, anon, authenticated;
revoke all on table ops.daily_gacha_reports from public, anon, authenticated;
revoke all on table ops.daily_market_reports from public, anon, authenticated;
revoke all on table ops.daily_referral_reports from public, anon, authenticated;

grant select, insert, update, delete on table ops.daily_business_reports to service_role;
grant select, insert, update, delete on table ops.daily_economy_reports to service_role;
grant select, insert, update, delete on table ops.daily_gacha_reports to service_role;
grant select, insert, update, delete on table ops.daily_market_reports to service_role;
grant select, insert, update, delete on table ops.daily_referral_reports to service_role;

drop trigger if exists daily_business_reports_set_updated_at on ops.daily_business_reports;
create trigger daily_business_reports_set_updated_at
  before update on ops.daily_business_reports
  for each row execute function core.set_updated_at();

drop trigger if exists daily_economy_reports_set_updated_at on ops.daily_economy_reports;
create trigger daily_economy_reports_set_updated_at
  before update on ops.daily_economy_reports
  for each row execute function core.set_updated_at();

drop trigger if exists daily_gacha_reports_set_updated_at on ops.daily_gacha_reports;
create trigger daily_gacha_reports_set_updated_at
  before update on ops.daily_gacha_reports
  for each row execute function core.set_updated_at();

drop trigger if exists daily_market_reports_set_updated_at on ops.daily_market_reports;
create trigger daily_market_reports_set_updated_at
  before update on ops.daily_market_reports
  for each row execute function core.set_updated_at();

drop trigger if exists daily_referral_reports_set_updated_at on ops.daily_referral_reports;
create trigger daily_referral_reports_set_updated_at
  before update on ops.daily_referral_reports
  for each row execute function core.set_updated_at();

create or replace function api._reports_scope_key(p_parts jsonb)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(
    format('%s=%s', key, nullif(value, '')),
    '|'
    order by key
  )
  from jsonb_each_text(coalesce(p_parts, '{}'::jsonb));
$$;

revoke execute on function api._reports_scope_key(jsonb) from public, anon, authenticated;

create or replace function api._reports_filter_options()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', id, 'code', code, 'title', title, 'status', status)
        order by sort_order, created_at desc
      )
      from catalog.banner_campaigns
    ), '[]'::jsonb),
    'blindBoxes', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', id, 'slug', slug, 'displayName', display_name, 'status', status)
        order by sort_order, created_at desc
      )
      from gacha.blind_boxes
    ), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', id, 'slug', slug, 'displayName', display_name, 'status', status)
        order by sort_order, created_at desc
      )
      from catalog.series
    ), '[]'::jsonb),
    'rarities', coalesce((
      select jsonb_agg(
        jsonb_build_object('code', code, 'displayName', display_name, 'sortOrder', sort_order)
        order by sort_order, code
      )
      from catalog.rarities
    ), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'slug', slug,
          'displayName', display_name,
          'rarityCode', rarity_code,
          'seriesId', series_id,
          'releaseStatus', release_status
        )
        order by sort_order, created_at desc
      )
      from (
        select *
        from catalog.collectible_templates
        order by sort_order, created_at desc
        limit 200
      ) templates
    ), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(
        jsonb_build_object('code', code, 'displayName', display_name, 'symbol', symbol)
        order by code
      )
      from economy.currencies
    ), '[]'::jsonb),
    'cohorts', jsonb_build_array(
      jsonb_build_object('key', 'all', 'label', 'All users')
    )
  );
$$;

revoke execute on function api._reports_filter_options() from public, anon, authenticated;

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
    'cleanup_idempotency',
    'daily_reports'
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
    'cleanup_idempotency',
    'daily_reports'
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

create or replace function api.worker_build_daily_reports(
  p_report_date date default (current_date - 1),
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_date date := coalesce(p_report_date, current_date - 1);
  v_started_at timestamptz := v_report_date::timestamptz;
  v_ended_at timestamptz := (v_report_date + 1)::timestamptz;
  v_processed_count integer := 0;
  v_count integer := 0;
begin
  insert into ops.daily_business_reports (
    report_date,
    campaign_id,
    box_id,
    cohort_key,
    scope_key,
    metrics
  )
  select
    v_report_date,
    null::uuid,
    null::uuid,
    'all',
    'box=all|campaign=all|cohort=all',
    jsonb_build_object(
      'starsGmv', coalesce((select sum(sp.xtr_amount)::numeric from payments.star_payments sp where sp.paid_at >= v_started_at and sp.paid_at < v_ended_at), 0),
      'paymentOrderCount', coalesce((select count(*)::integer from payments.star_orders so where so.created_at >= v_started_at and so.created_at < v_ended_at), 0),
      'paidOrderCount', coalesce((select count(*)::integer from payments.star_orders so where so.paid_at >= v_started_at and so.paid_at < v_ended_at), 0),
      'paymentSuccessRate', case
        when coalesce((select count(*) from payments.star_orders so where so.created_at >= v_started_at and so.created_at < v_ended_at), 0) = 0 then 0
        else round(
          coalesce((select count(*)::numeric from payments.star_orders so where so.paid_at >= v_started_at and so.paid_at < v_ended_at), 0)
          / greatest((select count(*)::numeric from payments.star_orders so where so.created_at >= v_started_at and so.created_at < v_ended_at), 1),
          4
        )
      end,
      'newUserCount', coalesce((select count(*)::integer from core.users u where u.created_at >= v_started_at and u.created_at < v_ended_at), 0),
      'activeUserCount', coalesce((select count(*)::integer from core.users u where coalesce(u.last_seen_at, u.last_auth_at, u.created_at) >= v_started_at and coalesce(u.last_seen_at, u.last_auth_at, u.created_at) < v_ended_at), 0),
      'day1CohortSize', coalesce((select count(*)::integer from core.users u where u.created_at >= v_started_at - interval '1 day' and u.created_at < v_started_at), 0),
      'day1RetainedUserCount', coalesce((select count(*)::integer from core.users u where u.created_at >= v_started_at - interval '1 day' and u.created_at < v_started_at and coalesce(u.last_seen_at, u.last_auth_at) >= v_started_at and coalesce(u.last_seen_at, u.last_auth_at) < v_ended_at), 0),
      'day1RetentionRate', case
        when coalesce((select count(*) from core.users u where u.created_at >= v_started_at - interval '1 day' and u.created_at < v_started_at), 0) = 0 then 0
        else round(
          coalesce((select count(*)::numeric from core.users u where u.created_at >= v_started_at - interval '1 day' and u.created_at < v_started_at and coalesce(u.last_seen_at, u.last_auth_at) >= v_started_at and coalesce(u.last_seen_at, u.last_auth_at) < v_ended_at), 0)
          / greatest((select count(*)::numeric from core.users u where u.created_at >= v_started_at - interval '1 day' and u.created_at < v_started_at), 1),
          4
        )
      end,
      'day7CohortSize', coalesce((select count(*)::integer from core.users u where u.created_at >= v_started_at - interval '7 days' and u.created_at < v_started_at - interval '6 days'), 0),
      'day7RetainedUserCount', coalesce((select count(*)::integer from core.users u where u.created_at >= v_started_at - interval '7 days' and u.created_at < v_started_at - interval '6 days' and coalesce(u.last_seen_at, u.last_auth_at) >= v_started_at and coalesce(u.last_seen_at, u.last_auth_at) < v_ended_at), 0),
      'day7RetentionRate', case
        when coalesce((select count(*) from core.users u where u.created_at >= v_started_at - interval '7 days' and u.created_at < v_started_at - interval '6 days'), 0) = 0 then 0
        else round(
          coalesce((select count(*)::numeric from core.users u where u.created_at >= v_started_at - interval '7 days' and u.created_at < v_started_at - interval '6 days' and coalesce(u.last_seen_at, u.last_auth_at) >= v_started_at and coalesce(u.last_seen_at, u.last_auth_at) < v_ended_at), 0)
          / greatest((select count(*)::numeric from core.users u where u.created_at >= v_started_at - interval '7 days' and u.created_at < v_started_at - interval '6 days'), 1),
          4
        )
      end,
      'gachaOrderCount', coalesce((select count(*)::integer from gacha.draw_orders o where coalesce(o.opened_at, o.paid_at, o.created_at) >= v_started_at and coalesce(o.opened_at, o.paid_at, o.created_at) < v_ended_at), 0),
      'gachaDrawCount', coalesce((select sum(o.draw_count)::integer from gacha.draw_orders o where coalesce(o.opened_at, o.paid_at, o.created_at) >= v_started_at and coalesce(o.opened_at, o.paid_at, o.created_at) < v_ended_at), 0),
      'marketOrderCount', coalesce((select count(*)::integer from market.orders mo where coalesce(mo.completed_at, mo.created_at) >= v_started_at and coalesce(mo.completed_at, mo.created_at) < v_ended_at), 0),
      'marketVolumeKcoin', coalesce((select sum(mo.total_price_kcoin)::numeric from market.orders mo where coalesce(mo.completed_at, mo.created_at) >= v_started_at and coalesce(mo.completed_at, mo.created_at) < v_ended_at), 0),
      'platformFeeKcoin', coalesce((select sum(fs.fee_amount)::numeric from market.fee_settlements fs where coalesce(fs.settled_at, fs.created_at) >= v_started_at and coalesce(fs.settled_at, fs.created_at) < v_ended_at), 0),
      'referralCount', coalesce((select count(*)::integer from tasks.referrals r where r.created_at >= v_started_at and r.created_at < v_ended_at), 0),
      'qualifiedReferralCount', coalesce((select count(*)::integer from tasks.referrals r where r.qualified_at >= v_started_at and r.qualified_at < v_ended_at), 0),
      'albumDiscoveryCount', coalesce((select count(*)::integer from album.user_discoveries d where d.discovered_at >= v_started_at and d.discovered_at < v_ended_at), 0),
      'mintedQueueCount', coalesce((select count(*)::integer from onchain.mint_queue mq where mq.completed_at >= v_started_at and mq.completed_at < v_ended_at and mq.status = 'minted'), 0),
      'nftItemCount', coalesce((select count(*)::integer from onchain.nft_items ni where coalesce(ni.minted_at, ni.created_at) >= v_started_at and coalesce(ni.minted_at, ni.created_at) < v_ended_at), 0)
    )
  on conflict (report_date, scope_key) do update
  set metrics = excluded.metrics,
      campaign_id = excluded.campaign_id,
      box_id = excluded.box_id,
      cohort_key = excluded.cohort_key;

  get diagnostics v_count = row_count;
  v_processed_count := v_processed_count + v_count;

  with groups as (
    select
      coalesce(l.currency_code, 'all') as currency_code,
      coalesce(l.source_type, 'all') as source_type,
      sum(case when l.entry_type in ('credit', 'refund', 'adjustment') then l.amount else 0 end) as issued_amount,
      sum(case when l.entry_type in ('debit', 'fee', 'lock') then l.amount else 0 end) as spent_amount,
      sum(case
        when l.entry_type in ('credit', 'refund', 'adjustment', 'unlock') then l.amount
        when l.entry_type in ('debit', 'fee', 'lock', 'reversal') then -l.amount
        else 0
      end) as net_amount,
      count(*) filter (where l.entry_type in ('credit', 'refund', 'adjustment')) as positive_entry_count,
      count(*) filter (where l.entry_type in ('debit', 'fee', 'lock')) as negative_entry_count,
      count(*) as entry_count
    from economy.currency_ledger l
    where l.created_at >= v_started_at
      and l.created_at < v_ended_at
    group by grouping sets ((l.currency_code, l.source_type), (l.currency_code), ())
  )
  insert into ops.daily_economy_reports (
    report_date,
    currency_code,
    source_type,
    cohort_key,
    scope_key,
    metrics
  )
  select
    v_report_date,
    currency_code,
    source_type,
    'all',
    api._reports_scope_key(jsonb_build_object('currency', currency_code, 'source', source_type, 'cohort', 'all')),
    jsonb_build_object(
      'issuedAmount', coalesce(issued_amount, 0),
      'spentAmount', coalesce(spent_amount, 0),
      'netAmount', coalesce(net_amount, 0),
      'positiveEntryCount', positive_entry_count,
      'negativeEntryCount', negative_entry_count,
      'entryCount', entry_count
    )
  from groups
  on conflict (report_date, scope_key) do update
  set metrics = excluded.metrics,
      currency_code = excluded.currency_code,
      source_type = excluded.source_type,
      cohort_key = excluded.cohort_key;

  get diagnostics v_count = row_count;
  v_processed_count := v_processed_count + v_count;

  with result_groups as (
    select
      dr.box_id,
      ct.series_id,
      dr.template_id,
      coalesce(dr.rarity_code, 'all') as rarity_code,
      count(*) as result_count,
      count(*) filter (where dr.was_pity) as pity_count,
      count(distinct dr.user_id) as unique_user_count
    from gacha.draw_results dr
    left join catalog.collectible_templates ct on ct.id = dr.template_id
    where dr.created_at >= v_started_at
      and dr.created_at < v_ended_at
    group by grouping sets ((dr.box_id, ct.series_id, dr.template_id, dr.rarity_code), ())
  )
  insert into ops.daily_gacha_reports (
    report_date,
    campaign_id,
    box_id,
    series_id,
    template_id,
    rarity_code,
    cohort_key,
    scope_key,
    metrics
  )
  select
    v_report_date,
    null::uuid,
    box_id,
    series_id,
    template_id,
    coalesce(rarity_code, 'all'),
    'all',
    api._reports_scope_key(jsonb_build_object(
      'campaign', 'all',
      'box', coalesce(box_id::text, 'all'),
      'series', coalesce(series_id::text, 'all'),
      'template', coalesce(template_id::text, 'all'),
      'rarity', coalesce(rarity_code, 'all'),
      'cohort', 'all'
    )),
    jsonb_build_object(
      'drawResultCount', result_count,
      'pityCount', pity_count,
      'uniqueUserCount', unique_user_count,
      'gachaOrderCount', order_stats.gacha_order_count,
      'gachaDrawCount', order_stats.gacha_draw_count,
      'tenDrawOrderCount', order_stats.ten_draw_order_count,
      'tenDrawRatio', case
        when order_stats.gacha_order_count = 0 then 0
        else round(order_stats.ten_draw_order_count::numeric / order_stats.gacha_order_count::numeric, 4)
      end,
      'revenueStars', order_stats.revenue_stars,
      'rareOutputCount', case
        when coalesce(rarity_code, 'all') = 'all' then rare_stats.rare_output_count
        when upper(coalesce(rarity_code, '')) in ('RARE', 'EPIC', 'LEGENDARY', 'MYTHIC') then result_count
        else 0
      end
    )
  from result_groups
  left join lateral (
    select
      count(*)::integer as gacha_order_count,
      count(*) filter (where greatest(coalesce(o.draw_count, o.quantity, 1), 1) = 10)::integer as ten_draw_order_count,
      coalesce(sum(greatest(coalesce(o.draw_count, o.quantity, 1), 1))::integer, 0) as gacha_draw_count,
      coalesce(sum(case
        when so.id is not null
         and (so.paid_at is not null or so.status in ('paid', 'fulfilled'))
        then so.xtr_amount
        else 0
      end)::numeric, 0) as revenue_stars
    from gacha.draw_orders o
    left join payments.star_orders so on so.id = o.payment_star_order_id
    where coalesce(o.opened_at, o.paid_at, o.created_at) >= v_started_at
      and coalesce(o.opened_at, o.paid_at, o.created_at) < v_ended_at
      and (result_groups.box_id is null or o.box_id = result_groups.box_id)
  ) order_stats on true
  left join lateral (
    select count(*)::integer as rare_output_count
    from gacha.draw_results dr2
    left join catalog.collectible_templates ct2 on ct2.id = dr2.template_id
    where dr2.created_at >= v_started_at
      and dr2.created_at < v_ended_at
      and upper(coalesce(dr2.rarity_code, '')) in ('RARE', 'EPIC', 'LEGENDARY', 'MYTHIC')
      and (result_groups.box_id is null or dr2.box_id = result_groups.box_id)
      and (result_groups.series_id is null or ct2.series_id = result_groups.series_id)
      and (result_groups.template_id is null or dr2.template_id = result_groups.template_id)
  ) rare_stats on true
  on conflict (report_date, scope_key) do update
  set metrics = excluded.metrics,
      campaign_id = excluded.campaign_id,
      box_id = excluded.box_id,
      series_id = excluded.series_id,
      template_id = excluded.template_id,
      rarity_code = excluded.rarity_code,
      cohort_key = excluded.cohort_key;

  get diagnostics v_count = row_count;
  v_processed_count := v_processed_count + v_count;

  with order_groups as (
    select
      l.template_id,
      ct.series_id,
      coalesce(l.rarity_code, 'all') as rarity_code,
      count(*) as order_count,
      coalesce(sum(mo.item_count), 0) as item_count,
      coalesce(sum(mo.total_price_kcoin), 0) as volume_kcoin,
      coalesce(sum(mo.fee_amount_kcoin), 0) as fee_kcoin
    from market.orders mo
    left join market.listings l on l.id = mo.listing_id
    left join catalog.collectible_templates ct on ct.id = l.template_id
    where coalesce(mo.completed_at, mo.created_at) >= v_started_at
      and coalesce(mo.completed_at, mo.created_at) < v_ended_at
    group by grouping sets ((ct.series_id, l.template_id, l.rarity_code), ())
  )
  insert into ops.daily_market_reports (
    report_date,
    series_id,
    template_id,
    rarity_code,
    cohort_key,
    scope_key,
    metrics
  )
  select
    v_report_date,
    series_id,
    template_id,
    coalesce(rarity_code, 'all'),
    'all',
    api._reports_scope_key(jsonb_build_object(
      'series', coalesce(series_id::text, 'all'),
      'template', coalesce(template_id::text, 'all'),
      'rarity', coalesce(rarity_code, 'all'),
      'cohort', 'all'
    )),
    jsonb_build_object(
      'orderCount', order_count,
      'itemCount', item_count,
      'volumeKcoin', volume_kcoin,
      'platformFeeKcoin', fee_kcoin
    )
  from order_groups
  on conflict (report_date, scope_key) do update
  set metrics = excluded.metrics,
      series_id = excluded.series_id,
      template_id = excluded.template_id,
      rarity_code = excluded.rarity_code,
      cohort_key = excluded.cohort_key;

  get diagnostics v_count = row_count;
  v_processed_count := v_processed_count + v_count;

  insert into ops.daily_referral_reports (
    report_date,
    campaign_id,
    cohort_key,
    scope_key,
    metrics
  )
  select
    v_report_date,
    null::uuid,
    'all',
    'campaign=all|cohort=all',
    jsonb_build_object(
      'invitedCount', coalesce((select count(*)::integer from tasks.referrals r where r.created_at >= v_started_at and r.created_at < v_ended_at), 0),
      'qualifiedCount', coalesce((select count(*)::integer from tasks.referrals r where r.qualified_at >= v_started_at and r.qualified_at < v_ended_at), 0),
      'rewardedCount', coalesce((select count(*)::integer from tasks.referrals r where r.rewarded_at >= v_started_at and r.rewarded_at < v_ended_at), 0),
      'firstOpenConversionRate', case
        when coalesce((select count(*) from tasks.referrals r where r.created_at >= v_started_at and r.created_at < v_ended_at), 0) = 0 then 0
        else round(
          coalesce((select count(*)::numeric from tasks.referrals r where r.qualified_at >= v_started_at and r.qualified_at < v_ended_at), 0)
          / greatest((select count(*)::numeric from tasks.referrals r where r.created_at >= v_started_at and r.created_at < v_ended_at), 1),
          4
        )
      end
    )
  on conflict (report_date, scope_key) do update
  set metrics = excluded.metrics,
      campaign_id = excluded.campaign_id,
      cohort_key = excluded.cohort_key;

  get diagnostics v_count = row_count;
  v_processed_count := v_processed_count + v_count;

  return jsonb_build_object(
    'status', 'success',
    'processed_count', v_processed_count,
    'date_range', jsonb_build_object('from', v_report_date, 'to', v_report_date),
    'report_date', v_report_date,
    'request_context', coalesce(p_request_context, '{}'::jsonb),
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_list_daily_reports(
  p_admin_user_id uuid,
  p_from date default null,
  p_to date default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_cursor integer default 0,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_cursor, 0), 0);
  v_campaign_id uuid := nullif(p_filters ->> 'campaignId', '')::uuid;
  v_box_id uuid := nullif(p_filters ->> 'boxId', '')::uuid;
  v_cohort_key text := nullif(trim(coalesce(p_filters ->> 'cohortKey', '')), '');
  v_items jsonb := '[]'::jsonb;
  v_referrals jsonb := '[]'::jsonb;
  v_row_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['reports:read', 'admin:read']);

  with filtered as (
    select *
    from ops.daily_business_reports r
    where r.report_date between v_from and v_to
      and (v_campaign_id is null or r.campaign_id = v_campaign_id)
      and (v_box_id is null or r.box_id = v_box_id)
      and (v_cohort_key is null or r.cohort_key = v_cohort_key)
    order by r.report_date desc, r.scope_key
    limit v_limit + 1 offset v_offset
  ),
  page_rows as (
    select *
    from filtered
    limit v_limit
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(to_jsonb(page_rows) - 'created_at' - 'updated_at' order by report_date desc, scope_key), '[]'::jsonb)
  into v_row_count, v_items
  from page_rows;

  select coalesce(jsonb_agg(to_jsonb(r) - 'created_at' - 'updated_at' order by r.report_date desc, r.scope_key), '[]'::jsonb)
  into v_referrals
  from ops.daily_referral_reports r
  where r.report_date between v_from and v_to
    and (v_campaign_id is null or r.campaign_id = v_campaign_id)
    and (v_cohort_key is null or r.cohort_key = v_cohort_key);

  return jsonb_build_object(
    'items', v_items,
    'businessReports', v_items,
    'referralReports', v_referrals,
    'filterOptions', api._reports_filter_options(),
    'summary', jsonb_build_object('returnedRows', least(v_row_count, v_limit), 'limit', v_limit, 'offset', v_offset),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'sources', jsonb_build_object('businessReports', 'ops.daily_business_reports', 'referralReports', 'ops.daily_referral_reports'),
    'requestContext', coalesce(p_request_context, '{}'::jsonb),
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_list_economy_reports(
  p_admin_user_id uuid,
  p_from date default null,
  p_to date default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_cursor integer default 0,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_cursor, 0), 0);
  v_currency_code text := upper(nullif(trim(coalesce(p_filters ->> 'currencyCode', '')), ''));
  v_items jsonb := '[]'::jsonb;
  v_row_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['reports:read', 'admin:read']);

  with filtered as (
    select *
    from ops.daily_economy_reports r
    where r.report_date between v_from and v_to
      and (v_currency_code is null or upper(r.currency_code) = v_currency_code)
    order by r.report_date desc, r.currency_code, r.source_type
    limit v_limit + 1 offset v_offset
  ),
  page_rows as (
    select *
    from filtered
    limit v_limit
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(to_jsonb(page_rows) - 'created_at' - 'updated_at' order by report_date desc, currency_code, source_type), '[]'::jsonb)
  into v_row_count, v_items
  from page_rows;

  return jsonb_build_object(
    'items', v_items,
    'filterOptions', api._reports_filter_options(),
    'summary', jsonb_build_object('returnedRows', least(v_row_count, v_limit), 'limit', v_limit, 'offset', v_offset),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'sources', jsonb_build_object('economyReports', 'ops.daily_economy_reports'),
    'requestContext', coalesce(p_request_context, '{}'::jsonb),
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_list_gacha_reports(
  p_admin_user_id uuid,
  p_from date default null,
  p_to date default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_cursor integer default 0,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_cursor, 0), 0);
  v_campaign_id uuid := nullif(p_filters ->> 'campaignId', '')::uuid;
  v_box_id uuid := nullif(p_filters ->> 'boxId', '')::uuid;
  v_series_id uuid := nullif(p_filters ->> 'seriesId', '')::uuid;
  v_template_id uuid := nullif(p_filters ->> 'templateId', '')::uuid;
  v_rarity_code text := upper(nullif(trim(coalesce(p_filters ->> 'rarityCode', '')), ''));
  v_cohort_key text := nullif(trim(coalesce(p_filters ->> 'cohortKey', '')), '');
  v_items jsonb := '[]'::jsonb;
  v_row_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['reports:read', 'admin:read']);

  with filtered as (
    select *
    from ops.daily_gacha_reports r
    where r.report_date between v_from and v_to
      and (v_campaign_id is null or r.campaign_id = v_campaign_id)
      and (v_box_id is null or r.box_id = v_box_id)
      and (v_series_id is null or r.series_id = v_series_id)
      and (v_template_id is null or r.template_id = v_template_id)
      and (v_rarity_code is null or upper(r.rarity_code) = v_rarity_code)
      and (v_cohort_key is null or r.cohort_key = v_cohort_key)
    order by r.report_date desc, r.scope_key
    limit v_limit + 1 offset v_offset
  ),
  page_rows as (
    select *
    from filtered
    limit v_limit
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(to_jsonb(page_rows) - 'created_at' - 'updated_at' order by report_date desc, scope_key), '[]'::jsonb)
  into v_row_count, v_items
  from page_rows;

  return jsonb_build_object(
    'items', v_items,
    'filterOptions', api._reports_filter_options(),
    'summary', jsonb_build_object('returnedRows', least(v_row_count, v_limit), 'limit', v_limit, 'offset', v_offset),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'sources', jsonb_build_object('gachaReports', 'ops.daily_gacha_reports'),
    'requestContext', coalesce(p_request_context, '{}'::jsonb),
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_list_market_reports(
  p_admin_user_id uuid,
  p_from date default null,
  p_to date default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_cursor integer default 0,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_cursor, 0), 0);
  v_series_id uuid := nullif(p_filters ->> 'seriesId', '')::uuid;
  v_template_id uuid := nullif(p_filters ->> 'templateId', '')::uuid;
  v_rarity_code text := upper(nullif(trim(coalesce(p_filters ->> 'rarityCode', '')), ''));
  v_cohort_key text := nullif(trim(coalesce(p_filters ->> 'cohortKey', '')), '');
  v_items jsonb := '[]'::jsonb;
  v_row_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['reports:read', 'admin:read']);

  with filtered as (
    select *
    from ops.daily_market_reports r
    where r.report_date between v_from and v_to
      and (v_series_id is null or r.series_id = v_series_id)
      and (v_template_id is null or r.template_id = v_template_id)
      and (v_rarity_code is null or upper(r.rarity_code) = v_rarity_code)
      and (v_cohort_key is null or r.cohort_key = v_cohort_key)
    order by r.report_date desc, r.scope_key
    limit v_limit + 1 offset v_offset
  ),
  page_rows as (
    select *
    from filtered
    limit v_limit
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(to_jsonb(page_rows) - 'created_at' - 'updated_at' order by report_date desc, scope_key), '[]'::jsonb)
  into v_row_count, v_items
  from page_rows;

  return jsonb_build_object(
    'items', v_items,
    'filterOptions', api._reports_filter_options(),
    'summary', jsonb_build_object('returnedRows', least(v_row_count, v_limit), 'limit', v_limit, 'offset', v_offset),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'sources', jsonb_build_object('marketReports', 'ops.daily_market_reports'),
    'requestContext', coalesce(p_request_context, '{}'::jsonb),
    'serverTime', now()
  );
end;
$$;

revoke execute on function api.worker_try_acquire_lock(text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function api.worker_start_run(text, text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function api.worker_build_daily_reports(date, jsonb) from public, anon, authenticated;
revoke execute on function api.admin_list_daily_reports(uuid, date, date, jsonb, integer, integer, jsonb) from public, anon, authenticated;
revoke execute on function api.admin_list_economy_reports(uuid, date, date, jsonb, integer, integer, jsonb) from public, anon, authenticated;
revoke execute on function api.admin_list_gacha_reports(uuid, date, date, jsonb, integer, integer, jsonb) from public, anon, authenticated;
revoke execute on function api.admin_list_market_reports(uuid, date, date, jsonb, integer, integer, jsonb) from public, anon, authenticated;

grant execute on function api.worker_try_acquire_lock(text, text, timestamptz, jsonb) to service_role;
grant execute on function api.worker_start_run(text, text, text, uuid, text, jsonb, jsonb) to service_role;
grant execute on function api.worker_build_daily_reports(date, jsonb) to service_role;
grant execute on function api.admin_list_daily_reports(uuid, date, date, jsonb, integer, integer, jsonb) to service_role;
grant execute on function api.admin_list_economy_reports(uuid, date, date, jsonb, integer, integer, jsonb) to service_role;
grant execute on function api.admin_list_gacha_reports(uuid, date, date, jsonb, integer, integer, jsonb) to service_role;
grant execute on function api.admin_list_market_reports(uuid, date, date, jsonb, integer, integer, jsonb) to service_role;

commit;
