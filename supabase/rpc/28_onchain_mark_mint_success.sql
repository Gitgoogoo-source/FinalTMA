-- onchain_mark_mint_success.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.onchain_mark_mint_success

create or replace function api.onchain_mark_mint_success(
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
  v_nft_item_id uuid;
begin
  select * into v_queue
  from onchain.mint_queue
  where id = p_mint_queue_id
  for update;

  if v_queue.id is null then
    raise exception 'mint queue not found';
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

  return jsonb_build_object('nft_item_id', v_nft_item_id, 'status', 'minted', 'item_address', p_item_address);
end;
$$;


-- ============================================================
