-- Phase 5 Mint idempotency hardening.
-- Keep existing idempotency primitives and make repeated Mint status updates
-- return the existing durable result instead of creating duplicate side effects.

begin;

create or replace function api.wallet_enqueue_mint(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_collection_id uuid,
  p_wallet_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_queue onchain.mint_queue%rowtype;
  v_item inventory.item_instances%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_collection onchain.nft_collections%rowtype;
  v_queue_id uuid;
begin
  p_idempotency_key := nullif(btrim(p_idempotency_key), '');

  if p_user_id is null or p_item_instance_id is null or p_collection_id is null or p_idempotency_key is null then
    raise exception 'user_id, item_instance_id, collection_id and idempotency_key are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('wallet_enqueue_mint'), hashtext(p_idempotency_key));

  select * into v_existing_queue
  from onchain.mint_queue
  where idempotency_key = p_idempotency_key
  for update;

  if v_existing_queue.id is not null then
    if v_existing_queue.user_id is distinct from p_user_id
       or v_existing_queue.item_instance_id is distinct from p_item_instance_id
       or v_existing_queue.collection_id is distinct from p_collection_id
       or v_existing_queue.wallet_id is distinct from p_wallet_id then
      raise exception 'idempotency conflict';
    end if;

    return jsonb_build_object(
      'mint_queue_id', v_existing_queue.id,
      'status', v_existing_queue.status,
      'item_instance_id', v_existing_queue.item_instance_id,
      'idempotent', true
    );
  end if;

  select * into v_item
  from inventory.item_instances
  where id = p_item_instance_id
  for update;

  if v_item.id is null then
    raise exception 'item not found';
  end if;
  if v_item.owner_user_id <> p_user_id then
    raise exception 'not item owner';
  end if;
  if v_item.status <> 'available' then
    raise exception 'item is not available for mint';
  end if;

  select * into v_template from catalog.collectible_templates where id = v_item.template_id;
  if not v_template.nft_mintable then
    raise exception 'item is not mintable';
  end if;

  select * into v_collection from onchain.nft_collections where id = p_collection_id and status = 'active';
  if v_collection.id is null then
    raise exception 'active NFT collection not found';
  end if;

  insert into onchain.mint_queue (
    user_id, wallet_id, collection_id, item_instance_id, template_id, form_id,
    status, next_attempt_at, idempotency_key
  ) values (
    p_user_id, p_wallet_id, p_collection_id, p_item_instance_id, v_item.template_id, v_item.form_id,
    'queued', now(), p_idempotency_key
  )
  returning id into v_queue_id;

  insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, source_id)
  values (p_item_instance_id, p_user_id, 'mint', 'mint_queue', v_queue_id)
  on conflict do nothing;

  update inventory.item_instances
  set status = 'minting', nft_mint_status = 'queued', updated_at = now(), lock_version = lock_version + 1
  where id = p_item_instance_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (p_item_instance_id, p_user_id, 'mint_queued', 'mint_queue', v_queue_id,
          jsonb_build_object('collection_id', p_collection_id));

  return jsonb_build_object(
    'mint_queue_id', v_queue_id,
    'status', 'queued',
    'item_instance_id', p_item_instance_id,
    'idempotent', false
  );
end;
$$;

create or replace function api.onchain_mark_mint_success_without_task_progress(
  p_mint_queue_id uuid,
  p_item_address text,
  p_item_index bigint,
  p_owner_address text,
  p_tx_hash text,
  p_metadata_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue onchain.mint_queue%rowtype;
  v_nft_item onchain.nft_items%rowtype;
  v_nft_item_id uuid;
  v_existing_tx_hash text;
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

  if v_queue.status = 'minted' then
    select * into v_nft_item
    from onchain.nft_items
    where id = v_queue.nft_item_id
       or item_instance_id = v_queue.item_instance_id
    order by minted_at desc nulls last, updated_at desc
    limit 1;

    if v_nft_item.id is null then
      raise exception 'minted queue is missing nft item';
    end if;

    v_existing_tx_hash := coalesce(v_queue.tx_hash, v_nft_item.minted_tx_hash);

    if (p_item_address is not null and v_nft_item.item_address is distinct from p_item_address)
       or (p_item_index is not null and v_nft_item.item_index is distinct from p_item_index)
       or (p_owner_address is not null and v_nft_item.owner_address is distinct from p_owner_address)
       or (p_tx_hash is not null and v_existing_tx_hash is distinct from p_tx_hash) then
      raise exception 'mint success idempotency conflict';
    end if;

    return jsonb_build_object(
      'nft_item_id', v_nft_item.id,
      'status', 'minted',
      'item_address', v_nft_item.item_address,
      'idempotent', true
    );
  end if;

  if v_queue.status in ('failed', 'cancelled') then
    raise exception 'mint queue already %', v_queue.status;
  end if;

  insert into onchain.nft_items (
    collection_id, item_instance_id, template_id, form_id, item_index, item_address,
    owner_address, owner_user_id, metadata_url, status, minted_tx_hash, minted_at
  ) values (
    v_queue.collection_id, v_queue.item_instance_id, v_queue.template_id, v_queue.form_id, p_item_index, p_item_address,
    p_owner_address, v_queue.user_id, p_metadata_url, 'minted', p_tx_hash, now()
  )
  on conflict (item_instance_id) do update
  set item_index = excluded.item_index,
      item_address = excluded.item_address,
      owner_address = excluded.owner_address,
      metadata_url = excluded.metadata_url,
      status = 'minted',
      minted_tx_hash = excluded.minted_tx_hash,
      minted_at = coalesce(onchain.nft_items.minted_at, now()),
      updated_at = now()
  returning id into v_nft_item_id;

  update onchain.mint_queue
  set status = 'minted', nft_item_id = v_nft_item_id, tx_hash = p_tx_hash, completed_at = now(), updated_at = now()
  where id = p_mint_queue_id;

  update inventory.item_instances
  set status = 'minted', nft_mint_status = 'minted', minted_nft_item_id = v_nft_item_id, updated_at = now(), lock_version = lock_version + 1
  where id = v_queue.item_instance_id;

  update inventory.inventory_locks
  set status = 'consumed', released_at = now(), updated_at = now()
  where item_instance_id = v_queue.item_instance_id and source_type = 'mint_queue' and source_id = p_mint_queue_id and status = 'active';

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_queue.item_instance_id, v_queue.user_id, 'minted', 'mint_queue', p_mint_queue_id,
          jsonb_build_object('nft_item_id', v_nft_item_id, 'item_address', p_item_address, 'tx_hash', p_tx_hash));

  return jsonb_build_object(
    'nft_item_id', v_nft_item_id,
    'status', 'minted',
    'item_address', p_item_address,
    'idempotent', false
  );
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
  v_released_item boolean;
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

  if v_queue.status = 'failed' then
    if p_tx_hash is not null and v_queue.tx_hash is distinct from p_tx_hash then
      raise exception 'mint failure idempotency conflict';
    end if;

    select exists (
      select 1
      from inventory.inventory_locks
      where item_instance_id = v_queue.item_instance_id
        and source_type = 'mint_queue'
        and source_id = p_mint_queue_id
        and status = 'released'
    ) into v_released_item;

    return jsonb_build_object(
      'mint_queue_id', p_mint_queue_id,
      'status', 'failed',
      'attempt_count', v_queue.attempt_count,
      'released_item', v_released_item,
      'item_instance_id', v_queue.item_instance_id,
      'tx_hash', v_queue.tx_hash,
      'idempotent', true
    );
  end if;

  if v_queue.status = 'minted' then
    raise exception 'mint queue already minted';
  end if;
  if v_queue.status = 'cancelled' then
    raise exception 'mint queue already cancelled';
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
    'tx_hash', p_tx_hash,
    'idempotent', false
  );
end;
$$;

commit;
