create table economy.balances (
  user_id uuid not null references identity.users(id) on delete cascade,
  currency text not null check (currency in ('KCOIN', 'FGEMS')),
  available bigint not null default 0 check (available >= 0),
  locked bigint not null default 0 check (locked >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, currency)
);

create table economy.ledger (
  id bigint generated always as identity primary key,
  operation_id uuid references operations.operations(id),
  user_id uuid not null references identity.users(id) on delete cascade,
  currency text not null check (currency in ('KCOIN', 'FGEMS')),
  amount bigint not null check (amount <> 0),
  reason text not null,
  reference text,
  balance_after bigint not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index ledger_user_created_idx on economy.ledger (user_id, created_at desc);
create index ledger_operation_idx on economy.ledger (operation_id) where operation_id is not null;
create unique index ledger_stars_topup_reference_unique_idx on economy.ledger (reference) where reason = 'stars_topup';
create unique index ledger_battle_reference_unique_idx on economy.ledger (reason, reference)
where reason in ('battle_stake_lock', 'battle_stake_refund', 'battle_win_payout');
create unique index ledger_battle_fixture_reference_unique_idx on economy.ledger (reference)
where reason = 'battle_acceptance_fixture';

create table economy.entitlements (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  kind text not null check (kind in ('free_normal_box', 'free_rare_box')),
  source text not null,
  status text not null default 'unused' check (status in ('unused', 'used', 'void')),
  operation_id uuid references operations.operations(id),
  obtained_at timestamptz not null default now(),
  used_at timestamptz
);

create index entitlements_fifo_idx on economy.entitlements (user_id, kind, obtained_at, id) where status = 'unused';

create or replace function economy.assets(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'kcoin', jsonb_build_object(
      'currency', 'KCOIN',
      'available', coalesce(max(available) filter (where currency = 'KCOIN'), 0),
      'locked', coalesce(max(locked) filter (where currency = 'KCOIN'), 0)
    ),
    'fgems', jsonb_build_object(
      'currency', 'FGEMS',
      'available', coalesce(max(available) filter (where currency = 'FGEMS'), 0),
      'locked', coalesce(max(locked) filter (where currency = 'FGEMS'), 0)
    )
  )
  from economy.balances where user_id = p_user_id
$$;

create or replace function economy.change_balance(
  p_user_id uuid,
  p_currency text,
  p_amount bigint,
  p_reason text,
  p_operation_id uuid,
  p_reference text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  insert into economy.balances (user_id, currency) values (p_user_id, p_currency)
  on conflict (user_id, currency) do nothing;
  select available into v_balance
  from economy.balances
  where user_id = p_user_id and currency = p_currency
  for update;
  if v_balance + p_amount < 0 then
    perform api.raise_business_error('INSUFFICIENT_BALANCE', '余额不足');
  end if;
  v_balance := v_balance + p_amount;
  update economy.balances set available = v_balance, updated_at = now()
  where user_id = p_user_id and currency = p_currency;
  if p_amount <> 0 then
    insert into economy.ledger (operation_id, user_id, currency, amount, reason, reference, balance_after)
    values (p_operation_id, p_user_id, p_currency, p_amount, p_reason, p_reference, v_balance);
  end if;
  return v_balance;
end;
$$;

create or replace function economy.lock_kcoin(
  p_user_id uuid,
  p_amount bigint,
  p_operation_id uuid,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance economy.balances%rowtype;
  v_ledger_id bigint;
begin
  if p_amount <= 0 or p_reference is null then
    perform api.raise_business_error('BATTLE_TIER_INVALID', 'Battle 入场档位无效');
  end if;
  insert into economy.balances (user_id, currency) values (p_user_id, 'KCOIN')
  on conflict (user_id, currency) do nothing;
  select * into v_balance
  from economy.balances
  where user_id = p_user_id and currency = 'KCOIN'
  for update;
  if v_balance.available < p_amount then
    perform api.raise_business_error('INSUFFICIENT_BALANCE', '余额不足');
  end if;
  update economy.balances
  set available = available - p_amount, locked = locked + p_amount, updated_at = now()
  where user_id = p_user_id and currency = 'KCOIN'
  returning * into v_balance;
  insert into economy.ledger (
    operation_id, user_id, currency, amount, reason, reference, balance_after
  ) values (
    p_operation_id, p_user_id, 'KCOIN', -p_amount, 'battle_stake_lock',
    p_reference, v_balance.available
  ) returning id into v_ledger_id;
  return jsonb_build_object(
    'available', v_balance.available,
    'locked', v_balance.locked,
    'ledger_id', v_ledger_id
  );
end;
$$;

create or replace function economy.refund_battle_kcoin(
  p_user_id uuid,
  p_amount bigint,
  p_operation_id uuid,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance economy.balances%rowtype;
  v_ledger_id bigint;
begin
  select * into v_balance
  from economy.balances
  where user_id = p_user_id and currency = 'KCOIN'
  for update;
  if v_balance.user_id is null or p_amount <= 0 or v_balance.locked < p_amount then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object('kind', 'locked_refund', 'user_id', p_user_id, 'amount', p_amount)::text;
  end if;
  update economy.balances
  set available = available + p_amount, locked = locked - p_amount, updated_at = now()
  where user_id = p_user_id and currency = 'KCOIN'
  returning * into v_balance;
  insert into economy.ledger (
    operation_id, user_id, currency, amount, reason, reference, balance_after
  ) values (
    p_operation_id, p_user_id, 'KCOIN', p_amount, 'battle_stake_refund',
    p_reference, v_balance.available
  ) returning id into v_ledger_id;
  return jsonb_build_object(
    'available', v_balance.available,
    'locked', v_balance.locked,
    'ledger_id', v_ledger_id
  );
end;
$$;

create or replace function economy.settle_battle_kcoin(
  p_user_id uuid,
  p_locked_amount bigint,
  p_payout bigint,
  p_operation_id uuid,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance economy.balances%rowtype;
  v_ledger_id bigint;
begin
  select * into v_balance
  from economy.balances
  where user_id = p_user_id and currency = 'KCOIN'
  for update;
  if v_balance.user_id is null or p_locked_amount <= 0 or p_payout < 0
    or v_balance.locked < p_locked_amount
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object(
        'kind', 'locked_settlement',
        'user_id', p_user_id,
        'locked_amount', p_locked_amount,
        'payout', p_payout
      )::text;
  end if;
  update economy.balances
  set available = available + p_payout,
      locked = locked - p_locked_amount,
      updated_at = now()
  where user_id = p_user_id and currency = 'KCOIN'
  returning * into v_balance;
  if p_payout > 0 then
    insert into economy.ledger (
      operation_id, user_id, currency, amount, reason, reference, balance_after
    ) values (
      p_operation_id, p_user_id, 'KCOIN', p_payout, 'battle_win_payout',
      p_reference, v_balance.available
    ) returning id into v_ledger_id;
  end if;
  return jsonb_build_object(
    'available', v_balance.available,
    'locked', v_balance.locked,
    'ledger_id', v_ledger_id
  );
end;
$$;
