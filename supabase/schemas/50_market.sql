create table market.listings (
  id uuid primary key default extensions.gen_random_uuid(),
  seller_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  unit_price bigint not null check (unit_price > 0),
  quantity bigint not null check (quantity > 0),
  remaining bigint not null check (remaining >= 0 and remaining <= quantity),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  operation_id uuid not null references operations.operations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_fifo_idx on market.listings (template_id, created_at, id) where status = 'active' and remaining > 0;
create index listings_seller_active_idx on market.listings (seller_id, template_id, created_at) where status = 'active';

create table market.trades (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  total_price bigint not null check (total_price > 0),
  operation_id uuid not null unique references operations.operations(id),
  created_at timestamptz not null default now()
);

create index trades_buyer_created_idx on market.trades (buyer_id, created_at desc);
create index trades_template_created_idx on market.trades (template_id, created_at desc);

create table market.trade_details (
  id bigint generated always as identity primary key,
  trade_id uuid not null references market.trades(id) on delete cascade,
  listing_id uuid not null references market.listings(id),
  seller_id uuid not null references identity.users(id),
  quantity bigint not null check (quantity > 0),
  gross bigint not null check (gross > 0),
  fee bigint not null check (fee >= 0),
  seller_net bigint not null check (seller_net >= 0),
  vip_rebate bigint not null default 0 check (vip_rebate >= 0)
);

create index trade_details_trade_idx on market.trade_details (trade_id);
create index trade_details_seller_idx on market.trade_details (seller_id, id desc);

create table market.seller_sale_sequences (
  seller_id uuid primary key references identity.users(id) on delete cascade,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create table market.seller_sale_events (
  seller_id uuid not null references identity.users(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  trade_id uuid not null references market.trades(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  unit_price bigint not null check (unit_price > 0),
  sold_at timestamptz not null default now(),
  primary key (seller_id, sequence),
  unique (seller_id, trade_id)
);

create index seller_sale_events_trade_idx on market.seller_sale_events (trade_id);
create index seller_sale_events_template_idx on market.seller_sale_events (template_id);

create or replace function api.market_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', t.id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
        'unit_price', t.market_price,
        'available_quantity', x.available_quantity,
        'own_listed_quantity', x.own_listed_quantity
      ) order by t.sort_order)
      from catalog.templates t
      join (
        select
          l.template_id,
          coalesce(sum(l.remaining) filter (where l.seller_id <> v_user_id), 0) available_quantity,
          coalesce(sum(l.remaining) filter (where l.seller_id = v_user_id), 0) own_listed_quantity
        from market.listings l
        join identity.users u on u.id = l.seller_id
        where l.status = 'active' and l.remaining > 0 and u.status = 'normal'
        group by l.template_id
      ) x on x.template_id = t.id
    ), '[]'::jsonb),
    'sellable_items', coalesce((
      with user_items as materialized (
        select item.*
        from inventory.item_read_model item
        where item.user_id = v_user_id and item.available > 0
      )
      select jsonb_agg(
        inventory.present_item(item)
          || jsonb_build_object('unit_price', item.market_price)
        order by item.sort_order
      )
      from user_items item
    ), '[]'::jsonb),
    'vip', vip.status_json(v_user_id),
    'max_active_templates', 10,
    'fee_bps', 500,
    'vip_rebate_bps', 2000
  );
end;
$$;

create or replace function api.market_template(p_session_id uuid, p_template_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select jsonb_build_object(
    'template_id', t.id,
    'name', t.name,
    'rarity', t.rarity,
    'stage', t.stage,
    'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
    'unit_price', t.market_price,
    'available_quantity', coalesce(x.available_quantity, 0),
    'own_listed_quantity', coalesce(x.own_listed_quantity, 0)
  ) into v_result
  from catalog.templates t
  left join (
    select
      l.template_id,
      coalesce(sum(l.remaining) filter (where l.seller_id <> v_user_id), 0) available_quantity,
      coalesce(sum(l.remaining) filter (where l.seller_id = v_user_id), 0) own_listed_quantity
    from market.listings l
    join identity.users u on u.id = l.seller_id
    where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and u.status = 'normal'
    group by l.template_id
  ) x on x.template_id = t.id
  where t.id = p_template_id;
  if v_result is null then
    perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.market_my_listings(
  p_session_id uuid,
  p_after_sale_sequence bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_latest_sequence bigint;
  v_after_sequence bigint;
  v_sale_cursor bigint;
  v_sold_events jsonb := '[]'::jsonb;
  v_has_more boolean := false;
begin
  select coalesce(last_sequence, 0)
  into v_latest_sequence
  from market.seller_sale_sequences
  where seller_id = v_user_id
  for share;
  v_latest_sequence := coalesce(v_latest_sequence, 0);

  if p_after_sale_sequence is null then
    v_sale_cursor := v_latest_sequence;
  else
    v_after_sequence := least(greatest(p_after_sale_sequence, 0), v_latest_sequence);
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'sale_sequence', e.sequence::text,
        'template_id', e.template_id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
        'quantity', e.quantity,
        'unit_price', e.unit_price,
        'sold_at', e.sold_at
      ) order by e.sequence), '[]'::jsonb),
      coalesce(max(e.sequence), v_after_sequence)
    into v_sold_events, v_sale_cursor
    from (
      select *
      from market.seller_sale_events
      where seller_id = v_user_id and sequence > v_after_sequence
      order by sequence
      limit 100
    ) e
    join catalog.templates t on t.id = e.template_id;
    select exists (
      select 1
      from market.seller_sale_events
      where seller_id = v_user_id and sequence > v_sale_cursor
    ) into v_has_more;
  end if;

  return jsonb_build_object(
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', a.template_id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
        'listed_quantity', a.listed_quantity,
        'sold_quantity', coalesce(s.sold_quantity, 0),
        'unit_price', t.market_price,
        'estimated_gross', a.listed_quantity * t.market_price,
        'estimated_fee', floor(a.listed_quantity * t.market_price * 500.0 / 10000.0),
        'estimated_net', a.listed_quantity * t.market_price - floor(a.listed_quantity * t.market_price * 500.0 / 10000.0),
        'estimated_vip_rebate', case
          when exists (
            select 1 from vip.subscriptions v
            where v.user_id = v_user_id and identity.utc_day() between v.starts_on and v.ends_on
          )
          then floor(floor(a.listed_quantity * t.market_price * 500.0 / 10000.0) * 2000.0 / 10000.0)
          else 0
        end,
        'status', case when coalesce(s.sold_quantity, 0) > 0 then 'partially_sold' else 'active' end,
        'first_listed_at', a.first_listed_at
      ) order by t.sort_order)
      from (
        select l.template_id, sum(l.remaining) listed_quantity, min(l.created_at) first_listed_at
        from market.listings l
        where l.seller_id = v_user_id and l.status = 'active' and l.remaining > 0
        group by l.template_id
      ) a
      join catalog.templates t on t.id = a.template_id
      left join (
        select l.template_id, sum(l.quantity - l.remaining) sold_quantity
        from market.listings l
        where l.seller_id = v_user_id and l.quantity > l.remaining
        group by l.template_id
      ) s on s.template_id = a.template_id
    ), '[]'::jsonb),
    'sold_events', v_sold_events,
    'sale_cursor', v_sale_cursor::text,
    'has_more', v_has_more
  );
end;
$$;

create or replace function api.market_create_listing(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_template catalog.templates%rowtype;
  v_listing market.listings%rowtype;
  v_active_count integer;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'market.create_listing', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    if p_quantity <= 0 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':market-listings', 0));
    select count(distinct template_id) into v_active_count
    from market.listings
    where seller_id = v_user_id and status = 'active' and remaining > 0;
    if v_active_count >= 10 and not exists (
      select 1 from market.listings
      where seller_id = v_user_id and template_id = p_template_id and status = 'active' and remaining > 0
    ) then
      perform api.raise_business_error('MARKET_ACTIVE_TEMPLATE_LIMIT', '最多同时出售 10 种藏品，请先售罄或下架一种藏品');
    end if;
    insert into market.seller_sale_sequences (seller_id)
    values (v_user_id)
    on conflict (seller_id) do nothing;
    insert into market.listings (seller_id, template_id, unit_price, quantity, remaining, operation_id)
    values (v_user_id, p_template_id, v_template.market_price, p_quantity, p_quantity, p_operation_id) returning * into v_listing;
    perform inventory.reserve(v_user_id, p_template_id, p_quantity, 'listing', v_listing.id);
    perform tasks.progress(v_user_id, 'market_list');
    v_result := jsonb_build_object('listing_id', v_listing.id, 'template_id', p_template_id, 'name', v_template.name, 'rarity', v_template.rarity, 'image_thumbnail_url', catalog.template_thumbnail_url(v_template.id), 'quantity', p_quantity, 'unit_price', v_template.market_price, 'created_at', v_listing.created_at);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.market_cancel_template_listings(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_released bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'market.cancel_template_listings', p_operation_id, jsonb_build_object('template_id', p_template_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if not exists (select 1 from catalog.templates where id = p_template_id) then
      perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在');
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':market-listings', 0));
    perform 1
    from market.listings
    where seller_id = v_user_id and template_id = p_template_id and status = 'active' and remaining > 0
    order by created_at, id
    for update;
    select coalesce(sum(remaining), 0) into v_released
    from market.listings
    where seller_id = v_user_id and template_id = p_template_id and status = 'active' and remaining > 0;
    update inventory.reservations r
    set status = 'released', released_at = now()
    where r.kind = 'listing' and r.status = 'active' and exists (
      select 1
      from market.listings l
      where l.id = r.reference_id and l.seller_id = v_user_id and l.template_id = p_template_id
        and l.status = 'active' and l.remaining > 0
    );
    update market.listings
    set status = 'cancelled', remaining = 0, updated_at = now()
    where seller_id = v_user_id and template_id = p_template_id and status = 'active' and remaining > 0;
    v_result := jsonb_build_object('template_id', p_template_id, 'status', 'cancelled', 'released_quantity', v_released);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.market_purchase(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_template catalog.templates%rowtype;
  v_listing market.listings%rowtype;
  v_trade_id uuid;
  v_available bigint;
  v_remaining bigint;
  v_take bigint;
  v_gross bigint;
  v_fee bigint;
  v_rebate bigint;
  v_total bigint;
  v_details jsonb := '[]'::jsonb;
  v_sale record;
  v_sale_sequence bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'market.purchase', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    perform 1 from market.listings l join identity.users u on u.id = l.seller_id
    where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and l.seller_id <> v_user_id and u.status = 'normal'
    order by l.created_at, l.id for update of l;
    select coalesce(sum(l.remaining), 0) into v_available from market.listings l join identity.users u on u.id = l.seller_id
    where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and l.seller_id <> v_user_id and u.status = 'normal';
    if p_quantity <= 0 or v_available < p_quantity then perform api.raise_business_error('MARKET_STOCK_INSUFFICIENT', '市场可购买数量不足'); end if;
    v_total := v_template.market_price * p_quantity;
    perform economy.change_balance(v_user_id, 'KCOIN', -v_total, 'market_buy', p_operation_id, p_template_id);
    insert into market.trades (buyer_id, template_id, quantity, total_price, operation_id)
    values (v_user_id, p_template_id, p_quantity, v_total, p_operation_id) returning id into v_trade_id;
    v_remaining := p_quantity;
    for v_listing in
      select l.* from market.listings l join identity.users u on u.id = l.seller_id
      where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and l.seller_id <> v_user_id and u.status = 'normal'
      order by l.created_at, l.id
    loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_listing.remaining);
      v_gross := v_take * v_listing.unit_price;
      v_fee := floor(v_gross * 500.0 / 10000.0);
      v_rebate := case when exists (select 1 from vip.subscriptions where user_id = v_listing.seller_id and identity.utc_day() between starts_on and ends_on) then floor(v_fee * 2000.0 / 10000.0) else 0 end;
      if v_take = v_listing.remaining then
        update market.listings set remaining = 0, status = 'sold', updated_at = now() where id = v_listing.id;
        update inventory.reservations set status = 'consumed', released_at = now() where kind = 'listing' and reference_id = v_listing.id and status = 'active';
      else
        update market.listings set remaining = remaining - v_take, updated_at = now() where id = v_listing.id;
        update inventory.reservations set quantity = quantity - v_take where kind = 'listing' and reference_id = v_listing.id and status = 'active';
      end if;
      perform inventory.change_holding(v_listing.seller_id, p_template_id, -v_take);
      perform economy.change_balance(v_listing.seller_id, 'KCOIN', v_gross - v_fee + v_rebate, 'market_sale', p_operation_id, v_trade_id::text);
      insert into market.trade_details (trade_id, listing_id, seller_id, quantity, gross, fee, seller_net, vip_rebate)
      values (v_trade_id, v_listing.id, v_listing.seller_id, v_take, v_gross, v_fee, v_gross - v_fee, v_rebate);
      v_details := v_details || jsonb_build_array(jsonb_build_object('quantity', v_take, 'unit_price', v_listing.unit_price, 'gross', v_gross, 'fee', v_fee));
      perform tasks.progress(v_listing.seller_id, 'market_sold');
      v_remaining := v_remaining - v_take;
    end loop;
    for v_sale in
      select seller_id, sum(quantity)::bigint quantity
      from market.trade_details
      where trade_id = v_trade_id
      group by seller_id
      order by seller_id
    loop
      insert into market.seller_sale_sequences (seller_id)
      values (v_sale.seller_id)
      on conflict (seller_id) do nothing;
      update market.seller_sale_sequences
      set last_sequence = last_sequence + 1, updated_at = now()
      where seller_id = v_sale.seller_id
      returning last_sequence into v_sale_sequence;
      insert into market.seller_sale_events (
        seller_id,
        sequence,
        trade_id,
        template_id,
        quantity,
        unit_price
      ) values (
        v_sale.seller_id,
        v_sale_sequence,
        v_trade_id,
        p_template_id,
        v_sale.quantity,
        v_template.market_price
      );
    end loop;
    perform inventory.change_holding(v_user_id, p_template_id, p_quantity);
    perform album.unlock_template(v_user_id, p_template_id, p_operation_id);
    perform tasks.progress(v_user_id, 'market_buy');
    v_result := jsonb_build_object('trade_id', v_trade_id, 'template_id', p_template_id, 'quantity', p_quantity, 'unit_price', v_template.market_price, 'total_price', v_total, 'details', v_details, 'assets', economy.assets(v_user_id));
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
