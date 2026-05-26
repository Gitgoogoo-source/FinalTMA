-- onchain_mark_mint_failed.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Marks a mint queue item as failed and optionally releases the game item back to the user.
-- Use release_item=false only if an external retry worker will continue processing immediately.

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


-- ============================================================
