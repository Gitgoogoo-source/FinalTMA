create or replace function api.inventory_list_activity(
  p_user_id uuid,
  p_item_instance_id uuid default null,
  p_template_id uuid default null,
  p_activity_types text[] default null,
  p_from_at timestamptz default null,
  p_to_at timestamptz default null,
  p_limit integer default 30,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_items jsonb;
  v_has_next boolean := false;
  v_next_cursor text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_from_at is not null and p_to_at is not null and p_from_at > p_to_at then
    raise exception 'from_at cannot be later than to_at';
  end if;

  if nullif(btrim(coalesce(p_cursor, '')), '') is not null then
    begin
      v_cursor_created_at := split_part(p_cursor, '|', 1)::timestamptz;

      if position('|' in p_cursor) > 0 then
        v_cursor_id := nullif(split_part(p_cursor, '|', 2), '')::uuid;
      end if;
    exception when others then
      raise exception 'invalid cursor';
    end;
  end if;

  with activity_rows as (
    select
      e.id as activity_id,
      e.item_instance_id,
      ii.template_id,
      case
        when e.event_type = 'obtained_from_gacha' then 'obtained_by_gacha'
        when e.event_type in ('created', 'acquired') and e.source_type = 'gacha' then 'obtained_by_gacha'
        when e.event_type in ('created', 'acquired') and e.source_type = 'market' then 'obtained_by_market'
        when e.event_type in ('created', 'acquired') and e.source_type = 'admin' then 'obtained_by_admin'
        when e.event_type = 'listed' then 'listed'
        when e.event_type = 'delisted' then 'listing_cancelled'
        when e.event_type = 'sold' then 'sold'
        when e.event_type = 'bought' then 'bought'
        when e.event_type = 'upgraded' then 'upgraded'
        when e.event_type = 'evolved_success' then 'evolved_success'
        when e.event_type = 'evolved_failed_returned' then 'evolved_failed_returned'
        when e.event_type = 'consumed' then 'consumed_by_evolution'
        when e.event_type = 'decomposed' then 'decomposed'
        when e.event_type = 'mint_queued' then 'mint_requested'
        when e.event_type = 'minted' then 'minted'
        when e.event_type = 'transferred' then 'transferred_onchain'
        else 'admin_adjusted'
      end as activity_type,
      e.source_type,
      e.source_id,
      e.created_at
    from inventory.item_instance_events e
    join inventory.item_instances ii on ii.id = e.item_instance_id
    where e.user_id = p_user_id
      and (p_item_instance_id is null or e.item_instance_id = p_item_instance_id)
      and (p_template_id is null or ii.template_id = p_template_id)
      and (p_from_at is null or e.created_at >= p_from_at)
      and (p_to_at is null or e.created_at <= p_to_at)
      and (
        v_cursor_created_at is null
        or e.created_at < v_cursor_created_at
        or (
          v_cursor_id is not null
          and e.created_at = v_cursor_created_at
          and e.id < v_cursor_id
        )
      )
  ),
  filtered_rows as (
    select *
    from activity_rows
    where p_activity_types is null
      or cardinality(p_activity_types) = 0
      or activity_type = any(p_activity_types)
    order by created_at desc, activity_id desc
    limit v_limit + 1
  ),
  page_rows as (
    select *
    from filtered_rows
    order by created_at desc, activity_id desc
    limit v_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'activity_id', activity_id,
          'activity_type', activity_type,
          'item_instance_id', item_instance_id,
          'template_id', template_id,
          'source_type', coalesce(source_type, 'unknown'),
          'source_id', source_id,
          'title', case activity_type
            when 'obtained_by_gacha' then 'Item obtained'
            when 'obtained_by_market' then 'Item bought'
            when 'obtained_by_admin' then 'Item granted'
            when 'listed' then 'Item listed'
            when 'listing_cancelled' then 'Listing cancelled'
            when 'sold' then 'Item sold'
            when 'bought' then 'Item bought'
            when 'upgraded' then 'Item upgraded'
            when 'evolved_success' then 'Evolution succeeded'
            when 'evolved_failed_returned' then 'Evolution failed'
            when 'consumed_by_evolution' then 'Item consumed'
            when 'decomposed' then 'Item decomposed'
            when 'mint_requested' then 'Mint requested'
            when 'minted' then 'Item minted'
            when 'transferred_onchain' then 'Transferred on-chain'
            else 'Inventory updated'
          end,
          'description', null,
          'created_at', created_at
        )
        order by created_at desc, activity_id desc
      ),
      '[]'::jsonb
    )
  into v_items
  from page_rows;

  select count(*) > v_limit
  into v_has_next
  from filtered_rows;

  if v_has_next then
    select created_at::text || '|' || activity_id::text
    into v_next_cursor
    from page_rows
    order by created_at asc, activity_id asc
    limit 1;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'next_cursor', v_next_cursor
  );
end;
$$;

revoke execute on function api.inventory_list_activity(uuid, uuid, uuid, text[], timestamptz, timestamptz, integer, text) from public, anon, authenticated;
grant execute on function api.inventory_list_activity(uuid, uuid, uuid, text[], timestamptz, timestamptz, integer, text) to service_role;
