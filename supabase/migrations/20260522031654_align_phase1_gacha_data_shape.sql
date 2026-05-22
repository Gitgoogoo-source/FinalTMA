-- Align phase-1 gacha persistence with 第一阶段教学指南.md section 12.
-- This migration keeps the older quantity/opened names readable while making
-- newly completed opens persist as draw_count/completed/open_box_rebate/
-- obtained_from_gacha.

alter table gacha.draw_orders
  add column if not exists draw_count integer;

update gacha.draw_orders
set draw_count = quantity
where draw_count is null;

alter table gacha.draw_orders
  alter column draw_count set not null;

alter table gacha.draw_orders
  drop constraint if exists draw_orders_draw_count_check;

alter table gacha.draw_orders
  add constraint draw_orders_draw_count_check
  check (draw_count in (1, 10));

alter table gacha.draw_orders
  drop constraint if exists draw_orders_status_check;

alter table gacha.draw_orders
  add constraint draw_orders_status_check
  check (status in ('created', 'invoice_created', 'paid', 'opening', 'opened', 'completed', 'cancelled', 'failed', 'expired'));

alter table inventory.item_instance_events
  drop constraint if exists item_instance_events_event_type_check;

alter table inventory.item_instance_events
  add constraint item_instance_events_event_type_check
  check (
    event_type in (
      'created',
      'acquired',
      'obtained_from_gacha',
      'upgraded',
      'evolved_success',
      'evolved_failed_returned',
      'consumed',
      'decomposed',
      'listed',
      'delisted',
      'sold',
      'bought',
      'mint_queued',
      'minted',
      'transferred',
      'admin_adjusted'
    )
  );

create or replace function gacha.set_draw_order_payment_minimum_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity is null and new.draw_count is not null then
    new.quantity := new.draw_count;
  end if;

  if new.draw_count is null and new.quantity is not null then
    new.draw_count := new.quantity;
  end if;

  if new.quantity is distinct from new.draw_count then
    raise exception 'draw_count must match quantity';
  end if;

  if new.status = 'opened' then
    new.status := 'completed';
  end if;

  if new.telegram_invoice_payload is null then
    new.telegram_invoice_payload := new.invoice_payload;
  end if;

  if new.star_amount is null then
    new.star_amount := new.total_price_stars;
  end if;

  if new.payment_provider is null then
    new.payment_provider := case
      when new.payment_star_order_id is null then 'dev'
      else 'telegram_stars'
    end;
  end if;

  if new.telegram_payment_charge_id is not null then
    if new.telegram_payment_charge_id like 'dev:%' then
      new.payment_provider := 'dev';
      new.payment_status := 'dev_paid';
    elsif new.payment_status is null or new.payment_status in ('created', 'pending') then
      new.payment_status := 'paid';
    end if;
  end if;

  if new.payment_status is null then
    new.payment_status := case
      when new.status in ('paid', 'opening', 'completed') then 'paid'
      when new.status = 'invoice_created' then 'pending'
      when new.status in ('failed', 'cancelled', 'expired') then new.status
      else 'created'
    end;
  elsif new.status in ('paid', 'opening', 'completed') and new.payment_status in ('created', 'pending') then
    new.payment_status := 'paid';
  elsif new.status in ('failed', 'cancelled', 'expired') and new.payment_status in ('created', 'pending') then
    new.payment_status := new.status;
  end if;

  return new;
end;
$$;

revoke execute on function gacha.set_draw_order_payment_minimum_fields()
  from public, anon, authenticated;

update gacha.draw_orders
set status = 'completed'
where status = 'opened';

update inventory.item_instance_events
set event_type = 'obtained_from_gacha'
where event_type = 'created'
  and source_type = 'gacha';

create or replace function economy.normalize_phase1_open_box_rebate_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_type = 'gacha_open_reward' then
    new.source_type := 'open_box_rebate';

    if new.source_ref is null or new.source_ref like 'gacha_open_reward:%' then
      new.source_ref := 'open_box_rebate:' || coalesce(new.source_id::text, gen_random_uuid()::text);
    end if;

    if new.idempotency_key like 'gacha_open_reward:%' then
      new.idempotency_key := replace(new.idempotency_key, 'gacha_open_reward:', 'open_box_rebate:');
    end if;

    if new.note = 'Paid box open reward' then
      new.note := 'Open box rebate';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function economy.normalize_phase1_open_box_rebate_ledger()
  from public, anon, authenticated;

drop trigger if exists normalize_phase1_open_box_rebate_ledger on economy.currency_ledger;
create trigger normalize_phase1_open_box_rebate_ledger
before insert on economy.currency_ledger
for each row
execute function economy.normalize_phase1_open_box_rebate_ledger();

create or replace function inventory.normalize_phase1_gacha_item_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type = 'created' and new.source_type = 'gacha' then
    new.event_type := 'obtained_from_gacha';
  end if;

  return new;
end;
$$;

revoke execute on function inventory.normalize_phase1_gacha_item_event()
  from public, anon, authenticated;

drop trigger if exists normalize_phase1_gacha_item_event on inventory.item_instance_events;
create trigger normalize_phase1_gacha_item_event
before insert on inventory.item_instance_events
for each row
execute function inventory.normalize_phase1_gacha_item_event();

create or replace function gacha.require_paid_star_payment_before_opened()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('opened', 'completed')
     and old.status not in ('opened', 'completed') then
    if new.payment_star_order_id is null then
      raise exception 'draw order payment_star_order_id is required before opening';
    end if;

    if not exists (
      select 1
      from payments.star_payments sp
      where sp.star_order_id = new.payment_star_order_id
    ) then
      raise exception 'successful payment not recorded for draw order';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function gacha.require_paid_star_payment_before_opened()
  from public, anon, authenticated;

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
  v_referral_first_open jsonb;
  v_referral_commission jsonb;
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

  if v_order.status in ('opened', 'completed') then
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
      'status', 'completed',
      'draw_count', v_order.draw_count,
      'quantity', v_order.quantity,
      'results', v_results,
      'idempotent', true
    );
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

  if v_box.remaining_stock is not null and v_box.remaining_stock < v_order.draw_count then
    update gacha.draw_orders
    set status = 'failed',
        error_message = 'stock insufficient after payment',
        updated_at = now()
    where id = v_order.id;

    raise exception 'blind box stock is insufficient after payment';
  end if;

  if v_box.remaining_stock is not null then
    update gacha.blind_boxes
    set remaining_stock = remaining_stock - v_order.draw_count,
        status = case when remaining_stock - v_order.draw_count <= 0 then 'sold_out' else status end,
        updated_at = now()
    where id = v_box.id;
  end if;

  for v_draw_i in 1..v_order.draw_count loop
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
      v_item_id, v_order.user_id, 'obtained_from_gacha', 'gacha', v_order.id,
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

  v_reward_kcoin := v_order.open_reward_kcoin * v_order.draw_count;
  if v_reward_kcoin > 0 then
    v_credit := api._credit_balance(
      v_order.user_id,
      'KCOIN',
      v_reward_kcoin,
      'open_box_rebate',
      v_order.id,
      null,
      'open_box_rebate:' || v_order.id::text,
      'Open box rebate',
      jsonb_build_object('draw_order_id', v_order.id, 'draw_count', v_order.draw_count, 'quantity', v_order.quantity)
    );
  end if;

  v_referral_first_open := api.referral_process_first_open(v_order.user_id, v_order.id);
  if v_reward_kcoin > 0 then
    v_referral_commission := api.referral_create_commission(v_order.user_id, v_order.id, v_reward_kcoin, 1000);
  end if;

  insert into gacha.draw_audit (draw_order_id, user_id, pool_version_id, rules_snapshot)
  values (
    v_order.id,
    v_order.user_id,
    v_order.pool_version_id,
    jsonb_build_object('box_id', v_order.box_id, 'draw_count', v_order.draw_count, 'quantity', v_order.quantity, 'open_reward_kcoin', v_order.open_reward_kcoin)
  );

  update gacha.draw_orders
  set status = 'completed', opened_at = now(), updated_at = now()
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
    'status', 'completed',
    'draw_count', v_order.draw_count,
    'quantity', v_order.quantity,
    'results', v_results,
    'kcoin_reward', v_reward_kcoin,
    'kcoin_ledger', v_credit,
    'referral_first_open', coalesce(v_referral_first_open, '{}'::jsonb),
    'referral_commission', coalesce(v_referral_commission, '{}'::jsonb)
  );
end;
$$;

create or replace function api.gacha_get_draw_result(
  p_user_id uuid,
  p_draw_order_id uuid default null,
  p_invoice_payload text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order gacha.draw_orders%rowtype;
  v_results jsonb;
  v_box jsonb;
  v_payment jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_draw_order_id is null and (p_invoice_payload is null or length(trim(p_invoice_payload)) = 0) then
    raise exception 'draw_order_id or invoice_payload is required';
  end if;

  select * into v_order
  from gacha.draw_orders
  where user_id = p_user_id
    and (
      (p_draw_order_id is not null and id = p_draw_order_id)
      or
      (p_invoice_payload is not null and invoice_payload = p_invoice_payload)
    )
  limit 1;

  if v_order.id is null then
    raise exception 'draw order not found';
  end if;

  select jsonb_build_object(
    'id', b.id,
    'slug', b.slug,
    'display_name', b.display_name,
    'tier', b.tier,
    'cover_image_url', b.cover_image_url,
    'hero_image_url', b.hero_image_url
  ) into v_box
  from gacha.blind_boxes b
  where b.id = v_order.box_id;

  select jsonb_build_object(
    'star_order_id', so.id,
    'status', so.status,
    'xtr_amount', so.xtr_amount,
    'paid_at', so.paid_at,
    'fulfilled_at', so.fulfilled_at
  ) into v_payment
  from payments.star_orders so
  where so.id = v_order.payment_star_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_index', dr.draw_index,
    'was_pity', dr.was_pity,
    'random_roll', dr.random_roll,
    'item_instance_id', dr.item_instance_id,
    'template_id', dr.template_id,
    'template_slug', ct.slug,
    'display_name', ct.display_name,
    'subtitle', ct.subtitle,
    'description', ct.description,
    'rarity_code', dr.rarity_code,
    'rarity_display_name', r.display_name,
    'type_code', ct.type_code,
    'form_id', dr.form_id,
    'form_index', cf.form_index,
    'form_name', cf.display_name,
    'serial_no', ii.serial_no,
    'level', ii.level,
    'power', ii.power,
    'image_url', coalesce(cf.image_url, cm_hero.url, cm_card.url),
    'thumbnail_url', coalesce(cf.thumbnail_url, cm_thumb.url, cm_card.url),
    'avatar_url', coalesce(cf.avatar_url, cm_avatar.url, cm_thumb.url)
  ) order by dr.draw_index), '[]'::jsonb)
  into v_results
  from gacha.draw_results dr
  join catalog.collectible_templates ct on ct.id = dr.template_id
  join catalog.rarities r on r.code = dr.rarity_code
  left join catalog.collectible_forms cf on cf.id = dr.form_id
  left join inventory.item_instances ii on ii.id = dr.item_instance_id
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'hero'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_hero on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'card'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_card on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'thumb'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_thumb on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'avatar'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_avatar on true
  where dr.draw_order_id = v_order.id;

  return jsonb_build_object(
    'draw_order_id', v_order.id,
    'status', case when v_order.status = 'opened' then 'completed' else v_order.status end,
    'draw_count', v_order.draw_count,
    'quantity', v_order.quantity,
    'unit_price_stars', v_order.unit_price_stars,
    'discount_bps', v_order.discount_bps,
    'total_price_stars', v_order.total_price_stars,
    'open_reward_kcoin', v_order.open_reward_kcoin,
    'invoice_payload', v_order.invoice_payload,
    'paid_at', v_order.paid_at,
    'opened_at', v_order.opened_at,
    'completed_at', v_order.opened_at,
    'box', v_box,
    'payment', v_payment,
    'results', v_results,
    'server_time', now()
  );
end;
$$;

grant execute on function api.gacha_process_paid_order(uuid, text, text, jsonb) to service_role;
grant execute on function api.gacha_get_draw_result(uuid, uuid, text) to service_role;
