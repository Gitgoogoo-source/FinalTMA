-- Phase 5 step 16 reconciliation run types.
-- Keep existing run_type values for backwards compatibility and add the
-- payment/wallet/Mint reconciliation buckets used by the backend job.

alter table economy.reconciliation_runs
  drop constraint if exists reconciliation_runs_run_type_check;

alter table economy.reconciliation_runs
  add constraint reconciliation_runs_run_type_check
  check (
    run_type = any (
      array[
        'ledger_balance'::text,
        'market_settlement'::text,
        'payment'::text,
        'inventory'::text,
        'payment_fulfillment'::text,
        'mint_queue'::text,
        'wallet_sync'::text
      ]
    )
  );

comment on constraint reconciliation_runs_run_type_check
  on economy.reconciliation_runs
  is 'Allowed operational reconciliation buckets, including Phase 5 payment fulfillment, Mint queue and wallet sync checks.';
