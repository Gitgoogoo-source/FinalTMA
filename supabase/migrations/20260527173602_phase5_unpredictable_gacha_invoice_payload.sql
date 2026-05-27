-- Phase 5 step 04: make new Telegram Stars invoice payloads unpredictable.
--
-- Historical fulfilled orders are intentionally left unchanged. The new RPC
-- body keeps the existing idempotency contract and only changes payload
-- generation for newly created orders.

create or replace function api.gacha_create_order_checked(
  p_user_id uuid,
  p_box_id uuid,
  p_quantity integer,
  p_idempotency_key text,
  p_expected_price_stars integer,
  p_expected_pool_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_pool gacha.drop_pool_versions%rowtype;
  v_unit_price integer;
  v_discount_bps integer;
  v_total_price integer;
  v_draw_order_id uuid := pg_catalog.gen_random_uuid();
  v_star_order_id uuid := pg_catalog.gen_random_uuid();
  v_payload text;
  v_idempotency_key text;
  v_expires_at timestamptz;
begin
  if p_user_id is null or p_box_id is null then
    raise exception 'user_id and box_id are required';
  end if;
  if p_quantity not in (1, 10) then
    raise exception 'quantity must be 1 or 10';
  end if;

  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  if v_idempotency_key is null then
    raise exception 'idempotency_key is required';
  end if;

  if p_expected_price_stars is not null and p_expected_price_stars <= 0 then
    raise exception 'expected price stars must be positive';
  end if;

  select * into v_existing_order
  from gacha.draw_orders
  where idempotency_key = v_idempotency_key
  for update;

  if v_existing_order.id is not null then
    if v_existing_order.user_id <> p_user_id
      or v_existing_order.box_id <> p_box_id
      or v_existing_order.quantity <> p_quantity then
      raise exception 'idempotency key conflict';
    end if;

    if p_expected_price_stars is not null
      and v_existing_order.total_price_stars <> p_expected_price_stars then
      raise exception 'expected price changed';
    end if;

    if p_expected_pool_version_id is not null
      and v_existing_order.pool_version_id <> p_expected_pool_version_id then
      raise exception 'expected pool version changed';
    end if;

    select so.expires_at into v_expires_at
    from payments.star_orders so
    where so.id = v_existing_order.payment_star_order_id;

    return jsonb_build_object(
      'draw_order_id', v_existing_order.id,
      'star_order_id', v_existing_order.payment_star_order_id,
      'invoice_payload', v_existing_order.invoice_payload,
      'xtr_amount', v_existing_order.total_price_stars,
      'quantity', v_existing_order.quantity,
      'draw_count', coalesce(v_existing_order.draw_count, v_existing_order.quantity),
      'discount_bps', v_existing_order.discount_bps,
      'pool_version_id', v_existing_order.pool_version_id,
      'status', v_existing_order.status,
      'payment_status', v_existing_order.payment_status,
      'expires_at', v_expires_at,
      'idempotent', true
    );
  end if;

  select * into v_box
  from gacha.blind_boxes
  where id = p_box_id
  for update;

  if v_box.id is null then
    raise exception 'blind box not found';
  end if;
  if v_box.status <> 'active' then
    raise exception 'blind box is not active: %', v_box.status;
  end if;
  if v_box.starts_at is not null and v_box.starts_at > now() then
    raise exception 'blind box has not started';
  end if;
  if v_box.ends_at is not null and v_box.ends_at <= now() then
    raise exception 'blind box has ended';
  end if;
  if v_box.remaining_stock is not null and v_box.remaining_stock < p_quantity then
    raise exception 'blind box stock is insufficient';
  end if;

  select * into v_pool
  from gacha.drop_pool_versions
  where box_id = p_box_id
    and status = 'active'
    and (effective_from is null or effective_from <= now())
    and (effective_to is null or effective_to > now())
  order by version_no desc
  limit 1;

  if v_pool.id is null then
    raise exception 'active drop pool not found';
  end if;

  if p_expected_pool_version_id is not null
    and v_pool.id <> p_expected_pool_version_id then
    raise exception 'expected pool version changed';
  end if;

  select
    coalesce(price_stars_override, v_box.price_stars),
    discount_bps
  into v_unit_price, v_discount_bps
  from gacha.box_price_rules
  where box_id = p_box_id
    and quantity = p_quantity
    and active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_unit_price is null then
    v_unit_price := v_box.price_stars;
    v_discount_bps := case when p_quantity = 10 then 1000 else 0 end;
  end if;

  v_total_price := ceil((v_unit_price * p_quantity)::numeric * (10000 - v_discount_bps)::numeric / 10000)::integer;

  if p_expected_price_stars is not null
    and v_total_price <> p_expected_price_stars then
    raise exception 'expected price changed';
  end if;

  v_payload :=
    'gacha_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_expires_at := now() + interval '15 minutes';

  insert into payments.star_orders (
    id, user_id, business_type, business_id, status, xtr_amount,
    telegram_invoice_payload, title, description, idempotency_key, expires_at, metadata
  ) values (
    v_star_order_id, p_user_id, 'gacha_open', v_draw_order_id, 'created', v_total_price,
    v_payload, v_box.display_name, 'Open blind box x' || p_quantity::text, v_idempotency_key,
    v_expires_at,
    jsonb_build_object('box_id', p_box_id, 'quantity', p_quantity, 'pool_version_id', v_pool.id)
  );

  insert into gacha.draw_orders (
    id, user_id, box_id, pool_version_id, payment_star_order_id, status,
    quantity, unit_price_stars, discount_bps, total_price_stars,
    open_reward_kcoin, invoice_payload, idempotency_key, metadata
  ) values (
    v_draw_order_id, p_user_id, p_box_id, v_pool.id, v_star_order_id, 'invoice_created',
    p_quantity, v_unit_price, v_discount_bps, v_total_price,
    v_box.open_reward_kcoin, v_payload, v_idempotency_key,
    jsonb_build_object('box_slug', v_box.slug, 'box_tier', v_box.tier)
  );

  return jsonb_build_object(
    'draw_order_id', v_draw_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', v_total_price,
    'quantity', p_quantity,
    'draw_count', p_quantity,
    'discount_bps', v_discount_bps,
    'pool_version_id', v_pool.id,
    'status', 'invoice_created',
    'payment_status', 'pending',
    'expires_at', v_expires_at,
    'idempotent', false
  );
end;
$$;

revoke execute on function api.gacha_create_order_checked(uuid, uuid, integer, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function api.gacha_create_order_checked(uuid, uuid, integer, text, integer, uuid)
  to service_role;
