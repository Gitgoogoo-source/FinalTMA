-- Phase 6 step 2.8 monitoring read RPC facades.
--
-- Keep admin monitoring reads off private PostgREST schemas. These functions
-- expose only aggregated or bounded diagnostic payloads through api RPCs.

begin;

create or replace function api._monitoring_rate_status(
  p_value numeric,
  p_warning_at numeric,
  p_critical_at numeric
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_value, 0) >= p_critical_at then 'critical'
    when coalesce(p_value, 0) >= p_warning_at then 'warning'
    else 'ok'
  end;
$$;

create or replace function api._monitoring_success_rate_status(
  p_value numeric,
  p_warning_below numeric,
  p_critical_below numeric
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_value, 1) < p_critical_below then 'critical'
    when coalesce(p_value, 1) < p_warning_below then 'warning'
    else 'ok'
  end;
$$;

create or replace function api._monitoring_latency_status(
  p_value numeric,
  p_warning_at numeric,
  p_critical_at numeric
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_value is null then 'ok'
    when p_value >= p_critical_at then 'critical'
    when p_value >= p_warning_at then 'warning'
    else 'ok'
  end;
$$;

create or replace function api.get_payment_support_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row ops.system_settings%rowtype;
  v_value jsonb := '{}'::jsonb;
begin
  select *
  into v_row
  from ops.system_settings
  where key = 'PAYMENT_SUPPORT_CONFIG';

  if not found then
    return jsonb_build_object(
      'configured', false,
      'support_url', null,
      'support_email', null,
      'updated_at', null,
      'source', 'none'
    );
  end if;

  if jsonb_typeof(v_row.value) = 'object' then
    v_value := v_row.value;
  end if;

  return jsonb_build_object(
    'configured', coalesce((v_value ->> 'configured')::boolean, false),
    'support_url', coalesce(v_value ->> 'support_url', v_value ->> 'supportUrl'),
    'support_email', coalesce(v_value ->> 'support_email', v_value ->> 'supportEmail'),
    'updated_at', v_row.updated_at,
    'source', 'system_settings'
  );
exception
  when invalid_text_representation then
    return jsonb_build_object(
      'configured', false,
      'support_url', null,
      'support_email', null,
      'updated_at', v_row.updated_at,
      'source', 'system_settings'
    );
end;
$$;

create or replace function api.admin_get_monitoring_thresholds(
  p_admin_user_id uuid,
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
  v_thresholds jsonb;
  v_updated_at timestamptz;
  v_source text := 'defaults';
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['admin:read', 'ops:read']);

  select api._monitoring_normalize_thresholds(value), updated_at
  into v_thresholds, v_updated_at
  from ops.system_settings
  where key = 'monitoring.thresholds';

  if v_thresholds is null then
    v_thresholds := api._monitoring_default_thresholds();
  else
    v_source := 'system_settings';
  end if;

  return jsonb_build_object(
    'key', 'monitoring.thresholds',
    'thresholds', v_thresholds,
    'updatedAt', v_updated_at,
    'source', v_source,
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_get_operational_monitoring(
  p_admin_user_id uuid,
  p_window_hours integer default 24,
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
  v_window_hours integer := coalesce(p_window_hours, 24);
  v_now timestamptz := now();
  v_started_at timestamptz;
  v_thresholds jsonb;
  v_thresholds_updated_at timestamptz;
  v_payment_failure_warning numeric;
  v_payment_failure_critical numeric;
  v_fulfillment_stuck_minutes integer;
  v_webhook_stuck_minutes integer;
  v_webhook_critical_stuck_minutes integer;
  v_mint_stuck_minutes integer;
  v_mint_critical_stuck_minutes integer;
  v_payment_total integer := 0;
  v_payment_failed integer := 0;
  v_paid_total integer := 0;
  v_fulfillment_failed integer := 0;
  v_fulfillment_stuck integer := 0;
  v_webhook_processed integer := 0;
  v_webhook_active integer := 0;
  v_webhook_stuck integer := 0;
  v_webhook_critical_stuck integer := 0;
  v_webhook_average_ms numeric;
  v_webhook_p95_ms numeric;
  v_webhook_max_ms numeric;
  v_mint_active integer := 0;
  v_mint_stuck integer := 0;
  v_mint_critical_stuck integer := 0;
  v_recent_payments jsonb;
  v_recent_webhooks jsonb;
  v_recent_mints jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'payments:read');
  perform api._admin_require_permission(v_admin.id, 'mint:read');
  perform api._admin_require_permission(v_admin.id, 'onchain:read');

  if v_window_hours < 1 or v_window_hours > 168 then
    raise exception 'ADMIN_MONITORING_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  v_started_at := v_now - make_interval(hours => v_window_hours);

  select api._monitoring_normalize_thresholds(value), updated_at
  into v_thresholds, v_thresholds_updated_at
  from ops.system_settings
  where key = 'monitoring.thresholds';

  if v_thresholds is null then
    v_thresholds := api._monitoring_default_thresholds();
  end if;

  v_payment_failure_warning := (v_thresholds #>> '{paymentFailureRate,warning}')::numeric;
  v_payment_failure_critical := (v_thresholds #>> '{paymentFailureRate,critical}')::numeric;
  v_fulfillment_stuck_minutes := (v_thresholds #>> '{paidNotFulfilledMinutes,critical}')::integer;
  v_webhook_stuck_minutes := (v_thresholds #>> '{webhookStuckMinutes,warning}')::integer;
  v_webhook_critical_stuck_minutes := (v_thresholds #>> '{webhookStuckMinutes,critical}')::integer;
  v_mint_stuck_minutes := (v_thresholds #>> '{mintStuckMinutes,warning}')::integer;
  v_mint_critical_stuck_minutes := (v_thresholds #>> '{mintStuckMinutes,critical}')::integer;

  select
    count(*)::integer,
    count(*) filter (where status in ('failed', 'expired', 'refunded', 'disputed'))::integer,
    count(*) filter (
      where paid_at is not null
         or status in ('paid', 'fulfilling', 'fulfilled', 'failed', 'refunded', 'disputed')
    )::integer,
    count(*) filter (
      where (
        status in ('failed', 'disputed')
        or (error_message is not null and fulfilled_at is null)
      )
      and (
        paid_at is not null
        or status in ('paid', 'fulfilling', 'fulfilled', 'failed', 'refunded', 'disputed')
      )
    )::integer
  into v_payment_total, v_payment_failed, v_paid_total, v_fulfillment_failed
  from payments.star_orders
  where created_at >= v_started_at
    and created_at <= v_now;

  select count(*)::integer
  into v_fulfillment_stuck
  from payments.star_orders
  where status in ('paid', 'fulfilling')
    and paid_at is not null
    and paid_at < v_now - make_interval(mins => v_fulfillment_stuck_minutes);

  with webhook_window as (
    select
      extract(epoch from (processed_at - created_at)) * 1000 as latency_ms
    from payments.telegram_webhook_events
    where created_at >= v_started_at
      and created_at <= v_now
      and processed_at is not null
      and processed_at >= created_at
  )
  select
    count(*)::integer,
    avg(latency_ms),
    percentile_cont(0.95) within group (order by latency_ms),
    max(latency_ms)
  into v_webhook_processed, v_webhook_average_ms, v_webhook_p95_ms, v_webhook_max_ms
  from webhook_window;

  select
    count(*)::integer,
    count(*) filter (
      where created_at < v_now - make_interval(mins => v_webhook_stuck_minutes)
    )::integer,
    count(*) filter (
      where created_at < v_now - make_interval(mins => v_webhook_critical_stuck_minutes)
    )::integer
  into v_webhook_active, v_webhook_stuck, v_webhook_critical_stuck
  from payments.telegram_webhook_events
  where process_status in ('received', 'processing');

  select
    count(*)::integer,
    count(*) filter (
      where updated_at < v_now - make_interval(mins => v_mint_stuck_minutes)
    )::integer,
    count(*) filter (
      where updated_at < v_now - make_interval(mins => v_mint_critical_stuck_minutes)
    )::integer
  into v_mint_active, v_mint_stuck, v_mint_critical_stuck
  from onchain.mint_queue
  where status in ('queued', 'processing', 'submitted', 'confirming', 'retrying');

  with payment_exceptions as (
    select
      jsonb_build_object(
        'id', id,
        'userId', user_id,
        'status', status,
        'paidAt', paid_at,
        'fulfilledAt', fulfilled_at,
        'errorMessage', error_message,
        'createdAt', created_at,
        'updatedAt', updated_at
      ) as item,
      created_at
    from payments.star_orders
    where (
      status in ('failed', 'expired', 'refunded', 'disputed')
      or error_message is not null
      or (
        status in ('paid', 'fulfilling')
        and paid_at is not null
        and paid_at < v_now - make_interval(mins => v_fulfillment_stuck_minutes)
      )
    )
    order by created_at desc
    limit 8
  )
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_recent_payments
  from payment_exceptions;

  with webhook_exceptions as (
    select
      jsonb_build_object(
        'id', id,
        'updateId', update_id,
        'eventType', event_type,
        'processStatus', process_status,
        'processedAt', processed_at,
        'errorMessage', error_message,
        'createdAt', created_at
      ) as item,
      created_at
    from payments.telegram_webhook_events
    where process_status not in ('processed', 'ignored')
       or error_message is not null
       or processed_at is null
    order by created_at desc
    limit 8
  )
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_recent_webhooks
  from webhook_exceptions;

  with mint_exceptions as (
    select
      jsonb_build_object(
        'id', id,
        'userId', user_id,
        'status', status,
        'attemptCount', attempt_count,
        'maxAttempts', max_attempts,
        'nextAttemptAt', next_attempt_at,
        'completedAt', completed_at,
        'errorMessage', error_message,
        'createdAt', created_at,
        'updatedAt', updated_at
      ) as item,
      updated_at
    from onchain.mint_queue
    where status in ('failed', 'manual_review', 'cancelled')
       or error_message is not null
       or (
        status in ('queued', 'processing', 'submitted', 'confirming', 'retrying')
        and updated_at < v_now - make_interval(mins => v_mint_stuck_minutes)
       )
    order by updated_at desc
    limit 8
  )
  select coalesce(jsonb_agg(item order by updated_at desc), '[]'::jsonb)
  into v_recent_mints
  from mint_exceptions;

  return jsonb_build_object(
    'window', jsonb_build_object(
      'hours', v_window_hours,
      'startedAt', v_started_at,
      'endedAt', v_now
    ),
    'thresholds', jsonb_build_object(
      'paymentFailureWarningRate', v_payment_failure_warning,
      'paymentFailureCriticalRate', v_payment_failure_critical,
      'fulfillmentStuckMinutes', v_fulfillment_stuck_minutes,
      'webhookStuckMinutes', v_webhook_stuck_minutes,
      'webhookCriticalStuckMinutes', v_webhook_critical_stuck_minutes,
      'webhookLatencyWarningMs', v_webhook_stuck_minutes * 60 * 1000,
      'webhookLatencyCriticalMs', v_webhook_critical_stuck_minutes * 60 * 1000,
      'mintStuckMinutes', v_mint_stuck_minutes,
      'mintCriticalStuckMinutes', v_mint_critical_stuck_minutes
    ),
    'metrics', jsonb_build_object(
      'paymentFailureRate', jsonb_build_object(
        'key', 'payment_failure_rate',
        'label', '支付失败率',
        'value', case when v_payment_total > 0 then v_payment_failed::numeric / v_payment_total else 0 end,
        'unit', 'percent',
        'numerator', v_payment_failed,
        'denominator', v_payment_total,
        'status', api._monitoring_rate_status(case when v_payment_total > 0 then v_payment_failed::numeric / v_payment_total else 0 end, v_payment_failure_warning, v_payment_failure_critical),
        'description', '窗口内 failed、expired、refunded、disputed 支付订单占比。'
      ),
      'fulfillmentFailureRate', jsonb_build_object(
        'key', 'fulfillment_failure_rate',
        'label', '发货失败率',
        'value', case when v_paid_total > 0 then v_fulfillment_failed::numeric / v_paid_total else 0 end,
        'unit', 'percent',
        'numerator', v_fulfillment_failed,
        'denominator', v_paid_total,
        'stuckCount', v_fulfillment_stuck,
        'status', case
          when v_fulfillment_stuck > 0 then 'critical'
          else api._monitoring_rate_status(case when v_paid_total > 0 then v_fulfillment_failed::numeric / v_paid_total else 0 end, 0.005, 0.02)
        end,
        'description', '窗口内已支付生命周期订单中失败、争议或有错误且未 fulfilled 的占比。'
      ),
      'webhookLatency', jsonb_build_object(
        'key', 'webhook_latency',
        'label', 'Webhook 延迟',
        'value', round(v_webhook_p95_ms),
        'unit', 'milliseconds',
        'averageMs', round(v_webhook_average_ms),
        'p95Ms', round(v_webhook_p95_ms),
        'maxMs', round(v_webhook_max_ms),
        'processedCount', v_webhook_processed,
        'pendingCount', v_webhook_active,
        'stuckCount', v_webhook_stuck,
        'criticalStuckCount', v_webhook_critical_stuck,
        'status', case
          when v_webhook_critical_stuck > 0 then 'critical'
          when v_webhook_stuck > 0 then 'warning'
          else api._monitoring_latency_status(v_webhook_p95_ms, v_webhook_stuck_minutes * 60 * 1000, v_webhook_critical_stuck_minutes * 60 * 1000)
        end,
        'description', '窗口内 processed_at - created_at 的 p95；未完成事件超过阈值直接 warning/critical。'
      ),
      'mintStuckCount', jsonb_build_object(
        'key', 'mint_stuck_count',
        'label', 'Mint 卡住数量',
        'value', v_mint_stuck,
        'unit', 'count',
        'activeCount', v_mint_active,
        'stuckCount', v_mint_stuck,
        'criticalStuckCount', v_mint_critical_stuck,
        'status', case when v_mint_critical_stuck > 0 then 'critical' when v_mint_stuck > 0 then 'warning' else 'ok' end,
        'description', 'active Mint 状态中 updated_at 超过阈值未推进的数量。'
      )
    ),
    'recentExceptions', jsonb_build_object(
      'paymentOrders', v_recent_payments,
      'webhookEvents', v_recent_webhooks,
      'mintQueue', v_recent_mints
    ),
    'sources', jsonb_build_object(
      'paymentOrderRows', v_payment_total,
      'activePaymentOrderRows', v_fulfillment_stuck,
      'webhookEventRows', v_webhook_processed,
      'activeWebhookEventRows', v_webhook_active,
      'mintQueueRows', v_mint_active,
      'activeMintQueueRows', v_mint_active,
      'limitPerQuery', 1000,
      'thresholds', jsonb_build_object(
        'key', 'monitoring.thresholds',
        'source', case when v_thresholds_updated_at is null then 'defaults' else 'system_settings' end,
        'updatedAt', v_thresholds_updated_at
      )
    ),
    'serverTime', v_now
  );
end;
$$;

create or replace function api.admin_get_business_monitoring(
  p_admin_user_id uuid,
  p_window_hours integer default 24,
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
  v_window_hours integer := coalesce(p_window_hours, 24);
  v_now timestamptz := now();
  v_started_at timestamptz;
  v_created_orders integer := 0;
  v_successful_payments integer := 0;
  v_stars_gmv integer := 0;
  v_webhook_total integer := 0;
  v_webhook_processed integer := 0;
  v_fulfilled_orders integer := 0;
  v_fulfillment_average_seconds numeric;
  v_task_claim_count integer := 0;
  v_task_reward_totals jsonb := '{}'::jsonb;
  v_referral_count integer := 0;
  v_referral_first_open_count integer := 0;
  v_mint_total integer := 0;
  v_mint_minted integer := 0;
  v_new_user_count integer := 0;
  v_active_user_count integer := 0;
  v_total_user_count integer := 0;
  v_api5xx_count integer := 0;
  v_supabase_query_error_count integer := 0;
  v_rate_limit_hit_count integer := 0;
  v_app_event_summary jsonb := '[]'::jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(
    v_admin.id,
    array['admin:read', 'payments:read', 'tasks:read', 'mint:read', 'onchain:read', 'users:read']
  );

  if v_window_hours < 1 or v_window_hours > 168 then
    raise exception 'ADMIN_MONITORING_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  v_started_at := v_now - make_interval(hours => v_window_hours);

  select count(*)::integer
  into v_created_orders
  from payments.star_orders
  where created_at >= v_started_at
    and created_at <= v_now;

  select count(*)::integer, coalesce(sum(xtr_amount), 0)::integer
  into v_successful_payments, v_stars_gmv
  from payments.star_payments
  where paid_at >= v_started_at
    and paid_at <= v_now;

  select count(*)::integer
  into v_webhook_total
  from payments.telegram_webhook_events
  where created_at >= v_started_at
    and created_at <= v_now;

  select count(*)::integer
  into v_webhook_processed
  from payments.telegram_webhook_events
  where created_at >= v_started_at
    and created_at <= v_now
    and process_status = 'processed';

  select
    count(*)::integer,
    avg(extract(epoch from (fulfilled_at - paid_at)))
  into v_fulfilled_orders, v_fulfillment_average_seconds
  from payments.star_orders
  where paid_at >= v_started_at
    and paid_at <= v_now
    and fulfilled_at is not null
    and paid_at is not null
    and fulfilled_at >= paid_at;

  select count(*)::integer
  into v_task_claim_count
  from tasks.task_claims
  where claimed_at >= v_started_at
    and claimed_at <= v_now;

  with rewards as (
    select
      upper(nullif(coalesce(elem ->> 'currencyCode', elem ->> 'currency_code'), '')) as currency_code,
      case
        when coalesce(elem ->> 'amount', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          then (elem ->> 'amount')::numeric
        else 0
      end as amount
    from tasks.task_claims claims
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(claims.reward) = 'array' then claims.reward
        when jsonb_typeof(claims.reward) = 'object' then jsonb_build_array(claims.reward)
        else '[]'::jsonb
      end
    ) elem
    where claims.claimed_at >= v_started_at
      and claims.claimed_at <= v_now
  ),
  reward_totals as (
    select currency_code, sum(amount) as amount
    from rewards
    where currency_code is not null
    group by currency_code
  )
  select coalesce(jsonb_object_agg(currency_code, amount), '{}'::jsonb)
  into v_task_reward_totals
  from reward_totals;

  select count(*)::integer,
         count(*) filter (where first_open_order_id is not null)::integer
  into v_referral_count, v_referral_first_open_count
  from tasks.referrals
  where created_at >= v_started_at
    and created_at <= v_now;

  select count(*)::integer,
         count(*) filter (where status = 'minted')::integer
  into v_mint_total, v_mint_minted
  from onchain.mint_queue
  where (
    created_at >= v_started_at
    or updated_at >= v_started_at
    or completed_at >= v_started_at
  )
    and created_at <= v_now;

  select count(*)::integer
  into v_new_user_count
  from core.users
  where created_at >= v_started_at
    and created_at <= v_now;

  select count(*)::integer
  into v_active_user_count
  from core.users
  where (last_seen_at >= v_started_at or last_auth_at >= v_started_at)
    and (last_seen_at <= v_now or last_auth_at <= v_now);

  select count(*)::integer
  into v_total_user_count
  from core.users;

  select
    count(*) filter (where event_name ilike '%5xx%' or event_name ilike '%internal_server_error%')::integer,
    count(*) filter (where event_name ilike '%supabase%' or event_name ilike '%query_error%')::integer,
    count(*) filter (where event_name ilike '%rate_limit%' or event_name ilike '%rate_limited%')::integer
  into v_api5xx_count, v_supabase_query_error_count, v_rate_limit_hit_count
  from ops.app_events
  where created_at >= v_started_at
    and created_at <= v_now;

  with event_summary as (
    select
      event_name,
      event_source,
      count(*)::integer as count,
      max(created_at) as latest_at
    from ops.app_events
    where created_at >= v_started_at
      and created_at <= v_now
      and (
        event_name ilike '%5xx%'
        or event_name ilike '%internal_server_error%'
        or event_name ilike '%supabase%'
        or event_name ilike '%query_error%'
        or event_name ilike '%rate_limit%'
        or event_name ilike '%rate_limited%'
      )
    group by event_name, event_source
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'eventName', event_name,
        'eventSource', event_source,
        'count', count,
        'latestAt', latest_at
      )
      order by count desc, event_name
    ),
    '[]'::jsonb
  )
  into v_app_event_summary
  from event_summary;

  return jsonb_build_object(
    'serverTime', v_now,
    'window', jsonb_build_object(
      'hours', v_window_hours,
      'startedAt', v_started_at,
      'endedAt', v_now
    ),
    'metrics', jsonb_build_object(
      'starsGmv', jsonb_build_object(
        'key', 'stars_gmv',
        'label', 'Stars GMV',
        'value', v_stars_gmv,
        'unit', 'xtr',
        'paymentCount', v_successful_payments,
        'status', 'ok',
        'truncated', false
      ),
      'newUsers', jsonb_build_object(
        'key', 'new_users',
        'label', '新增用户',
        'value', v_new_user_count,
        'unit', 'count',
        'status', 'ok',
        'description', '观察窗口内首次进入应用的用户数。'
      ),
      'activeUsers', jsonb_build_object(
        'key', 'active_users',
        'label', '活跃用户',
        'value', v_active_user_count,
        'unit', 'count',
        'status', 'ok',
        'description', '观察窗口内 last_seen_at 或 last_auth_at 更新过的用户数。'
      ),
      'totalUsers', jsonb_build_object(
        'key', 'total_users',
        'label', '总用户',
        'value', v_total_user_count,
        'unit', 'count',
        'status', 'ok',
        'description', 'core.users 当前累计用户数。'
      ),
      'paymentSuccessRate', jsonb_build_object(
        'key', 'payment_success_rate',
        'label', '支付成功率',
        'value', case when v_created_orders > 0 then v_successful_payments::numeric / v_created_orders else 0 end,
        'unit', 'percent',
        'numerator', v_successful_payments,
        'denominator', v_created_orders,
        'status', api._monitoring_success_rate_status(case when v_created_orders > 0 then v_successful_payments::numeric / v_created_orders else 1 end, 0.95, 0.90)
      ),
      'webhookSuccessRate', jsonb_build_object(
        'key', 'webhook_success_rate',
        'label', 'Webhook 成功率',
        'value', case when v_webhook_total > 0 then v_webhook_processed::numeric / v_webhook_total else 0 end,
        'unit', 'percent',
        'numerator', v_webhook_processed,
        'denominator', v_webhook_total,
        'status', api._monitoring_success_rate_status(case when v_webhook_total > 0 then v_webhook_processed::numeric / v_webhook_total else 1 end, 0.99, 0.95)
      ),
      'fulfillmentAverageSeconds', jsonb_build_object(
        'key', 'fulfillment_average_seconds',
        'label', '发货平均耗时',
        'value', round(v_fulfillment_average_seconds),
        'unit', 'seconds',
        'fulfilledCount', v_fulfilled_orders,
        'status', api._monitoring_latency_status(v_fulfillment_average_seconds, 600, 1800),
        'truncated', false
      ),
      'taskRewardIssuance', jsonb_build_object(
        'key', 'task_reward_issuance',
        'label', '任务奖励发放量',
        'value', v_task_claim_count,
        'unit', 'count',
        'claimCount', v_task_claim_count,
        'rewardAmounts', v_task_reward_totals,
        'status', 'ok',
        'truncated', false
      ),
      'referralConversionRate', jsonb_build_object(
        'key', 'referral_conversion_rate',
        'label', '邀请转化率',
        'value', case when v_referral_count > 0 then v_referral_first_open_count::numeric / v_referral_count else 0 end,
        'unit', 'percent',
        'numerator', v_referral_first_open_count,
        'denominator', v_referral_count,
        'status', 'ok'
      ),
      'mintQueueSuccessRate', jsonb_build_object(
        'key', 'mint_queue_success_rate',
        'label', 'Mint 队列成功率',
        'value', case when v_mint_total > 0 then v_mint_minted::numeric / v_mint_total else 0 end,
        'unit', 'percent',
        'numerator', v_mint_minted,
        'denominator', v_mint_total,
        'status', api._monitoring_success_rate_status(case when v_mint_total > 0 then v_mint_minted::numeric / v_mint_total else 1 end, 0.95, 0.85)
      ),
      'operationalErrors', jsonb_build_object(
        'key', 'operational_errors',
        'label', 'API / Supabase / Rate Limit 异常',
        'value', v_api5xx_count + v_supabase_query_error_count + v_rate_limit_hit_count,
        'unit', 'count',
        'api5xxCount', v_api5xx_count,
        'supabaseQueryErrorCount', v_supabase_query_error_count,
        'rateLimitHitCount', v_rate_limit_hit_count,
        'total', v_api5xx_count + v_supabase_query_error_count + v_rate_limit_hit_count,
        'status', case
          when v_api5xx_count > 0 or v_supabase_query_error_count > 0 then 'critical'
          when v_rate_limit_hit_count > 0 then 'warning'
          else 'ok'
        end
      )
    ),
    'summaries', jsonb_build_object(
      'appEvents', v_app_event_summary
    ),
    'sources', jsonb_build_object(
      'payments', jsonb_build_object(
        'starPayments', 'payments.star_payments.xtr_amount',
        'starOrders', 'payments.star_orders'
      ),
      'webhooks', 'payments.telegram_webhook_events',
      'tasks', 'tasks.task_claims.reward',
      'referrals', 'tasks.referrals.first_open_order_id',
      'users', jsonb_build_object(
        'table', 'core.users',
        'newUserColumn', 'created_at',
        'activeColumns', jsonb_build_array('last_seen_at', 'last_auth_at')
      ),
      'mintQueue', 'onchain.mint_queue.status',
      'operationalEvents', 'ops.app_events',
      'rowLimit', null,
      'counts', jsonb_build_object(
        'createdOrderCount', v_created_orders,
        'successfulPaymentCount', v_successful_payments,
        'newUserCount', v_new_user_count,
        'activeUserCount', v_active_user_count,
        'totalUserCount', v_total_user_count,
        'webhookTotalCount', v_webhook_total,
        'webhookProcessedCount', v_webhook_processed,
        'fulfilledOrderCount', v_fulfilled_orders,
        'taskClaimCount', v_task_claim_count,
        'referralCount', v_referral_count,
        'referralFirstOpenCount', v_referral_first_open_count,
        'mintQueueTotalCount', v_mint_total,
        'mintQueueMintedCount', v_mint_minted
      ),
      'truncated', jsonb_build_object(
        'starPayments', false,
        'fulfillmentLatency', false,
        'taskClaims', false,
        'appEvents', false
      )
    )
  );
end;
$$;

create or replace function api.admin_get_gacha_monitoring(
  p_admin_user_id uuid,
  p_window_hours integer default 24,
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
  v_window_hours integer := coalesce(p_window_hours, 24);
  v_now timestamptz := now();
  v_started_at timestamptz;
  v_draw_order_count integer := 0;
  v_failed_order_count integer := 0;
  v_anomalous_result_count integer := 0;
  v_draw_result_count integer := 0;
  v_order_statuses jsonb := '[]'::jsonb;
  v_by_box jsonb := '[]'::jsonb;
  v_by_rarity jsonb := '[]'::jsonb;
  v_recent_exceptions jsonb := '[]'::jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['gacha:read', 'admin:read']);

  if v_window_hours < 1 or v_window_hours > 168 then
    raise exception 'ADMIN_MONITORING_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  v_started_at := v_now - make_interval(hours => v_window_hours);

  select count(*)::integer
  into v_draw_order_count
  from gacha.draw_orders
  where created_at >= v_started_at
    and created_at <= v_now;

  select count(*)::integer
  into v_failed_order_count
  from gacha.draw_orders
  where created_at >= v_started_at
    and created_at <= v_now
    and status in ('failed', 'cancelled', 'expired');

  select count(*)::integer
  into v_anomalous_result_count
  from gacha.draw_results
  where created_at >= v_started_at
    and created_at <= v_now
    and (drop_pool_item_id is null or item_instance_id is null);

  select count(*)::integer
  into v_draw_result_count
  from gacha.draw_results
  where created_at >= v_started_at
    and created_at <= v_now;

  with status_counts as (
    select status, count(*)::integer as count
    from gacha.draw_orders
    where created_at >= v_started_at
      and created_at <= v_now
    group by status
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('status', status, 'count', count) order by status),
    '[]'::jsonb
  )
  into v_order_statuses
  from status_counts;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'boxId', box.id,
        'slug', box.slug,
        'displayName', box.display_name,
        'tier', box.tier,
        'status', box.status,
        'drawResultCount', (
          select count(*)::integer
          from gacha.draw_results result
          where result.box_id = box.id
            and result.created_at >= v_started_at
            and result.created_at <= v_now
        ),
        'rarityCounts', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'rarityCode', rarity.code,
              'displayName', rarity.display_name,
              'drawResultCount', rarity_count.draw_result_count
            )
            order by rarity.sort_order
          )
          from catalog.rarities rarity
          join lateral (
            select count(*)::integer as draw_result_count
            from gacha.draw_results result
            where result.box_id = box.id
              and result.rarity_code = rarity.code
              and result.created_at >= v_started_at
              and result.created_at <= v_now
          ) rarity_count on true
          where rarity_count.draw_result_count > 0
        ), '[]'::jsonb),
        'stock', jsonb_build_object(
          'total', box.total_stock,
          'remaining', box.remaining_stock,
          'lifetimeConsumed', case
            when box.total_stock is not null and box.remaining_stock is not null
              then greatest(0, box.total_stock - box.remaining_stock)
            else null
          end
        )
      )
      order by box.sort_order
    ),
    '[]'::jsonb
  )
  into v_by_box
  from gacha.blind_boxes box;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rarityCode', rarity.code,
        'displayName', rarity.display_name,
        'drawResultCount', rarity_count.draw_result_count,
        'ratio', case
          when v_draw_result_count > 0 then rarity_count.draw_result_count::numeric / v_draw_result_count
          else 0
        end
      )
      order by rarity.sort_order
    ),
    '[]'::jsonb
  )
  into v_by_rarity
  from catalog.rarities rarity
  join lateral (
    select count(*)::integer as draw_result_count
    from gacha.draw_results result
    where result.rarity_code = rarity.code
      and result.created_at >= v_started_at
      and result.created_at <= v_now
  ) rarity_count on true;

  with exception_items as (
    select
      jsonb_build_object(
        'kind', 'draw_order',
        'id', id,
        'boxId', box_id,
        'status', status,
        'reason', 'failed_order',
        'createdAt', created_at,
        'updatedAt', updated_at
      ) as item,
      created_at
    from gacha.draw_orders
    where created_at >= v_started_at
      and created_at <= v_now
      and status in ('failed', 'cancelled', 'expired')
    union all
    select
      jsonb_build_object(
        'kind', 'draw_result',
        'id', id,
        'drawOrderId', draw_order_id,
        'boxId', box_id,
        'rarityCode', rarity_code,
        'reason', case
          when drop_pool_item_id is null and item_instance_id is null then 'missing_drop_pool_item_and_item_instance'
          when drop_pool_item_id is null then 'missing_drop_pool_item'
          else 'missing_item_instance'
        end,
        'createdAt', created_at
      ) as item,
      created_at
    from gacha.draw_results
    where created_at >= v_started_at
      and created_at <= v_now
      and (drop_pool_item_id is null or item_instance_id is null)
  ),
  recent_exception_items as (
    select item, created_at
    from exception_items
    order by created_at desc
    limit 20
  )
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_recent_exceptions
  from recent_exception_items;

  return jsonb_build_object(
    'serverTime', v_now,
    'window', jsonb_build_object(
      'hours', v_window_hours,
      'startedAt', v_started_at,
      'endedAt', v_now
    ),
    'metrics', jsonb_build_object(
      'drawOrders', jsonb_build_object(
        'key', 'gacha_draw_order_count',
        'label', '开盒订单数',
        'value', v_draw_order_count,
        'unit', 'count',
        'status', 'ok',
        'description', '窗口内 gacha.draw_orders 数量。'
      ),
      'drawFailures', jsonb_build_object(
        'key', 'gacha_draw_failure_count',
        'label', '抽卡失败数',
        'value', v_failed_order_count + v_anomalous_result_count,
        'unit', 'count',
        'failedOrderCount', v_failed_order_count,
        'anomalousResultCount', v_anomalous_result_count,
        'status', case
          when v_failed_order_count + v_anomalous_result_count >= 5 then 'critical'
          when v_failed_order_count + v_anomalous_result_count > 0 then 'warning'
          else 'ok'
        end,
        'description', '窗口内 failed/cancelled/expired draw_orders 与异常 draw_results 数量。'
      ),
      'drawResults', jsonb_build_object(
        'key', 'gacha_draw_result_count',
        'label', '抽卡结果数',
        'value', v_draw_result_count,
        'unit', 'count',
        'status', 'ok',
        'description', '窗口内 gacha.draw_results 数量，按盲盒维度汇总。'
      )
    ),
    'orderStatuses', v_order_statuses,
    'byBox', v_by_box,
    'byRarity', v_by_rarity,
    'recentExceptions', v_recent_exceptions,
    'sources', jsonb_build_object(
      'drawOrders', jsonb_build_object(
        'schema', 'gacha',
        'table', 'draw_orders',
        'filters', jsonb_build_array('created_at >= ' || v_started_at::text),
        'countStrategy', 'aggregate_count',
        'statusValues', jsonb_build_array('created', 'invoice_created', 'paid', 'opening', 'opened', 'completed', 'cancelled', 'failed', 'expired')
      ),
      'drawResults', jsonb_build_object(
        'schema', 'gacha',
        'table', 'draw_results',
        'filters', jsonb_build_array('created_at >= ' || v_started_at::text),
        'anomalyFilter', 'drop_pool_item_id is null or item_instance_id is null',
        'dimensions', jsonb_build_array('box_id', 'rarity_code'),
        'countStrategy', 'aggregate_count'
      ),
      'blindBoxes', jsonb_build_object(
        'schema', 'gacha',
        'table', 'blind_boxes',
        'limit', 100
      ),
      'rarities', jsonb_build_object(
        'schema', 'catalog',
        'table', 'rarities',
        'limit', 100
      )
    )
  );
end;
$$;

create or replace function api.admin_get_market_monitoring(
  p_admin_user_id uuid,
  p_window_hours integer default 24,
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
  v_window_hours integer := coalesce(p_window_hours, 24);
  v_now timestamptz := now();
  v_started_at timestamptz;
  v_trades jsonb;
  v_listings jsonb;
  v_price_health jsonb;
  v_order_count integer := 0;
  v_listing_count integer := 0;
  v_snapshot_count integer := 0;
  v_rule_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:read', 'admin:read']);

  if v_window_hours < 1 or v_window_hours > 168 then
    raise exception 'ADMIN_MONITORING_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  v_started_at := v_now - make_interval(hours => v_window_hours);

  with orders_window as (
    select *
    from market.orders
    where created_at >= v_started_at
      and created_at <= v_now
  ),
  status_breakdown as (
    select
      lower(coalesce(nullif(status, ''), 'unknown')) as status,
      count(*)::integer as order_count,
      coalesce(sum(total_price_kcoin) filter (where status = 'completed'), 0) as total_volume_kcoin
    from orders_window
    group by lower(coalesce(nullif(status, ''), 'unknown'))
  ),
  trade_rollup as (
    select
      count(*)::integer as order_count,
      count(*) filter (where status = 'completed')::integer as completed_order_count,
      coalesce(sum(total_price_kcoin) filter (where status = 'completed'), 0) as total_volume_kcoin,
      coalesce(sum(fee_amount_kcoin) filter (where status = 'completed'), 0) as total_fee_kcoin,
      coalesce(sum(seller_net_amount_kcoin) filter (where status = 'completed'), 0) as seller_net_kcoin,
      coalesce(sum(item_count) filter (where status = 'completed'), 0)::integer as item_count,
      max(coalesce(completed_at, created_at)) filter (where status = 'completed') as last_completed_at,
      bool_or(status <> 'completed') as has_non_completed
    from orders_window
  )
  select
    trade_rollup.order_count,
    jsonb_build_object(
      'orderCount', trade_rollup.order_count,
      'sampledOrderCount', trade_rollup.order_count,
      'completedOrderCount', trade_rollup.completed_order_count,
      'totalVolumeKcoin', trade_rollup.total_volume_kcoin,
      'totalFeeKcoin', trade_rollup.total_fee_kcoin,
      'sellerNetKcoin', trade_rollup.seller_net_kcoin,
      'itemCount', trade_rollup.item_count,
      'averageOrderValueKcoin', case
        when trade_rollup.completed_order_count > 0 then trade_rollup.total_volume_kcoin / trade_rollup.completed_order_count
        else 0
      end,
      'lastCompletedAt', trade_rollup.last_completed_at,
      'statusBreakdown', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'status', status,
            'orderCount', order_count,
            'totalVolumeKcoin', total_volume_kcoin
          )
          order by status
        )
        from status_breakdown
      ), '[]'::jsonb),
      'status', case when coalesce(trade_rollup.has_non_completed, false) then 'warning' else 'ok' end,
      'truncated', false
    )
  into v_order_count, v_trades
  from trade_rollup;

  with active_listings as (
    select *
    from market.listings
    where status = 'active'
  ),
  health_breakdown as (
    select
      lower(coalesce(nullif(price_health, ''), 'unknown')) as price_health,
      count(*)::integer as listing_count,
      coalesce(sum(remaining_count), 0)::integer as item_count
    from active_listings
    group by lower(coalesce(nullif(price_health, ''), 'unknown'))
  ),
  listing_rollup as (
    select
      count(*)::integer as active_listing_count,
      coalesce(sum(remaining_count), 0)::integer as active_item_count,
      min(unit_price_kcoin) as floor_price_kcoin,
      max(unit_price_kcoin) as highest_price_kcoin,
      avg(unit_price_kcoin) as average_unit_price_kcoin
    from active_listings
  )
  select
    listing_rollup.active_listing_count,
    jsonb_build_object(
      'activeListingCount', listing_rollup.active_listing_count,
      'sampledListingCount', listing_rollup.active_listing_count,
      'activeItemCount', listing_rollup.active_item_count,
      'floorPriceKcoin', listing_rollup.floor_price_kcoin,
      'highestPriceKcoin', listing_rollup.highest_price_kcoin,
      'averageUnitPriceKcoin', listing_rollup.average_unit_price_kcoin,
      'priceHealthBreakdown', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'priceHealth', price_health,
            'listingCount', listing_count,
            'itemCount', item_count
          )
          order by price_health
        )
        from health_breakdown
      ), '[]'::jsonb),
      'status', 'ok',
      'truncated', false
    )
  into v_listing_count, v_listings
  from listing_rollup;

  select count(*)::integer
  into v_snapshot_count
  from market.price_snapshots
  where snapshot_at >= v_started_at
    and snapshot_at <= v_now;

  select count(*)::integer
  into v_rule_count
  from market.price_health_rules
  where active = true;

  with active_listings as (
    select lower(coalesce(nullif(price_health, ''), 'unknown')) as price_health
    from market.listings
    where status = 'active'
  ),
  unhealthy as (
    select count(*)::integer as count
    from active_listings
    where price_health not in ('healthy', 'unknown')
  ),
  recent_snapshots as (
    select *
    from market.price_snapshots
    where snapshot_at >= v_started_at
      and snapshot_at <= v_now
    order by snapshot_at desc
    limit 10
  )
  select jsonb_build_object(
    'status', case
      when unhealthy.count >= 5 then 'critical'
      when unhealthy.count > 0 then 'warning'
      else 'ok'
    end,
    'activeRuleCount', v_rule_count,
    'sampledRuleCount', v_rule_count,
    'priceSnapshotCount', v_snapshot_count,
    'sampledPriceSnapshotCount', v_snapshot_count,
    'latestSnapshotAt', (
      select max(snapshot_at)
      from market.price_snapshots
      where snapshot_at >= v_started_at
        and snapshot_at <= v_now
    ),
    'unhealthyListingCount', unhealthy.count,
    'healthBreakdown', coalesce((v_listings -> 'priceHealthBreakdown'), '[]'::jsonb),
    'recentSnapshots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'templateId', template_id,
          'formId', form_id,
          'rarityCode', rarity_code,
          'floorPriceKcoin', floor_price_kcoin,
          'averagePriceKcoin', avg_price_kcoin,
          'lastSalePriceKcoin', last_sale_price_kcoin,
          'activeListingCount', active_listing_count,
          'saleCount24h', sale_count_24h,
          'volume24hKcoin', volume_24h_kcoin,
          'snapshotAt', snapshot_at
        )
        order by snapshot_at desc
      )
      from recent_snapshots
    ), '[]'::jsonb),
    'truncated', false
  )
  into v_price_health
  from unhealthy;

  return jsonb_build_object(
    'serverTime', v_now,
    'window', jsonb_build_object(
      'hours', v_window_hours,
      'startedAt', v_started_at,
      'endedAt', v_now
    ),
    'metrics', jsonb_build_object(
      'trades', v_trades,
      'listings', v_listings,
      'priceHealth', v_price_health
    ),
    'market', jsonb_build_object(
      'trades', v_trades,
      'listings', v_listings,
      'priceHealth', v_price_health
    ),
    'sources', jsonb_build_object(
      'marketOrders', jsonb_build_object(
        'schema', 'market',
        'table', 'orders',
        'filters', jsonb_build_object('createdAtGte', v_started_at, 'createdAtLte', v_now),
        'windowColumn', 'created_at',
        'sampledRows', v_order_count,
        'totalRows', v_order_count,
        'limit', null,
        'truncated', false,
        'aggregation', 'status + completed totals'
      ),
      'marketListings', jsonb_build_object(
        'schema', 'market',
        'table', 'listings',
        'filters', jsonb_build_object('status', 'active'),
        'sampledRows', v_listing_count,
        'totalRows', v_listing_count,
        'limit', null,
        'truncated', false,
        'aggregation', 'active listings + price health'
      ),
      'marketPriceSnapshots', jsonb_build_object(
        'schema', 'market',
        'table', 'price_snapshots',
        'filters', jsonb_build_object('snapshotAtGte', v_started_at, 'snapshotAtLte', v_now),
        'windowColumn', 'snapshot_at',
        'sampledRows', v_snapshot_count,
        'totalRows', v_snapshot_count,
        'limit', 10,
        'truncated', false
      ),
      'marketPriceHealthRules', jsonb_build_object(
        'schema', 'market',
        'table', 'price_health_rules',
        'filters', jsonb_build_object('active', true),
        'sampledRows', v_rule_count,
        'totalRows', v_rule_count,
        'limit', null,
        'truncated', false
      )
    )
  );
end;
$$;

revoke all on function api._monitoring_rate_status(numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function api._monitoring_success_rate_status(numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function api._monitoring_latency_status(numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function api.get_payment_support_config() from public, anon, authenticated;
revoke all on function api.admin_get_monitoring_thresholds(uuid, jsonb) from public, anon, authenticated;
revoke all on function api.admin_get_operational_monitoring(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_get_business_monitoring(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_get_gacha_monitoring(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_get_market_monitoring(uuid, integer, jsonb) from public, anon, authenticated;

grant execute on function api.get_payment_support_config() to service_role;
grant execute on function api.admin_get_monitoring_thresholds(uuid, jsonb) to service_role;
grant execute on function api.admin_get_operational_monitoring(uuid, integer, jsonb) to service_role;
grant execute on function api.admin_get_business_monitoring(uuid, integer, jsonb) to service_role;
grant execute on function api.admin_get_gacha_monitoring(uuid, integer, jsonb) to service_role;
grant execute on function api.admin_get_market_monitoring(uuid, integer, jsonb) to service_role;

comment on function api.admin_get_operational_monitoring(uuid, integer, jsonb) is
  'Aggregated phase 5 payment/webhook/mint monitoring facade for admin API.';
comment on function api.admin_get_business_monitoring(uuid, integer, jsonb) is
  'Aggregated business monitoring facade for admin API.';
comment on function api.admin_get_gacha_monitoring(uuid, integer, jsonb) is
  'Aggregated gacha monitoring facade for admin API.';
comment on function api.admin_get_market_monitoring(uuid, integer, jsonb) is
  'Aggregated market monitoring facade for admin API.';

commit;
