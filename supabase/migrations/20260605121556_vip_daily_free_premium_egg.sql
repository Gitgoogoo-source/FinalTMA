-- VIP daily welfare egg.
--
-- This migration keeps paid gacha orders protected by the existing Stars
-- payment guard, while allowing one trusted VIP daily free premium_egg open.

begin;

alter table gacha.draw_orders
  drop constraint if exists draw_orders_unit_price_stars_check,
  drop constraint if exists draw_orders_total_price_stars_check,
  drop constraint if exists draw_orders_star_amount_check,
  drop constraint if exists draw_orders_payment_provider_check;

alter table gacha.draw_orders
  add constraint draw_orders_unit_price_stars_check
  check (unit_price_stars >= 0),
  add constraint draw_orders_total_price_stars_check
  check (total_price_stars >= 0),
  add constraint draw_orders_star_amount_check
  check (star_amount is null or star_amount >= 0),
  add constraint draw_orders_payment_provider_check
  check (
    payment_provider is null
    or payment_provider in ('dev', 'telegram_stars', 'vip_daily_free')
  );

create or replace function gacha.set_draw_order_payment_minimum_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.telegram_invoice_payload is null then
    new.telegram_invoice_payload := new.invoice_payload;
  end if;

  if new.star_amount is null then
    new.star_amount := new.total_price_stars;
  end if;

  if new.payment_provider is null then
    new.payment_provider := case
      when coalesce(new.metadata ->> 'source_type', '') = 'vip_daily_free_box' then 'vip_daily_free'
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
      when coalesce(new.metadata ->> 'source_type', '') = 'vip_daily_free_box'
           and new.total_price_stars = 0 then 'paid'
      when new.status in ('paid', 'opening', 'opened', 'completed') then 'paid'
      when new.status = 'invoice_created' then 'pending'
      when new.status in ('failed', 'cancelled', 'expired') then new.status
      else 'created'
    end;
  elsif new.status in ('paid', 'opening', 'opened', 'completed')
        and new.payment_status in ('created', 'pending') then
    new.payment_status := 'paid';
  elsif new.status in ('failed', 'cancelled', 'expired')
        and new.payment_status in ('created', 'pending') then
    new.payment_status := new.status;
  end if;

  return new;
end;
$$;

revoke execute on function gacha.set_draw_order_payment_minimum_fields()
  from public, anon, authenticated;

create or replace function gacha.require_paid_star_payment_before_opened()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('opened', 'completed')
     and old.status not in ('opened', 'completed') then
    if new.payment_star_order_id is null then
      if new.total_price_stars = 0
         and coalesce(new.star_amount, 0) = 0
         and new.payment_provider = 'vip_daily_free'
         and new.payment_status = 'paid'
         and coalesce(new.metadata ->> 'source_type', '') = 'vip_daily_free_box' then
        return new;
      end if;

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

create or replace function api.vip_open_daily_free_premium_egg(
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_scoped_key text;
  v_today date := (now() at time zone 'UTC')::date;
  v_user_status text;
  v_subscription vip.vip_subscriptions%rowtype;
  v_claim vip.vip_daily_claims%rowtype;
  v_existing_ledger vip.vip_benefit_ledger%rowtype;
  v_existing_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_pool gacha.drop_pool_versions%rowtype;
  v_draw_order_id uuid := pg_catalog.gen_random_uuid();
  v_invoice_payload text;
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
  v_results jsonb := '[]'::jsonb;
  v_referral_first_open jsonb := '{}'::jsonb;
  v_progress_result jsonb := '{}'::jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;

  v_scoped_key := 'vip:free_premium_egg:' || v_key;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_open_daily_free_premium_egg'),
    pg_catalog.hashtext(p_user_id::text || ':' || v_today::text)
  );

  select status into v_user_status
  from core.users
  where id = p_user_id
  for update;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  select * into v_existing_ledger
  from vip.vip_benefit_ledger
  where idempotency_key = v_scoped_key
  for update;

  if v_existing_ledger.id is not null then
    if v_existing_ledger.user_id <> p_user_id
       or v_existing_ledger.benefit_type <> 'daily_free_box'
       or v_existing_ledger.entry_type <> 'consume' then
      raise exception 'idempotency key conflict';
    end if;

    select * into v_existing_order
    from gacha.draw_orders
    where id = nullif(v_existing_ledger.metadata ->> 'draw_order_id', '')::uuid;

    select * into v_claim
    from vip.vip_daily_claims
    where id = v_existing_ledger.source_id;

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
    where dr.draw_order_id = v_existing_order.id;

    return jsonb_build_object(
      'draw_order_id', v_existing_order.id,
      'box_slug', 'premium_egg',
      'status', coalesce(v_existing_order.status, 'completed'),
      'payment_status', 'vip_daily_free',
      'draw_count', coalesce(v_existing_order.draw_count, v_existing_order.quantity, 1),
      'quantity', coalesce(v_existing_order.quantity, 1),
      'xtr_amount', 0,
      'total_price_stars', 0,
      'claim_id', v_claim.id,
      'free_box_count', coalesce(v_claim.free_box_count, 0),
      'free_box_used_count', coalesce(v_claim.free_box_used_count, 0),
      'consume_ledger_id', v_existing_ledger.id,
      'results', coalesce(v_results, '[]'::jsonb),
      'idempotent', true,
      'result_ready', v_existing_order.status in ('opened', 'completed')
    );
  end if;

  select * into v_subscription
  from vip.vip_subscriptions
  where user_id = p_user_id
    and status = 'active'
    and current_period_end > now()
  order by current_period_end desc
  limit 1
  for update;

  if v_subscription.id is null then
    raise exception 'VIP_EXPIRED';
  end if;

  if not exists (
    select 1
    from vip.vip_daily_claims
    where user_id = p_user_id
      and claim_date = v_today
  ) then
    perform api.vip_claim_daily_benefit(
      p_user_id,
      'vip:auto_claim_free_box:' || p_user_id::text || ':' || v_today::text
    );
  end if;

  select * into v_claim
  from vip.vip_daily_claims
  where user_id = p_user_id
    and claim_date = v_today
  for update;

  if v_claim.id is null then
    raise exception 'VIP_DAILY_BENEFIT_NOT_CLAIMED';
  end if;
  if v_claim.free_box_count <= 0 then
    raise exception 'VIP_FREE_BOX_NOT_AVAILABLE';
  end if;
  if v_claim.free_box_used_count >= v_claim.free_box_count then
    raise exception 'VIP_FREE_BOX_ALREADY_USED';
  end if;

  select * into v_box
  from gacha.blind_boxes
  where slug = 'premium_egg'
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
  if v_box.remaining_stock is not null and v_box.remaining_stock <= 0 then
    raise exception 'stock is insufficient';
  end if;

  select * into v_pool
  from gacha.drop_pool_versions
  where box_id = v_box.id
    and status = 'active'
    and (effective_from is null or effective_from <= now())
    and (effective_to is null or effective_to > now())
  order by version_no desc
  limit 1;

  if v_pool.id is null then
    raise exception 'active drop pool not found';
  end if;

  v_invoice_payload :=
    'vipfree_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into gacha.draw_orders (
    id,
    user_id,
    box_id,
    pool_version_id,
    payment_star_order_id,
    status,
    quantity,
    draw_count,
    unit_price_stars,
    discount_bps,
    total_price_stars,
    open_reward_kcoin,
    invoice_payload,
    idempotency_key,
    paid_at,
    payment_provider,
    payment_status,
    star_amount,
    metadata
  ) values (
    v_draw_order_id,
    p_user_id,
    v_box.id,
    v_pool.id,
    null,
    'opening',
    1,
    1,
    0,
    0,
    0,
    0,
    v_invoice_payload,
    v_scoped_key,
    now(),
    'vip_daily_free',
    'paid',
    0,
    jsonb_build_object(
      'source_type', 'vip_daily_free_box',
      'box_slug', v_box.slug,
      'box_tier', v_box.tier,
      'claim_id', v_claim.id,
      'subscription_id', v_claim.subscription_id,
      'price_source', 'vip_daily_free'
    )
  )
  returning * into v_existing_order;

  for v_draw_i in 1..1 loop
    select null::uuid as id into v_reward;
    select null::uuid as id, 0::integer as current_count into v_pity;
    v_use_pity := false;

    select pr.*, coalesce(ups.current_count, 0) as current_count
    into v_pity
    from gacha.pity_rules pr
    left join gacha.user_pity_states ups
      on ups.pity_rule_id = pr.id
     and ups.user_id = p_user_id
     and ups.box_id = v_box.id
    where pr.box_id = v_box.id
      and pr.active = true
      and (pr.pool_version_id is null or pr.pool_version_id = v_pool.id)
    order by pr.priority asc, pr.created_at asc
    limit 1;

    if v_pity.id is not null then
      insert into gacha.user_pity_states (
        user_id,
        box_id,
        pity_rule_id,
        current_count,
        total_draws
      ) values (
        p_user_id,
        v_box.id,
        v_pity.id,
        0,
        0
      )
      on conflict (user_id, box_id, pity_rule_id) do nothing;

      select pr.*, ups.current_count
      into v_pity
      from gacha.pity_rules pr
      join gacha.user_pity_states ups
        on ups.pity_rule_id = pr.id
       and ups.user_id = p_user_id
       and ups.box_id = v_box.id
      where pr.id = v_pity.id
      for update of ups;

      v_use_pity := (v_pity.current_count + 1 >= v_pity.threshold);
    end if;

    if v_use_pity and v_pity.guaranteed_template_id is not null then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = v_pool.id
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
      where dpi.pool_version_id = v_pool.id
        and dpi.is_pity_eligible = true
        and rr.sort_order >= target.sort_order
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by rr.sort_order desc, dpi.drop_weight desc, random()
      limit 1;
    end if;

    if v_reward.id is null then
      select coalesce(sum(drop_weight), 0) into v_total_weight
      from gacha.drop_pool_items
      where pool_version_id = v_pool.id
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
        where dpi.pool_version_id = v_pool.id
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
      where id = v_reward.id
        and stock_remaining > 0
      returning * into v_reward;

      if not found then
        raise exception 'stock is insufficient';
      end if;
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
      owner_user_id,
      template_id,
      form_id,
      level,
      power,
      status,
      source_type,
      source_id,
      metadata
    ) values (
      p_user_id,
      v_reward.template_id,
      v_form_id,
      1,
      coalesce(v_power, 0),
      'available',
      'gacha',
      v_draw_order_id,
      jsonb_build_object(
        'box_id', v_box.id,
        'draw_order_id', v_draw_order_id,
        'drop_pool_item_id', v_reward.id,
        'source_type', 'vip_daily_free_box',
        'claim_id', v_claim.id
      )
    )
    returning id into v_item_id;

    insert into inventory.item_instance_events (
      item_instance_id,
      user_id,
      event_type,
      source_type,
      source_id,
      after_state
    ) values (
      v_item_id,
      p_user_id,
      'obtained_from_gacha',
      'gacha',
      v_draw_order_id,
      jsonb_build_object(
        'template_id', v_reward.template_id,
        'form_id', v_form_id,
        'rarity_code', v_reward.rarity_code,
        'source_type', 'vip_daily_free_box'
      )
    );

    insert into album.user_discoveries (
      user_id,
      template_id,
      first_item_instance_id,
      first_source_type,
      first_source_id
    ) values (
      p_user_id,
      v_reward.template_id,
      v_item_id,
      'gacha',
      v_draw_order_id
    ) on conflict (user_id, template_id) do nothing;

    insert into gacha.draw_results (
      draw_order_id,
      user_id,
      box_id,
      pool_version_id,
      draw_index,
      drop_pool_item_id,
      item_instance_id,
      template_id,
      form_id,
      rarity_code,
      was_pity,
      random_roll,
      metadata
    ) values (
      v_draw_order_id,
      p_user_id,
      v_box.id,
      v_pool.id,
      v_draw_i,
      v_reward.id,
      v_item_id,
      v_reward.template_id,
      v_form_id,
      v_reward.rarity_code,
      v_use_pity,
      v_roll,
      jsonb_build_object(
        'serial_item_id', v_item_id,
        'source_type', 'vip_daily_free_box',
        'claim_id', v_claim.id
      )
    );

    if v_pity.id is not null then
      select exists (
        select 1
        from catalog.rarities got
        join catalog.rarities target
          on target.code = coalesce(v_pity.reset_on_rarity_code, v_pity.target_rarity_code)
        where got.code = v_reward.rarity_code
          and got.sort_order >= target.sort_order
      ) into v_should_reset;

      update gacha.user_pity_states
      set current_count = case when v_should_reset then 0 else current_count + 1 end,
          total_draws = total_draws + 1,
          last_hit_at = case when v_should_reset then now() else last_hit_at end,
          updated_at = now()
      where user_id = p_user_id
        and box_id = v_box.id
        and pity_rule_id = v_pity.id;
    end if;
  end loop;

  update vip.vip_daily_claims
  set free_box_used_count = free_box_used_count + 1,
      free_box_used_at = now(),
      status = case
        when free_box_used_count + 1 >= free_box_count then 'used'
        else 'partially_used'
      end
  where id = v_claim.id
  returning * into v_claim;

  insert into vip.vip_benefit_ledger (
    user_id,
    subscription_id,
    benefit_type,
    entry_type,
    amount,
    currency_code,
    source_type,
    source_id,
    idempotency_key,
    metadata
  ) values (
    p_user_id,
    v_claim.subscription_id,
    'daily_free_box',
    'consume',
    1,
    null,
    'vip_daily_claim',
    v_claim.id,
    v_scoped_key,
    jsonb_build_object(
      'claim_date', v_today,
      'draw_order_id', v_draw_order_id,
      'box_slug', 'premium_egg'
    )
  )
  returning * into v_existing_ledger;

  insert into gacha.draw_audit (
    draw_order_id,
    user_id,
    pool_version_id,
    rules_snapshot
  ) values (
    v_draw_order_id,
    p_user_id,
    v_pool.id,
    jsonb_build_object(
      'box_id', v_box.id,
      'draw_count', 1,
      'quantity', 1,
      'open_reward_kcoin', 0,
      'source_type', 'vip_daily_free_box',
      'claim_id', v_claim.id
    )
  );

  update gacha.draw_orders
  set status = 'completed',
      opened_at = now(),
      updated_at = now()
  where id = v_draw_order_id
  returning * into v_existing_order;

  v_referral_first_open := api.referral_process_first_open(p_user_id, v_draw_order_id);

  v_progress_result := api.task_record_progress(
    p_user_id,
    'gacha_open_success',
    1,
    v_draw_order_id,
    coalesce(v_existing_order.opened_at::date, current_date)::text
  );

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
  where dr.draw_order_id = v_draw_order_id;

  return jsonb_build_object(
    'draw_order_id', v_draw_order_id,
    'box_slug', 'premium_egg',
    'status', 'completed',
    'payment_status', 'vip_daily_free',
    'draw_count', 1,
    'quantity', 1,
    'xtr_amount', 0,
    'total_price_stars', 0,
    'claim_id', v_claim.id,
    'free_box_count', v_claim.free_box_count,
    'free_box_used_count', v_claim.free_box_used_count,
    'remaining_free_box_count', greatest(v_claim.free_box_count - v_claim.free_box_used_count, 0),
    'consume_ledger_id', v_existing_ledger.id,
    'results', coalesce(v_results, '[]'::jsonb),
    'referral_first_open', coalesce(v_referral_first_open, '{}'::jsonb),
    'task_progress', coalesce(v_progress_result, '{}'::jsonb),
    'idempotent', false,
    'result_ready', true
  );
end;
$$;

comment on function api.vip_open_daily_free_premium_egg(uuid, text) is
  'Claims today''s VIP benefit if needed, consumes one daily free box counter, and opens one premium_egg in a single transaction.';

revoke execute on function api.vip_open_daily_free_premium_egg(uuid, text)
  from public, anon, authenticated;

grant execute on function api.vip_open_daily_free_premium_egg(uuid, text)
  to service_role;

commit;
