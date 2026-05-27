-- wallet_enqueue_mint.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.wallet_enqueue_mint

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


-- ============================================================
