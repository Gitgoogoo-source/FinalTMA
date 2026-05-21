-- 0014_create_rpc_gacha.sql
-- RPC functions for creating Stars-backed gacha orders and fulfilling paid draw orders.

create or replace function api.gacha_create_order(
  p_user_id uuid,
  p_box_id uuid,
  p_quantity integer,
  p_idempotency_key text
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
  v_draw_order_id uuid := gen_random_uuid();
  v_star_order_id uuid := gen_random_uuid();
  v_payload text;
begin
  if p_user_id is null or p_box_id is null then
    raise exception 'user_id and box_id are required';
  end if;
  if p_quantity not in (1, 10) then
    raise exception 'quantity must be 1 or 10';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  select * into v_existing_order
  from gacha.draw_orders
  where idempotency_key = p_idempotency_key;

  if v_existing_order.id is not null then
    return jsonb_build_object(
      'draw_order_id', v_existing_order.id,
      'star_order_id', v_existing_order.payment_star_order_id,
      'invoice_payload', v_existing_order.invoice_payload,
      'xtr_amount', v_existing_order.total_price_stars,
      'status', v_existing_order.status,
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
  v_payload := 'gacha:' || v_draw_order_id::text;

  insert into payments.star_orders (
    id, user_id, business_type, business_id, status, xtr_amount,
    telegram_invoice_payload, title, description, idempotency_key, expires_at, metadata
  ) values (
    v_star_order_id, p_user_id, 'gacha_open', v_draw_order_id, 'created', v_total_price,
    v_payload, v_box.display_name, 'Open blind box x' || p_quantity::text, p_idempotency_key,
    now() + interval '15 minutes',
    jsonb_build_object('box_id', p_box_id, 'quantity', p_quantity, 'pool_version_id', v_pool.id)
  );

  insert into gacha.draw_orders (
    id, user_id, box_id, pool_version_id, payment_star_order_id, status,
    quantity, unit_price_stars, discount_bps, total_price_stars,
    open_reward_kcoin, invoice_payload, idempotency_key, metadata
  ) values (
    v_draw_order_id, p_user_id, p_box_id, v_pool.id, v_star_order_id, 'invoice_created',
    p_quantity, v_unit_price, v_discount_bps, v_total_price,
    v_box.open_reward_kcoin, v_payload, p_idempotency_key,
    jsonb_build_object('box_slug', v_box.slug, 'box_tier', v_box.tier)
  );

  return jsonb_build_object(
    'draw_order_id', v_draw_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', v_total_price,
    'quantity', p_quantity,
    'discount_bps', v_discount_bps,
    'idempotent', false
  );
end;
$$;

create or replace function api.gacha_process_paid_order(
  p_star_order_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_raw_update jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_star_order payments.star_orders%rowtype;
  v_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_draw_i integer;
  v_pity record;
  v_use_pity boolean;
  v_reward record;
  v_total_weight numeric(38,8);
  v_roll numeric(38,8);
  v_form_id uuid;
  v_power integer;
  v_item_id uuid;
  v_should_reset boolean;
  v_reward_kcoin numeric(38,0);
  v_results jsonb;
  v_credit jsonb;
begin
  if p_star_order_id is null or p_telegram_payment_charge_id is null then
    raise exception 'star_order_id and telegram_payment_charge_id are required';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  if v_star_order.id is null then
    raise exception 'star order not found';
  end if;

  select * into v_order
  from gacha.draw_orders
  where payment_star_order_id = p_star_order_id
  for update;

  if v_order.id is null then
    raise exception 'draw order not found for star order';
  end if;

  if v_order.status = 'opened' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'draw_index', dr.draw_index,
      'template_id', dr.template_id,
      'form_id', dr.form_id,
      'rarity_code', dr.rarity_code,
      'item_instance_id', dr.item_instance_id,
      'was_pity', dr.was_pity
    ) order by dr.draw_index), '[]'::jsonb)
    into v_results
    from gacha.draw_results dr
    where dr.draw_order_id = v_order.id;

    return jsonb_build_object('draw_order_id', v_order.id, 'status', 'opened', 'results', v_results, 'idempotent', true);
  end if;

  if v_star_order.xtr_amount <> v_order.total_price_stars then
    raise exception 'payment amount mismatch';
  end if;

  insert into payments.star_payments (
    star_order_id, user_id, telegram_payment_charge_id, provider_payment_charge_id,
    xtr_amount, currency, invoice_payload, raw_update
  ) values (
    p_star_order_id, v_order.user_id, p_telegram_payment_charge_id, p_provider_payment_charge_id,
    v_star_order.xtr_amount, 'XTR', v_order.invoice_payload, coalesce(p_raw_update, '{}'::jsonb)
  )
  on conflict (telegram_payment_charge_id) do nothing;

  update payments.star_orders
  set status = 'paid', paid_at = coalesce(paid_at, now()), updated_at = now()
  where id = p_star_order_id;

  update gacha.draw_orders
  set status = 'opening', paid_at = coalesce(paid_at, now()), updated_at = now()
  where id = v_order.id;

  select * into v_box
  from gacha.blind_boxes
  where id = v_order.box_id
  for update;

  if v_box.remaining_stock is not null and v_box.remaining_stock < v_order.quantity then
    update gacha.draw_orders set status = 'failed', error_message = 'stock insufficient after payment', updated_at = now() where id = v_order.id;
    raise exception 'blind box stock is insufficient after payment';
  end if;

  if v_box.remaining_stock is not null then
    update gacha.blind_boxes
    set remaining_stock = remaining_stock - v_order.quantity,
        status = case when remaining_stock - v_order.quantity <= 0 then 'sold_out' else status end,
        updated_at = now()
    where id = v_box.id;
  end if;

  for v_draw_i in 1..v_order.quantity loop
    select null::uuid as id into v_reward;
    select null::uuid as id, 0::integer as current_count into v_pity;
    v_use_pity := false;

    select pr.*, coalesce(ups.current_count, 0) as current_count
    into v_pity
    from gacha.pity_rules pr
    left join gacha.user_pity_states ups
      on ups.pity_rule_id = pr.id and ups.user_id = v_order.user_id and ups.box_id = v_order.box_id
    where pr.box_id = v_order.box_id
      and pr.active = true
      and (pr.pool_version_id is null or pr.pool_version_id = v_order.pool_version_id)
    order by pr.priority asc, pr.created_at asc
    limit 1;

    if v_pity.id is not null then
      insert into gacha.user_pity_states (user_id, box_id, pity_rule_id, current_count, total_draws)
      values (v_order.user_id, v_order.box_id, v_pity.id, 0, 0)
      on conflict (user_id, box_id, pity_rule_id) do nothing;

      select pr.*, ups.current_count
      into v_pity
      from gacha.pity_rules pr
      join gacha.user_pity_states ups
        on ups.pity_rule_id = pr.id and ups.user_id = v_order.user_id and ups.box_id = v_order.box_id
      where pr.id = v_pity.id
      for update of ups;

      v_use_pity := (v_pity.current_count + 1 >= v_pity.threshold);
    end if;

    if v_use_pity and v_pity.guaranteed_template_id is not null then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = v_order.pool_version_id
        and dpi.template_id = v_pity.guaranteed_template_id
        and (v_pity.guaranteed_form_id is null or dpi.form_id = v_pity.guaranteed_form_id)
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by dpi.sort_order asc, random()
      limit 1;
    elsif v_use_pity then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      join catalog.rarities rr on rr.code = dpi.rarity_code
      join catalog.rarities target on target.code = v_pity.target_rarity_code
      where dpi.pool_version_id = v_order.pool_version_id
        and dpi.is_pity_eligible = true
        and rr.sort_order >= target.sort_order
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by rr.sort_order desc, dpi.drop_weight desc, random()
      limit 1;
    end if;

    if v_reward.id is null then
      select coalesce(sum(drop_weight), 0) into v_total_weight
      from gacha.drop_pool_items
      where pool_version_id = v_order.pool_version_id
        and (stock_remaining is null or stock_remaining > 0);

      if v_total_weight <= 0 then
        raise exception 'drop pool has no available rewards';
      end if;

      v_roll := (random()::numeric * v_total_weight);

      select x.* into v_reward
      from (
        select dpi.*,
               sum(dpi.drop_weight) over (order by dpi.sort_order asc, dpi.id asc) as running_weight
        from gacha.drop_pool_items dpi
        where dpi.pool_version_id = v_order.pool_version_id
          and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      ) x
      where x.running_weight >= v_roll
      order by x.running_weight asc
      limit 1;
    else
      v_roll := null;
    end if;

    if v_reward.id is null then
      raise exception 'failed to select reward';
    end if;

    if v_reward.stock_remaining is not null then
      update gacha.drop_pool_items
      set stock_remaining = stock_remaining - 1,
          updated_at = now()
      where id = v_reward.id and stock_remaining > 0;
    end if;

    v_form_id := v_reward.form_id;
    if v_form_id is null then
      select id into v_form_id
      from catalog.collectible_forms
      where template_id = v_reward.template_id
      order by is_default desc, form_index asc
      limit 1;
    end if;

    select ct.base_power + coalesce(cf.base_power_bonus, 0)
    into v_power
    from catalog.collectible_templates ct
    left join catalog.collectible_forms cf on cf.id = v_form_id
    where ct.id = v_reward.template_id;

    insert into inventory.item_instances (
      owner_user_id, template_id, form_id, level, power, status,
      source_type, source_id, metadata
    ) values (
      v_order.user_id, v_reward.template_id, v_form_id, 1, coalesce(v_power, 0), 'available',
      'gacha', v_order.id,
      jsonb_build_object('box_id', v_order.box_id, 'draw_order_id', v_order.id, 'drop_pool_item_id', v_reward.id)
    ) returning id into v_item_id;

    insert into inventory.item_instance_events (
      item_instance_id, user_id, event_type, source_type, source_id, after_state
    ) values (
      v_item_id, v_order.user_id, 'created', 'gacha', v_order.id,
      jsonb_build_object('template_id', v_reward.template_id, 'form_id', v_form_id, 'rarity_code', v_reward.rarity_code)
    );

    insert into album.user_discoveries (
      user_id, template_id, first_item_instance_id, first_source_type, first_source_id
    ) values (
      v_order.user_id, v_reward.template_id, v_item_id, 'gacha', v_order.id
    ) on conflict (user_id, template_id) do nothing;

    insert into gacha.draw_results (
      draw_order_id, user_id, box_id, pool_version_id, draw_index,
      drop_pool_item_id, item_instance_id, template_id, form_id, rarity_code,
      was_pity, random_roll, metadata
    ) values (
      v_order.id, v_order.user_id, v_order.box_id, v_order.pool_version_id, v_draw_i,
      v_reward.id, v_item_id, v_reward.template_id, v_form_id, v_reward.rarity_code,
      v_use_pity, v_roll,
      jsonb_build_object('serial_item_id', v_item_id)
    );

    if v_pity.id is not null then
      select exists (
        select 1
        from catalog.rarities got
        join catalog.rarities target on target.code = coalesce(v_pity.reset_on_rarity_code, v_pity.target_rarity_code)
        where got.code = v_reward.rarity_code and got.sort_order >= target.sort_order
      ) into v_should_reset;

      update gacha.user_pity_states
      set current_count = case when v_should_reset then 0 else current_count + 1 end,
          total_draws = total_draws + 1,
          last_hit_at = case when v_should_reset then now() else last_hit_at end,
          updated_at = now()
      where user_id = v_order.user_id and box_id = v_order.box_id and pity_rule_id = v_pity.id;
    end if;
  end loop;

  v_reward_kcoin := v_order.open_reward_kcoin * v_order.quantity;
  if v_reward_kcoin > 0 then
    v_credit := api._credit_balance(
      v_order.user_id,
      'KCOIN',
      v_reward_kcoin,
      'gacha_open_reward',
      v_order.id,
      null,
      'gacha_open_reward:' || v_order.id::text,
      'Paid box open reward',
      jsonb_build_object('draw_order_id', v_order.id, 'quantity', v_order.quantity)
    );
  end if;

  insert into gacha.draw_audit (draw_order_id, user_id, pool_version_id, rules_snapshot)
  values (
    v_order.id,
    v_order.user_id,
    v_order.pool_version_id,
    jsonb_build_object('box_id', v_order.box_id, 'quantity', v_order.quantity, 'open_reward_kcoin', v_order.open_reward_kcoin)
  );

  update gacha.draw_orders
  set status = 'opened', opened_at = now(), updated_at = now()
  where id = v_order.id;

  update payments.star_orders
  set status = 'fulfilled', fulfilled_at = now(), updated_at = now()
  where id = p_star_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_index', dr.draw_index,
    'template_id', dr.template_id,
    'form_id', dr.form_id,
    'rarity_code', dr.rarity_code,
    'item_instance_id', dr.item_instance_id,
    'was_pity', dr.was_pity
  ) order by dr.draw_index), '[]'::jsonb)
  into v_results
  from gacha.draw_results dr
  where dr.draw_order_id = v_order.id;

  return jsonb_build_object(
    'draw_order_id', v_order.id,
    'status', 'opened',
    'results', v_results,
    'kcoin_reward', v_reward_kcoin,
    'kcoin_ledger', v_credit
  );
end;
$$;
