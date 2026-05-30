begin;

create or replace function api.wallet_prepare_mint_request(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_collection_address text default null,
  p_network text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_network text := nullif(btrim(p_network), '');
  v_collection_address text := nullif(btrim(p_collection_address), '');
  v_wallet core.user_wallets%rowtype;
  v_other_wallet core.user_wallets%rowtype;
  v_collection onchain.nft_collections%rowtype;
  v_collections jsonb := '[]'::jsonb;
  v_item inventory.item_instances%rowtype;
  v_active_lock inventory.inventory_locks%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_form catalog.collectible_forms%rowtype;
  v_media jsonb := '[]'::jsonb;
begin
  if p_user_id is null or p_item_instance_id is null then
    raise exception 'user_id and item_instance_id are required';
  end if;

  if v_network is null then
    v_network := 'mainnet';
  end if;

  select *
  into v_wallet
  from core.user_wallets
  where user_id = p_user_id
    and chain = 'TON'
    and network = v_network
    and status = 'connected'
  order by is_primary desc, verified_at desc nulls last, updated_at desc
  limit 1;

  select *
  into v_other_wallet
  from core.user_wallets
  where user_id = p_user_id
    and chain = 'TON'
    and status = 'connected'
  order by is_primary desc, verified_at desc nulls last, updated_at desc
  limit 1;

  if v_collection_address is not null then
    select *
    into v_collection
    from onchain.nft_collections
    where collection_address = v_collection_address
    order by updated_at desc
    limit 1;
  else
    select coalesce(jsonb_agg(to_jsonb(c) order by c.status asc, c.updated_at desc), '[]'::jsonb)
    into v_collections
    from (
      select *
      from onchain.nft_collections
      where chain = 'TON'
        and network = v_network
      order by status asc, updated_at desc
      limit 10
    ) c;
  end if;

  select *
  into v_item
  from inventory.item_instances
  where id = p_item_instance_id
    and owner_user_id = p_user_id;

  if v_item.id is not null then
    select *
    into v_active_lock
    from inventory.inventory_locks
    where item_instance_id = v_item.id
      and status = 'active'
    order by locked_at desc, created_at desc
    limit 1;

    select *
    into v_template
    from catalog.collectible_templates
    where id = v_item.template_id;

    if v_item.form_id is not null then
      select *
      into v_form
      from catalog.collectible_forms
      where id = v_item.form_id;
    end if;

    select coalesce(jsonb_agg(to_jsonb(m) order by m.sort_order asc, m.created_at asc), '[]'::jsonb)
    into v_media
    from catalog.collectible_media m
    where m.template_id = v_item.template_id;
  end if;

  return jsonb_build_object(
    'wallet', case when v_wallet.id is null then null else to_jsonb(v_wallet) end,
    'other_wallet', case when v_other_wallet.id is null then null else to_jsonb(v_other_wallet) end,
    'collection', case when v_collection.id is null then null else to_jsonb(v_collection) end,
    'collections', coalesce(v_collections, '[]'::jsonb),
    'item', case when v_item.id is null then null else to_jsonb(v_item) end,
    'active_lock', case when v_active_lock.id is null then null else to_jsonb(v_active_lock) end,
    'template', case when v_template.id is null then null else to_jsonb(v_template) end,
    'form', case when v_form.id is null then null else to_jsonb(v_form) end,
    'media', coalesce(v_media, '[]'::jsonb)
  );
end;
$$;

create or replace function api.wallet_save_mint_metadata_snapshot(
  p_user_id uuid,
  p_mint_queue_id uuid,
  p_priority integer,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue onchain.mint_queue%rowtype;
begin
  if p_user_id is null or p_mint_queue_id is null then
    raise exception 'user_id and mint_queue_id are required';
  end if;

  update onchain.mint_queue
  set priority = coalesce(p_priority, priority),
      metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_mint_queue_id
    and user_id = p_user_id
  returning * into v_queue;

  if v_queue.id is null then
    raise exception 'mint queue not found';
  end if;

  return jsonb_build_object(
    'mint_queue_id', v_queue.id,
    'item_instance_id', v_queue.item_instance_id,
    'status', v_queue.status,
    'priority', v_queue.priority
  );
end;
$$;

create or replace function api.wallet_get_mint_status(
  p_user_id uuid,
  p_mint_queue_id uuid default null,
  p_item_instance_id uuid default null,
  p_statuses text[] default null,
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_row_count integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  with limited_rows as (
    select q.*
    from onchain.mint_queue q
    where q.user_id = p_user_id
      and (p_mint_queue_id is null or q.id = p_mint_queue_id)
      and (p_item_instance_id is null or q.item_instance_id = p_item_instance_id)
      and (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or q.status = any(p_statuses)
      )
    order by q.created_at desc, q.id desc
    offset v_offset
    limit v_limit + 1
  ),
  page_rows as (
    select *
    from limited_rows
    order by created_at desc, id desc
    limit v_limit
  ),
  item_rows as (
    select
      q.id,
      q.created_at,
      q.status,
      jsonb_strip_nulls(jsonb_build_object(
        'mintQueueId', q.id,
        'itemInstanceId', q.item_instance_id,
        'status', q.status,
        'chain', case when coalesce(c.network, w.network) = 'testnet' then 'TESTNET' else 'MAINNET' end,
        'collectionAddress', c.collection_address,
        'itemAddress', ni.item_address,
        'targetAddress', coalesce(ni.owner_address, w.address),
        'transactionHash', coalesce(q.tx_hash, ni.minted_tx_hash, tx.tx_hash),
        'errorCode', coalesce(q.metadata ->> 'error_code', q.metadata ->> 'errorCode', q.metadata #>> '{error,code}'),
        'errorMessage', q.error_message,
        'retryCount', q.attempt_count,
        'createdAt', q.created_at,
        'updatedAt', q.updated_at,
        'mintedAt', case when q.status = 'minted' then coalesce(q.completed_at, ni.minted_at) else null end
      )) as item
    from page_rows q
    left join onchain.nft_collections c on c.id = q.collection_id
    left join core.user_wallets w on w.id = q.wallet_id
    left join onchain.nft_items ni on ni.id = q.nft_item_id
    left join lateral (
      select t.tx_hash, t.status, t.created_at
      from onchain.transactions t
      where t.related_type = 'mint_queue'
        and t.related_id = q.id
      order by t.created_at desc
      limit 1
    ) tx on true
    order by q.created_at desc, q.id desc
  )
  select
    (select count(*)::integer from limited_rows),
    coalesce((select jsonb_agg(item order by created_at desc, id desc) from item_rows), '[]'::jsonb),
    jsonb_build_object(
      'queued', coalesce(count(*) filter (where status = 'queued'), 0),
      'processing', coalesce(count(*) filter (where status = 'processing'), 0),
      'submitted', coalesce(count(*) filter (where status = 'submitted'), 0),
      'confirming', coalesce(count(*) filter (where status = 'confirming'), 0),
      'retrying', coalesce(count(*) filter (where status = 'retrying'), 0),
      'manual_review', coalesce(count(*) filter (where status = 'manual_review'), 0),
      'minted', coalesce(count(*) filter (where status = 'minted'), 0),
      'failed', coalesce(count(*) filter (where status = 'failed'), 0),
      'cancelled', coalesce(count(*) filter (where status = 'cancelled'), 0)
    )
  into v_row_count, v_items, v_summary
  from item_rows;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', v_summary,
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'serverTime', now()
  );
end;
$$;

create or replace function api.wallet_list_nft_snapshots(
  p_user_id uuid,
  p_address text default null,
  p_network text default null,
  p_collection_address text default null,
  p_only_known_collections boolean default false,
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address text := nullif(btrim(p_address), '');
  v_network text := nullif(btrim(p_network), '');
  v_collection_address text := nullif(btrim(p_collection_address), '');
  v_wallet_id uuid;
  v_wallet_filter_requested boolean := v_address is not null or v_network is not null;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_row_count integer := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if v_wallet_filter_requested then
    select w.id
    into v_wallet_id
    from core.user_wallets w
    where w.user_id = p_user_id
      and (v_address is null or w.address = v_address or w.address_raw = v_address)
      and (v_network is null or w.network = v_network)
    order by w.updated_at desc
    limit 1;

    if v_wallet_id is null then
      return jsonb_build_object(
        'items', '[]'::jsonb,
        'nextCursor', null,
        'serverTime', now()
      );
    end if;
  end if;

  with limited_rows as (
    select s.*
    from onchain.wallet_nft_snapshots s
    where s.user_id = p_user_id
      and (v_wallet_id is null or s.wallet_id = v_wallet_id)
      and (v_collection_address is null or s.collection_address = v_collection_address)
      and (
        coalesce(p_only_known_collections, false) is false
        or (
          v_collection_address is null
          and s.collection_address is not null
        )
        or (
          v_collection_address is not null
          and s.collection_address = v_collection_address
        )
      )
    order by s.seen_at desc, s.item_address asc
    offset v_offset
    limit v_limit + 1
  ),
  page_rows as (
    select *
    from limited_rows
    order by seen_at desc, item_address asc
    limit v_limit
  ),
  item_rows as (
    select
      s.seen_at,
      s.item_address,
      jsonb_strip_nulls(jsonb_build_object(
        'nftItemId', ni.id,
        'itemAddress', s.item_address,
        'collectionAddress', s.collection_address,
        'ownerAddress', s.owner_address,
        'itemIndex', coalesce(
          ni.item_index,
          case
            when (s.raw_payload ->> 'item_index') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              then floor((s.raw_payload ->> 'item_index')::numeric)::bigint
            else null
          end
        ),
        'name', s.raw_payload ->> 'name',
        'imageUrl', coalesce(s.raw_payload ->> 'image_url', s.raw_payload ->> 'imageUrl'),
        'metadataUrl', coalesce(s.metadata_url, ni.metadata_url),
        'linkedItemInstanceId', ni.item_instance_id,
        'syncedAt', s.seen_at
      )) as item
    from page_rows s
    left join onchain.nft_items ni on ni.item_address = s.item_address
    order by s.seen_at desc, s.item_address asc
  )
  select
    (select count(*)::integer from limited_rows),
    coalesce((select jsonb_agg(item order by seen_at desc, item_address asc) from item_rows), '[]'::jsonb)
  into v_row_count, v_items;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'serverTime', now()
  );
end;
$$;

revoke all on function api.wallet_prepare_mint_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function api.wallet_save_mint_metadata_snapshot(uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function api.wallet_get_mint_status(uuid, uuid, uuid, text[], integer, integer) from public, anon, authenticated;
revoke all on function api.wallet_list_nft_snapshots(uuid, text, text, text, boolean, integer, integer) from public, anon, authenticated;

grant execute on function api.wallet_prepare_mint_request(uuid, uuid, text, text) to service_role;
grant execute on function api.wallet_save_mint_metadata_snapshot(uuid, uuid, integer, jsonb) to service_role;
grant execute on function api.wallet_get_mint_status(uuid, uuid, uuid, text[], integer, integer) to service_role;
grant execute on function api.wallet_list_nft_snapshots(uuid, text, text, text, boolean, integer, integer) to service_role;

comment on function api.wallet_prepare_mint_request(uuid, uuid, text, text) is
  'Service-role facade that returns sanitized private schema rows needed for wallet Mint request preparation.';
comment on function api.wallet_save_mint_metadata_snapshot(uuid, uuid, integer, jsonb) is
  'Service-role facade that saves server-generated Mint metadata snapshot without exposing onchain.mint_queue.';
comment on function api.wallet_get_mint_status(uuid, uuid, uuid, text[], integer, integer) is
  'Service-role facade that returns the current user Mint queue API payload.';
comment on function api.wallet_list_nft_snapshots(uuid, text, text, text, boolean, integer, integer) is
  'Service-role facade that returns the current user wallet NFT snapshot API payload.';

commit;
