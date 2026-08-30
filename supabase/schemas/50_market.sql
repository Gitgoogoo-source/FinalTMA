create table market.seller_listing_quotas (
  seller_id uuid primary key references identity.users(id) on delete cascade,
  business_date date not null default identity.utc_day(),
  daily_count integer not null default 0 check (daily_count between 0 and 200),
  lifetime_count integer not null default 0 check (lifetime_count between 0 and 20000),
  updated_at timestamptz not null default now(),
  check (daily_count <= lifetime_count)
);

create or replace function market.lock_listing_quota(p_seller_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_date date := identity.utc_day();
  v_quota market.seller_listing_quotas%rowtype;
begin
  insert into market.seller_listing_quotas (seller_id, business_date)
  values (p_seller_id, v_business_date)
  on conflict (seller_id) do nothing;

  select * into strict v_quota
  from market.seller_listing_quotas
  where seller_id = p_seller_id
  for update;

  if v_quota.business_date <> v_business_date then
    update market.seller_listing_quotas
    set business_date = v_business_date,
        daily_count = 0,
        updated_at = now()
    where seller_id = p_seller_id
    returning * into strict v_quota;
  end if;

  if v_quota.lifetime_count >= 20000 then
    perform api.raise_business_error(
      'MARKET_LIFETIME_LISTING_LIMIT',
      '账号累计上架次数已达上限'
    );
  end if;
  if v_quota.daily_count >= 200 then
    perform api.raise_business_error(
      'MARKET_DAILY_LISTING_LIMIT',
      '今日上架次数已用完'
    );
  end if;
end;
$$;

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
create index listings_operation_idx on market.listings (operation_id);

create or replace function market.purchase_quantity_limit()
returns bigint
language sql
immutable
security invoker
set search_path = ''
as $$
  select 100::bigint
$$;

revoke execute on function market.purchase_quantity_limit() from public, anon, authenticated, service_role;

create or replace function market.consume_listing_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform market.lock_listing_quota(new.seller_id);
  update market.seller_listing_quotas
  set daily_count = daily_count + 1,
      lifetime_count = lifetime_count + 1,
      updated_at = now()
  where seller_id = new.seller_id;
  if not found then
    raise exception using errcode = '23514', message = 'MARKET_LISTING_QUOTA_MISSING';
  end if;
  return new;
end;
$$;

create trigger listings_quota_consume
before insert on market.listings
for each row execute function market.consume_listing_quota();

create table market.seller_template_supply (
  seller_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  active_quantity bigint not null check (active_quantity > 0),
  updated_at timestamptz not null default now(),
  primary key (seller_id, template_id)
);

create index seller_template_supply_template_idx on market.seller_template_supply (template_id, seller_id);

create table market.template_supply (
  template_id text primary key references catalog.templates(id),
  eligible_quantity bigint not null check (eligible_quantity > 0),
  updated_at timestamptz not null default now()
);

create or replace function market.change_positive_supply(
  p_scope text,
  p_seller_id uuid,
  p_template_id text,
  p_delta bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quantity bigint;
begin
  if p_delta = 0 then
    return;
  end if;

  if p_scope = 'seller' then
    if p_delta > 0 then
      insert into market.seller_template_supply (seller_id, template_id, active_quantity)
      values (p_seller_id, p_template_id, p_delta)
      on conflict (seller_id, template_id) do update
      set active_quantity = market.seller_template_supply.active_quantity + excluded.active_quantity,
          updated_at = now();
      return;
    end if;

    select active_quantity into v_quantity
    from market.seller_template_supply
    where seller_id = p_seller_id and template_id = p_template_id
    for update;
    if v_quantity is null or v_quantity < -p_delta then
      raise exception using
        errcode = '23514',
        message = 'MARKET_SELLER_SUPPLY_UNDERFLOW',
        detail = jsonb_build_object(
          'seller_id', p_seller_id,
          'template_id', p_template_id,
          'current_quantity', v_quantity,
          'delta', p_delta
        )::text;
    elsif v_quantity = -p_delta then
      delete from market.seller_template_supply
      where seller_id = p_seller_id and template_id = p_template_id;
    else
      update market.seller_template_supply
      set active_quantity = active_quantity + p_delta, updated_at = now()
      where seller_id = p_seller_id and template_id = p_template_id;
    end if;
    return;
  end if;

  if p_scope <> 'template' or p_seller_id is not null then
    raise exception using errcode = '22023', message = 'MARKET_SUPPLY_SCOPE_INVALID';
  end if;
  if p_delta > 0 then
    insert into market.template_supply (template_id, eligible_quantity)
    values (p_template_id, p_delta)
    on conflict (template_id) do update
    set eligible_quantity = market.template_supply.eligible_quantity + excluded.eligible_quantity,
        updated_at = now();
    return;
  end if;

  select eligible_quantity into v_quantity
  from market.template_supply
  where template_id = p_template_id
  for update;
  if v_quantity is null or v_quantity < -p_delta then
    raise exception using
      errcode = '23514',
      message = 'MARKET_TEMPLATE_SUPPLY_UNDERFLOW',
      detail = jsonb_build_object(
        'template_id', p_template_id,
        'current_quantity', v_quantity,
        'delta', p_delta
      )::text;
  elsif v_quantity = -p_delta then
    delete from market.template_supply where template_id = p_template_id;
  else
    update market.template_supply
    set eligible_quantity = eligible_quantity + p_delta, updated_at = now()
    where template_id = p_template_id;
  end if;
end;
$$;

create or replace function market.change_listing_supply(
  p_seller_id uuid,
  p_template_id text,
  p_delta bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seller_is_eligible boolean;
begin
  if p_delta = 0 then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('market.template-supply:' || p_template_id, 0));
  perform market.change_positive_supply('seller', p_seller_id, p_template_id, p_delta);
  select status = 'normal' into v_seller_is_eligible
  from identity.users
  where id = p_seller_id;
  if coalesce(v_seller_is_eligible, false) then
    perform market.change_positive_supply('template', null, p_template_id, p_delta);
  end if;
end;
$$;

create or replace function market.sync_listing_supply()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_quantity bigint := 0;
  v_new_quantity bigint := 0;
begin
  if tg_op <> 'INSERT' and old.status = 'active' and old.remaining > 0 then
    v_old_quantity := old.remaining;
  end if;
  if tg_op <> 'DELETE' and new.status = 'active' and new.remaining > 0 then
    v_new_quantity := new.remaining;
  end if;

  if tg_op = 'UPDATE'
    and (old.seller_id is distinct from new.seller_id or old.template_id is distinct from new.template_id)
  then
    raise exception using errcode = '23514', message = 'MARKET_LISTING_SUPPLY_KEY_IMMUTABLE';
  end if;

  perform market.change_listing_supply(
    coalesce(new.seller_id, old.seller_id),
    coalesce(new.template_id, old.template_id),
    v_new_quantity - v_old_quantity
  );
  return coalesce(new, old);
end;
$$;

create trigger listings_supply_sync
after insert or delete or update of seller_id, template_id, remaining, status on market.listings
for each row execute function market.sync_listing_supply();

create or replace function market.recompute_template_supply(p_template_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quantity bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('market.template-supply:' || p_template_id, 0));
  select coalesce(sum(s.active_quantity), 0)::bigint into v_quantity
  from market.seller_template_supply s
  join identity.users u on u.id = s.seller_id and u.status = 'normal'
  where s.template_id = p_template_id;
  if v_quantity = 0 then
    delete from market.template_supply where template_id = p_template_id;
  else
    insert into market.template_supply (template_id, eligible_quantity)
    values (p_template_id, v_quantity)
    on conflict (template_id) do update
    set eligible_quantity = excluded.eligible_quantity, updated_at = now();
  end if;
end;
$$;

create or replace function market.sync_user_status_supply()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template_id text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;
  for v_template_id in
    select affected.template_id
    from (
      select supply.template_id
      from market.seller_template_supply supply
      where supply.seller_id = new.id
      union
      select listing.template_id
      from market.listings listing
      where listing.seller_id = new.id and listing.status = 'active' and listing.remaining > 0
    ) affected
    order by affected.template_id
  loop
    perform market.recompute_template_supply(v_template_id);
  end loop;
  return new;
end;
$$;

create trigger users_market_supply_status_sync
after update of status on identity.users
for each row
when (old.status is distinct from new.status)
execute function market.sync_user_status_supply();

create or replace function market.rebuild_supply()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_rows integer;
  v_template_rows integer;
begin
  lock table identity.users in share mode;
  lock table market.listings in share mode;
  lock table market.seller_template_supply in access exclusive mode;
  lock table market.template_supply in access exclusive mode;

  delete from market.template_supply;
  delete from market.seller_template_supply;

  insert into market.seller_template_supply (seller_id, template_id, active_quantity)
  select seller_id, template_id, sum(remaining)::bigint
  from market.listings
  where status = 'active' and remaining > 0
  group by seller_id, template_id;
  get diagnostics v_seller_rows = row_count;

  insert into market.template_supply (template_id, eligible_quantity)
  select supply.template_id, sum(supply.active_quantity)::bigint
  from market.seller_template_supply supply
  join identity.users users on users.id = supply.seller_id and users.status = 'normal'
  group by supply.template_id;
  get diagnostics v_template_rows = row_count;

  return jsonb_build_object(
    'seller_template_rows', v_seller_rows,
    'template_rows', v_template_rows
  );
end;
$$;

revoke execute on function market.rebuild_supply() from public, anon, authenticated, service_role;

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
  v_business_date date := identity.utc_day();
  v_daily_used integer;
  v_lifetime_used integer;
begin
  select
    coalesce(max(case when quota.business_date = v_business_date then quota.daily_count else 0 end), 0),
    coalesce(max(quota.lifetime_count), 0)
  into v_daily_used, v_lifetime_used
  from market.seller_listing_quotas quota
  where quota.seller_id = v_user_id;

  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', t.id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
        'unit_price', t.market_price,
        'available_quantity', greatest(supply.eligible_quantity - coalesce(own.active_quantity, 0), 0),
        'own_listed_quantity', coalesce(own.active_quantity, 0)
      ) order by t.sort_order)
      from market.template_supply supply
      join catalog.templates t on t.id = supply.template_id
      left join market.seller_template_supply own
        on own.seller_id = v_user_id and own.template_id = supply.template_id
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
    'listing_quota', jsonb_build_object(
      'business_date', v_business_date,
      'daily_used', v_daily_used,
      'daily_limit', 200,
      'daily_remaining', 200 - v_daily_used,
      'lifetime_used', v_lifetime_used,
      'lifetime_limit', 20000,
      'lifetime_remaining', 20000 - v_lifetime_used
    ),
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
    'available_quantity', greatest(coalesce(supply.eligible_quantity, 0) - coalesce(own.active_quantity, 0), 0),
    'own_listed_quantity', coalesce(own.active_quantity, 0)
  ) into v_result
  from catalog.templates t
  left join market.template_supply supply on supply.template_id = t.id
  left join market.seller_template_supply own
    on own.seller_id = v_user_id and own.template_id = t.id
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
        'template_id', supply.template_id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
        'listed_quantity', supply.active_quantity,
        'unit_price', t.market_price
      ) order by t.sort_order)
      from market.seller_template_supply supply
      join catalog.templates t on t.id = supply.template_id
      where supply.seller_id = v_user_id
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
  perform market.lock_listing_quota(v_user_id);
  begin
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    if p_quantity <= 0 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':market-listings', 0));
    select count(*) into v_active_count
    from market.seller_template_supply
    where seller_id = v_user_id;
    if v_active_count >= 10 and not exists (
      select 1 from market.seller_template_supply
      where seller_id = v_user_id and template_id = p_template_id
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
  v_candidate_ids uuid[] := array[]::uuid[];
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
    if p_quantity is null
      or p_quantity < 1
      or p_quantity > market.purchase_quantity_limit()
    then
      perform api.raise_business_error('MARKET_STOCK_INSUFFICIENT', '市场单次购买数量必须在 1 到 100 之间');
    end if;
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    perform pg_advisory_xact_lock(hashtextextended('market.purchase:' || p_template_id, 0));
    v_available := 0;
    for v_listing in
      select l.* from market.listings l join identity.users u on u.id = l.seller_id
      where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and l.seller_id <> v_user_id and u.status = 'normal'
      order by l.created_at, l.id
      limit p_quantity
      for update of l
    loop
      v_candidate_ids := array_append(v_candidate_ids, v_listing.id);
      v_available := v_available + v_listing.remaining;
    end loop;
    if v_available < p_quantity then perform api.raise_business_error('MARKET_STOCK_INSUFFICIENT', '市场可购买数量不足'); end if;
    v_total := v_template.market_price * p_quantity;
    perform economy.change_balance(v_user_id, 'KCOIN', -v_total, 'market_buy', p_operation_id, p_template_id);
    insert into market.trades (buyer_id, template_id, quantity, total_price, operation_id)
    values (v_user_id, p_template_id, p_quantity, v_total, p_operation_id) returning id into v_trade_id;
    v_remaining := p_quantity;
    for v_listing in
      select l.* from market.listings l
      where l.id = any(v_candidate_ids)
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
    if v_remaining <> 0 then
      perform api.raise_business_error('MARKET_STOCK_INSUFFICIENT', '市场可购买数量不足');
    end if;
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
