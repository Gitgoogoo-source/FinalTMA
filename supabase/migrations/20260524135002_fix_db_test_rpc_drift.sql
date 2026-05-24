-- Align local migration history with RPC definitions already present on the
-- linked Supabase project and in supabase/rpc/rpc_all.sql. This keeps
-- `supabase db reset` and `pnpm test:db` reproducible without manually replaying
-- the aggregate RPC file.

create or replace function api.economy_credit(
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
  return api._credit_balance(
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

create or replace function api.referral_create_commission(
  p_invitee_user_id uuid,
  p_source_id uuid,
  p_base_amount_kcoin numeric,
  p_commission_bps integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref tasks.referrals%rowtype;
  v_amount numeric(38,0);
  v_credit jsonb;
  v_commission_id uuid;
  v_existing tasks.referral_commissions%rowtype;
begin
  if p_base_amount_kcoin is null or p_base_amount_kcoin <= 0 then
    return jsonb_build_object('processed', false, 'reason', 'no_base_amount');
  end if;

  select * into v_ref
  from tasks.referrals
  where invitee_user_id = p_invitee_user_id and status = 'rewarded'
  limit 1;

  if v_ref.id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_rewarded_referral');
  end if;

  select * into v_existing
  from tasks.referral_commissions
  where referral_id = v_ref.id
    and source_type = 'gacha_open'
    and source_id = p_source_id
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'processed', true,
      'commission_id', v_existing.id,
      'amount_kcoin', v_existing.commission_amount_kcoin,
      'idempotent', true
    );
  end if;

  v_amount := floor(p_base_amount_kcoin * coalesce(p_commission_bps, 1000) / 10000);
  if v_amount <= 0 then
    return jsonb_build_object('processed', false, 'reason', 'zero_commission');
  end if;

  insert into tasks.referral_commissions (
    referral_id, inviter_user_id, invitee_user_id, source_type, source_id,
    base_amount_kcoin, commission_bps, commission_amount_kcoin, status
  ) values (
    v_ref.id, v_ref.inviter_user_id, v_ref.invitee_user_id, 'gacha_open', p_source_id,
    p_base_amount_kcoin, coalesce(p_commission_bps, 1000), v_amount, 'pending'
  ) returning id into v_commission_id;

  v_credit := api._credit_balance(
    v_ref.inviter_user_id, 'KCOIN', v_amount, 'referral_commission', v_commission_id, null,
    'referral_commission:' || v_commission_id::text,
    'Referral commission', jsonb_build_object('invitee_user_id', p_invitee_user_id, 'source_id', p_source_id)
  );

  update tasks.referral_commissions
  set ledger_id = (v_credit ->> 'ledger_id')::uuid,
      status = 'granted'
  where id = v_commission_id;

  return jsonb_build_object('processed', true, 'commission_id', v_commission_id, 'amount_kcoin', v_amount, 'idempotent', false);
end;
$$;

create or replace function api.onchain_mark_mint_failed(
  p_mint_queue_id uuid,
  p_error_message text,
  p_tx_hash text default null,
  p_release_item boolean default true,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue onchain.mint_queue%rowtype;
  v_attempt_count integer;
begin
  if p_mint_queue_id is null then
    raise exception 'mint_queue_id is required';
  end if;

  select * into v_queue
  from onchain.mint_queue
  where id = p_mint_queue_id
  for update;

  if v_queue.id is null then
    raise exception 'mint queue not found';
  end if;

  v_attempt_count := v_queue.attempt_count + 1;

  update onchain.mint_queue
  set status = 'failed',
      attempt_count = v_attempt_count,
      tx_hash = coalesce(p_tx_hash, tx_hash),
      error_message = coalesce(nullif(p_error_message, ''), 'mint failed'),
      next_attempt_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      completed_at = now(),
      updated_at = now()
  where id = p_mint_queue_id;

  if coalesce(p_tx_hash, '') <> '' then
    insert into onchain.transactions (
      chain, network, tx_hash, user_id, wallet_id, related_type, related_id,
      direction, status, payload, error_message, submitted_at
    ) values (
      'TON',
      coalesce((select network from onchain.nft_collections where id = v_queue.collection_id), 'mainnet'),
      p_tx_hash,
      v_queue.user_id,
      v_queue.wallet_id,
      'mint_queue',
      p_mint_queue_id,
      'outbound',
      'failed',
      coalesce(p_metadata, '{}'::jsonb),
      p_error_message,
      now()
    )
    on conflict (tx_hash) do update
    set status = 'failed',
        error_message = excluded.error_message,
        payload = onchain.transactions.payload || excluded.payload,
        updated_at = now();
  end if;

  if coalesce(p_release_item, true) then
    update inventory.item_instances
    set status = 'available',
        nft_mint_status = 'failed',
        updated_at = now(),
        lock_version = lock_version + 1
    where id = v_queue.item_instance_id;

    update inventory.inventory_locks
    set status = 'released',
        released_at = now(),
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('mint_failed', true, 'error_message', p_error_message)
    where item_instance_id = v_queue.item_instance_id
      and source_type = 'mint_queue'
      and source_id = p_mint_queue_id
      and status = 'active';
  else
    update inventory.item_instances
    set nft_mint_status = 'failed',
        updated_at = now(),
        lock_version = lock_version + 1
    where id = v_queue.item_instance_id;
  end if;

  insert into inventory.item_instance_events (
    item_instance_id, user_id, event_type, source_type, source_id, after_state, metadata
  ) values (
    v_queue.item_instance_id,
    v_queue.user_id,
    'admin_adjusted',
    'mint_queue',
    p_mint_queue_id,
    jsonb_build_object(
      'mint_status', 'failed',
      'released', coalesce(p_release_item, true),
      'tx_hash', p_tx_hash,
      'error_message', p_error_message
    ),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'mint_queue_id', p_mint_queue_id,
    'status', 'failed',
    'attempt_count', v_attempt_count,
    'released_item', coalesce(p_release_item, true),
    'item_instance_id', v_queue.item_instance_id,
    'tx_hash', p_tx_hash
  );
end;
$$;

grant execute on function api.economy_credit(uuid, text, numeric, text, uuid, text, text, text, jsonb) to service_role;
grant execute on function api.economy_debit(uuid, text, numeric, text, uuid, text, text, text, jsonb) to service_role;
grant execute on function api.referral_create_commission(uuid, uuid, numeric, integer) to service_role;
grant execute on function api.onchain_mark_mint_failed(uuid, text, text, boolean, jsonb) to service_role;

revoke execute on function api.economy_credit(uuid, text, numeric, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function api.economy_debit(uuid, text, numeric, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function api.referral_create_commission(uuid, uuid, numeric, integer) from public, anon, authenticated;
revoke execute on function api.onchain_mark_mint_failed(uuid, text, text, boolean, jsonb) from public, anon, authenticated;
