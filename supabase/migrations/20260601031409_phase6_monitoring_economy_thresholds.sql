-- Phase 6 step 2.8 economy monitoring and monitored threshold settings.
--
-- This migration only adds configuration/RPC/index support. It does not mutate
-- existing economy.currency_ledger history.

begin;

create index if not exists currency_ledger_currency_created_entry_idx
  on economy.currency_ledger (currency_code, created_at desc, entry_type);

create or replace function api._monitoring_default_thresholds()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'paymentFailureRate', jsonb_build_object(
      'warning', 0.05,
      'critical', 0.10
    ),
    'paidNotFulfilledMinutes', jsonb_build_object(
      'critical', 10
    ),
    'webhookStuckMinutes', jsonb_build_object(
      'warning', 5,
      'critical', 10
    ),
    'mintStuckMinutes', jsonb_build_object(
      'warning', 30,
      'critical', 60
    ),
    'ledgerMismatchCount', jsonb_build_object(
      'critical', 0
    ),
    'negativeInventoryCount', jsonb_build_object(
      'critical', 0
    ),
    'kcoinNetIssuance', jsonb_build_object(
      'warningAmount', 1000000,
      'windowHours', 24
    )
  );
$$;

create or replace function api._monitoring_normalize_thresholds(
  p_thresholds jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_input jsonb := coalesce(p_thresholds, '{}'::jsonb);
  v_default jsonb := api._monitoring_default_thresholds();
  v_payment_warning numeric;
  v_payment_critical numeric;
  v_paid_not_fulfilled_critical numeric;
  v_webhook_warning numeric;
  v_webhook_critical numeric;
  v_mint_warning numeric;
  v_mint_critical numeric;
  v_ledger_mismatch_critical numeric;
  v_negative_inventory_critical numeric;
  v_kcoin_warning_amount numeric;
  v_kcoin_window_hours numeric;
begin
  if jsonb_typeof(v_input) <> 'object' then
    raise exception 'ADMIN_MONITORING_THRESHOLDS_INVALID' using errcode = 'P0001';
  end if;

  v_payment_warning := coalesce(
    nullif(v_input #>> '{paymentFailureRate,warning}', '')::numeric,
    (v_default #>> '{paymentFailureRate,warning}')::numeric
  );
  v_payment_critical := coalesce(
    nullif(v_input #>> '{paymentFailureRate,critical}', '')::numeric,
    (v_default #>> '{paymentFailureRate,critical}')::numeric
  );
  v_paid_not_fulfilled_critical := coalesce(
    nullif(v_input #>> '{paidNotFulfilledMinutes,critical}', '')::numeric,
    (v_default #>> '{paidNotFulfilledMinutes,critical}')::numeric
  );
  v_webhook_warning := coalesce(
    nullif(v_input #>> '{webhookStuckMinutes,warning}', '')::numeric,
    (v_default #>> '{webhookStuckMinutes,warning}')::numeric
  );
  v_webhook_critical := coalesce(
    nullif(v_input #>> '{webhookStuckMinutes,critical}', '')::numeric,
    (v_default #>> '{webhookStuckMinutes,critical}')::numeric
  );
  v_mint_warning := coalesce(
    nullif(v_input #>> '{mintStuckMinutes,warning}', '')::numeric,
    (v_default #>> '{mintStuckMinutes,warning}')::numeric
  );
  v_mint_critical := coalesce(
    nullif(v_input #>> '{mintStuckMinutes,critical}', '')::numeric,
    (v_default #>> '{mintStuckMinutes,critical}')::numeric
  );
  v_ledger_mismatch_critical := coalesce(
    nullif(v_input #>> '{ledgerMismatchCount,critical}', '')::numeric,
    (v_default #>> '{ledgerMismatchCount,critical}')::numeric
  );
  v_negative_inventory_critical := coalesce(
    nullif(v_input #>> '{negativeInventoryCount,critical}', '')::numeric,
    (v_default #>> '{negativeInventoryCount,critical}')::numeric
  );
  v_kcoin_warning_amount := coalesce(
    nullif(v_input #>> '{kcoinNetIssuance,warningAmount}', '')::numeric,
    (v_default #>> '{kcoinNetIssuance,warningAmount}')::numeric
  );
  v_kcoin_window_hours := coalesce(
    nullif(v_input #>> '{kcoinNetIssuance,windowHours}', '')::numeric,
    (v_default #>> '{kcoinNetIssuance,windowHours}')::numeric
  );

  if v_payment_warning < 0
     or v_payment_warning > 1
     or v_payment_critical < 0
     or v_payment_critical > 1
     or v_payment_critical < v_payment_warning then
    raise exception 'ADMIN_MONITORING_THRESHOLDS_INVALID_PAYMENT_FAILURE_RATE' using errcode = 'P0001';
  end if;

  if v_paid_not_fulfilled_critical < 1
     or v_paid_not_fulfilled_critical > 1440 then
    raise exception 'ADMIN_MONITORING_THRESHOLDS_INVALID_FULFILLMENT_MINUTES' using errcode = 'P0001';
  end if;

  if v_webhook_warning < 1
     or v_webhook_warning > 1440
     or v_webhook_critical < v_webhook_warning
     or v_webhook_critical > 1440 then
    raise exception 'ADMIN_MONITORING_THRESHOLDS_INVALID_WEBHOOK_MINUTES' using errcode = 'P0001';
  end if;

  if v_mint_warning < 1
     or v_mint_warning > 1440
     or v_mint_critical < v_mint_warning
     or v_mint_critical > 1440 then
    raise exception 'ADMIN_MONITORING_THRESHOLDS_INVALID_MINT_MINUTES' using errcode = 'P0001';
  end if;

  if v_ledger_mismatch_critical < 0
     or v_ledger_mismatch_critical <> trunc(v_ledger_mismatch_critical)
     or v_negative_inventory_critical < 0
     or v_negative_inventory_critical <> trunc(v_negative_inventory_critical) then
    raise exception 'ADMIN_MONITORING_THRESHOLDS_INVALID_COUNT' using errcode = 'P0001';
  end if;

  if v_kcoin_warning_amount < 0
     or v_kcoin_warning_amount > 1000000000000
     or v_kcoin_window_hours < 1
     or v_kcoin_window_hours > 168
     or v_kcoin_window_hours <> trunc(v_kcoin_window_hours) then
    raise exception 'ADMIN_MONITORING_THRESHOLDS_INVALID_KCOIN' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'version', 1,
    'paymentFailureRate', jsonb_build_object(
      'warning', v_payment_warning,
      'critical', v_payment_critical
    ),
    'paidNotFulfilledMinutes', jsonb_build_object(
      'critical', v_paid_not_fulfilled_critical
    ),
    'webhookStuckMinutes', jsonb_build_object(
      'warning', v_webhook_warning,
      'critical', v_webhook_critical
    ),
    'mintStuckMinutes', jsonb_build_object(
      'warning', v_mint_warning,
      'critical', v_mint_critical
    ),
    'ledgerMismatchCount', jsonb_build_object(
      'critical', v_ledger_mismatch_critical::integer
    ),
    'negativeInventoryCount', jsonb_build_object(
      'critical', v_negative_inventory_critical::integer
    ),
    'kcoinNetIssuance', jsonb_build_object(
      'warningAmount', v_kcoin_warning_amount,
      'windowHours', v_kcoin_window_hours::integer
    )
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'ADMIN_MONITORING_THRESHOLDS_INVALID' using errcode = 'P0001';
end;
$$;

insert into ops.system_settings as s (
  key,
  value,
  description,
  updated_by_admin_id,
  updated_at
)
values (
  'monitoring.thresholds',
  api._monitoring_default_thresholds(),
  'Business monitoring thresholds. Secrets must stay in server environment variables.',
  null,
  now()
)
on conflict (key) do nothing;

create or replace function api.admin_get_economy_monitoring(
  p_admin_user_id uuid,
  p_window_hours integer default 24,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_window_hours integer := coalesce(p_window_hours, 24);
  v_now timestamptz := now();
  v_window_started_at timestamptz;
  v_thresholds jsonb;
  v_thresholds_updated_at timestamptz;
  v_currency_metrics jsonb;
  v_kcoin_net numeric := 0;
  v_kcoin_warning_amount numeric;
  v_ledger_run economy.reconciliation_runs%rowtype;
  v_ledger_finding_count integer;
  v_ledger_status text;
  v_negative_inventory_count integer;
  v_negative_inventory_status text;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['admin:read', 'ops:read']);

  if v_window_hours < 1 or v_window_hours > 168 then
    raise exception 'ADMIN_MONITORING_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  v_window_started_at := v_now - make_interval(hours => v_window_hours);

  select api._monitoring_normalize_thresholds(value), updated_at
  into v_thresholds, v_thresholds_updated_at
  from ops.system_settings
  where key = 'monitoring.thresholds';

  if v_thresholds is null then
    v_thresholds := api._monitoring_default_thresholds();
  end if;

  v_kcoin_warning_amount := (v_thresholds #>> '{kcoinNetIssuance,warningAmount}')::numeric;

  with currencies(currency_code) as (
    values ('KCOIN'::text), ('FGEMS'::text)
  ),
  ledger_by_entry_type as (
    select
      ledger.currency_code,
      ledger.entry_type,
      case
        when ledger.entry_type in ('credit', 'refund', 'adjustment') then 'issued'
        when ledger.entry_type in ('debit', 'fee', 'reversal') then 'recovered'
        else 'neutral'
      end as direction,
      count(*)::integer as entry_count,
      coalesce(sum(ledger.amount), 0) as amount
    from economy.currency_ledger ledger
    where ledger.currency_code in ('KCOIN', 'FGEMS')
      and ledger.created_at >= v_window_started_at
      and ledger.created_at <= v_now
    group by ledger.currency_code, ledger.entry_type
  ),
  currency_rollup as (
    select
      currencies.currency_code,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'entryType', ledger_by_entry_type.entry_type,
            'direction', ledger_by_entry_type.direction,
            'entryCount', ledger_by_entry_type.entry_count,
            'amount', ledger_by_entry_type.amount::text
          )
          order by ledger_by_entry_type.entry_type
        ) filter (where ledger_by_entry_type.entry_type is not null),
        '[]'::jsonb
      ) as by_entry_type,
      coalesce(sum(ledger_by_entry_type.amount) filter (where ledger_by_entry_type.direction = 'issued'), 0) as issued_amount,
      coalesce(sum(ledger_by_entry_type.amount) filter (where ledger_by_entry_type.direction = 'recovered'), 0) as recovered_amount,
      coalesce(sum(ledger_by_entry_type.entry_count), 0)::integer as entry_count
    from currencies
    left join ledger_by_entry_type on ledger_by_entry_type.currency_code = currencies.currency_code
    group by currencies.currency_code
  )
  select jsonb_object_agg(
    currency_code,
    jsonb_build_object(
      'currencyCode', currency_code,
      'issuedAmount', issued_amount::text,
      'recoveredAmount', recovered_amount::text,
      'netIssuedAmount', (issued_amount - recovered_amount)::text,
      'entryCount', entry_count,
      'byEntryType', by_entry_type
    )
    order by currency_code
  )
  into v_currency_metrics
  from currency_rollup;

  v_kcoin_net := coalesce((v_currency_metrics #>> '{KCOIN,netIssuedAmount}')::numeric, 0);

  select *
  into v_ledger_run
  from economy.reconciliation_runs
  where run_type = 'ledger_balance'
  order by started_at desc, id desc
  limit 1;

  if found then
    v_ledger_finding_count := coalesce(nullif(v_ledger_run.result ->> 'finding_count', '')::integer, 0);
    v_ledger_status := case
      when v_ledger_finding_count > ((v_thresholds #>> '{ledgerMismatchCount,critical}')::integer) then 'critical'
      else 'ok'
    end;
  else
    v_ledger_finding_count := null;
    v_ledger_status := 'unknown';
  end if;

  select count(*)::integer
  into v_negative_inventory_count
  from gacha.blind_boxes
  where (remaining_stock is not null and remaining_stock < 0)
     or (total_stock is not null and total_stock < 0);

  v_negative_inventory_status := case
    when v_negative_inventory_count > ((v_thresholds #>> '{negativeInventoryCount,critical}')::integer) then 'critical'
    else 'ok'
  end;

  return jsonb_build_object(
    'serverTime', v_now,
    'window', jsonb_build_object(
      'hours', v_window_hours,
      'startedAt', v_window_started_at,
      'endedAt', v_now
    ),
    'thresholds', v_thresholds,
    'metrics', jsonb_build_object(
      'currencies', v_currency_metrics,
      'kcoinNetIssuance', jsonb_build_object(
        'key', 'kcoin_net_issuance',
        'currencyCode', 'KCOIN',
        'value', v_kcoin_net::text,
        'unit', 'amount',
        'threshold', v_kcoin_warning_amount::text,
        'status', case when v_kcoin_net > v_kcoin_warning_amount then 'warning' else 'ok' end,
        'description', 'KCOIN issued minus recovered amount in the selected ledger window.'
      ),
      'ledgerMismatch', jsonb_build_object(
        'key', 'ledger_mismatch_count',
        'value', v_ledger_finding_count,
        'unit', 'count',
        'status', v_ledger_status,
        'latestRun', case
          when v_ledger_run.id is null then null::jsonb
          else jsonb_build_object(
            'id', v_ledger_run.id,
            'status', v_ledger_run.status,
            'startedAt', v_ledger_run.started_at,
            'finishedAt', v_ledger_run.finished_at,
            'findingCount', v_ledger_finding_count
          )
        end,
        'description', 'Latest ledger_balance reconciliation finding count. Missing run is reported as unknown.'
      ),
      'negativeInventory', jsonb_build_object(
        'key', 'negative_inventory_count',
        'value', v_negative_inventory_count,
        'unit', 'count',
        'status', v_negative_inventory_status,
        'description', 'Blind box stock rows with negative total_stock or remaining_stock.'
      )
    ),
    'sources', jsonb_build_object(
      'ledger', jsonb_build_object(
        'schema', 'economy',
        'table', 'currency_ledger',
        'windowColumn', 'created_at',
        'currencies', jsonb_build_array('KCOIN', 'FGEMS'),
        'aggregation', 'currency_code + entry_type'
      ),
      'ledgerMismatch', jsonb_build_object(
        'schema', 'economy',
        'table', 'reconciliation_runs',
        'runType', 'ledger_balance',
        'limit', 1
      ),
      'negativeInventory', jsonb_build_object(
        'schema', 'gacha',
        'table', 'blind_boxes',
        'aggregation', 'count'
      ),
      'thresholds', jsonb_build_object(
        'schema', 'ops',
        'table', 'system_settings',
        'key', 'monitoring.thresholds',
        'updatedAt', v_thresholds_updated_at
      )
    )
  );
end;
$$;

create or replace function api.admin_update_monitoring_thresholds(
  p_admin_user_id uuid,
  p_thresholds jsonb,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_before_row ops.system_settings%rowtype;
  v_after_row ops.system_settings%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_thresholds jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.monitoring_thresholds';
  v_request_hash text;
  v_idempotent jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['admin:write', 'ops:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  v_thresholds := api._monitoring_normalize_thresholds(p_thresholds);

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'thresholds', v_thresholds,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(
    v_key,
    v_scope,
    v_request_hash,
    v_now
  );
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_before_row
  from ops.system_settings
  where key = 'monitoring.thresholds'
  for update;

  if found then
    v_before := to_jsonb(v_before_row);
  end if;

  insert into ops.system_settings (
    key,
    value,
    description,
    updated_by_admin_id,
    updated_at
  )
  values (
    'monitoring.thresholds',
    v_thresholds,
    'Business monitoring thresholds. Secrets must stay in server environment variables.',
    p_admin_user_id,
    v_now
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_by_admin_id = excluded.updated_by_admin_id,
      updated_at = excluded.updated_at
  returning * into v_after_row;

  v_after := to_jsonb(v_after_row);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'monitoring.thresholds.update',
    'ops',
    'system_settings',
    null,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    p_request_context ->> 'user_agent_hash',
    v_reason
  );

  v_response := jsonb_build_object(
    'key', 'monitoring.thresholds',
    'thresholds', v_thresholds,
    'updated_at', v_after_row.updated_at,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$$;

revoke all on function api._monitoring_default_thresholds() from public, anon, authenticated;
revoke all on function api._monitoring_normalize_thresholds(jsonb) from public, anon, authenticated;
revoke all on function api.admin_get_economy_monitoring(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_update_monitoring_thresholds(uuid, jsonb, text, text, jsonb) from public, anon, authenticated;

grant execute on function api.admin_get_economy_monitoring(uuid, integer, jsonb) to service_role;
grant execute on function api.admin_update_monitoring_thresholds(uuid, jsonb, text, text, jsonb) to service_role;

commit;
