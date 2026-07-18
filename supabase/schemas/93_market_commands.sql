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
    if p_quantity <= 0 or inventory.available_quantity(v_user_id, p_template_id) < p_quantity then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':market-listings', 0));
    select count(distinct template_id) into v_active_count from market.listings where seller_id = v_user_id and status = 'active';
    if v_active_count >= 50 and not exists (select 1 from market.listings where seller_id = v_user_id and template_id = p_template_id and status = 'active') then
      perform api.raise_business_error('MARKET_ACTIVE_TEMPLATE_LIMIT', '在售藏品种类已达上限');
    end if;
    insert into market.listings (seller_id, template_id, unit_price, quantity, remaining, operation_id)
    values (v_user_id, p_template_id, v_template.market_price, p_quantity, p_quantity, p_operation_id) returning * into v_listing;
    insert into inventory.reservations (user_id, template_id, quantity, kind, reference_id)
    values (v_user_id, p_template_id, p_quantity, 'listing', v_listing.id);
    perform tasks.progress(v_user_id, 'market_list');
    v_result := jsonb_build_object('listing_id', v_listing.id, 'template_id', p_template_id, 'name', v_template.name, 'rarity', v_template.rarity, 'image_path', v_template.image_path, 'quantity', p_quantity, 'unit_price', v_template.market_price, 'created_at', v_listing.created_at);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.market_cancel_listing(
  p_session_id uuid,
  p_operation_id uuid,
  p_listing_id uuid
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
  v_listing market.listings%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'market.cancel_listing', p_operation_id, jsonb_build_object('listing_id', p_listing_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_listing from market.listings where id = p_listing_id and seller_id = v_user_id for update;
    if v_listing.id is null then perform api.raise_business_error('LISTING_NOT_FOUND', '挂单不存在'); end if;
    if v_listing.status <> 'active' or v_listing.remaining <= 0 then perform api.raise_business_error('LISTING_NOT_CANCELLABLE', '挂单不可下架'); end if;
    update market.listings set status = 'cancelled', remaining = 0, updated_at = now() where id = p_listing_id;
    update inventory.reservations set status = 'released', released_at = now() where kind = 'listing' and reference_id = p_listing_id and status = 'active';
    v_result := jsonb_build_object('listing_id', p_listing_id, 'status', 'cancelled', 'released_quantity', v_listing.remaining);
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
      perform inventory.change_holding(v_listing.seller_id, p_template_id, -v_take);
      perform economy.change_balance(v_listing.seller_id, 'KCOIN', v_gross - v_fee + v_rebate, 'market_sale', p_operation_id, v_trade_id::text);
      insert into market.trade_details (trade_id, listing_id, seller_id, quantity, gross, fee, seller_net, vip_rebate)
      values (v_trade_id, v_listing.id, v_listing.seller_id, v_take, v_gross, v_fee, v_gross - v_fee, v_rebate);
      if v_take = v_listing.remaining then
        update market.listings set remaining = 0, status = 'sold', updated_at = now() where id = v_listing.id;
        update inventory.reservations set status = 'consumed', released_at = now() where kind = 'listing' and reference_id = v_listing.id and status = 'active';
      else
        update market.listings set remaining = remaining - v_take, updated_at = now() where id = v_listing.id;
        update inventory.reservations set quantity = quantity - v_take where kind = 'listing' and reference_id = v_listing.id and status = 'active';
      end if;
      v_details := v_details || jsonb_build_array(jsonb_build_object('seller_id', v_listing.seller_id, 'quantity', v_take, 'gross', v_gross, 'fee', v_fee, 'vip_rebate', v_rebate, 'seller_credit', v_gross - v_fee + v_rebate));
      perform tasks.progress(v_listing.seller_id, 'market_sold');
      v_remaining := v_remaining - v_take;
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
