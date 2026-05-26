-- economy_debit.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Public debit RPC plus internal helper used by game RPCs.
-- Debits virtual currency from a user and writes immutable economy.currency_ledger.

create or replace function api._debit_balance(
  p_user_id uuid,
  p_currency_code text,
  p_amount numeric,
  p_source_type text,
  p_source_id uuid default null,
  p_source_ref text default null,
  p_idempotency_key text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available_before numeric(38,0);
  v_available_after numeric(38,0);
  v_locked_before numeric(38,0);
  v_locked_after numeric(38,0);
  v_ledger_id uuid;
  v_existing uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'debit amount must be positive';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from economy.currency_ledger where idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return jsonb_build_object('ledger_id', v_existing, 'idempotent', true);
    end if;
  end if;

  insert into economy.user_balances (user_id, currency_code)
  values (p_user_id, p_currency_code)
  on conflict (user_id, currency_code) do nothing;

  select available_amount, locked_amount
    into v_available_before, v_locked_before
  from economy.user_balances
  where user_id = p_user_id and currency_code = p_currency_code
  for update;

  if v_available_before < p_amount then
    raise exception 'insufficient balance: currency %, available %, required %', p_currency_code, v_available_before, p_amount;
  end if;

  update economy.user_balances
  set available_amount = available_amount - p_amount,
      total_spent = total_spent + p_amount,
      updated_at = now()
  where user_id = p_user_id and currency_code = p_currency_code
  returning available_amount, locked_amount into v_available_after, v_locked_after;

  insert into economy.currency_ledger (
    user_id, currency_code, entry_type, amount,
    available_before, available_after, locked_before, locked_after,
    source_type, source_id, source_ref, idempotency_key, note, metadata
  ) values (
    p_user_id, p_currency_code, 'debit', p_amount,
    v_available_before, v_available_after, v_locked_before, v_locked_after,
    p_source_type, p_source_id, p_source_ref, p_idempotency_key, p_note, p_metadata
  ) returning id into v_ledger_id;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'user_id', p_user_id,
    'currency_code', p_currency_code,
    'available', v_available_after,
    'locked', v_locked_after,
    'available_before', v_available_before,
    'available_after', v_available_after,
    'locked_before', v_locked_before,
    'locked_after', v_locked_after,
    'idempotent', false
  );
end;
$$;


create or replace function api.economy_debit(
  p_user_id uuid,
  p_currency_code text,
  p_amount numeric,
  p_source_type text,
  p_source_id uuid default null,
  p_source_ref text default null,
  p_idempotency_key text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return api._debit_balance(
    p_user_id,
    upper(trim(p_currency_code)),
    p_amount,
    p_source_type,
    p_source_id,
    p_source_ref,
    p_idempotency_key,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;


-- ============================================================
