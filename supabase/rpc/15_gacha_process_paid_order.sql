-- gacha_process_paid_order.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.gacha_process_paid_order

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
  v_referral_commission_setting jsonb;
  v_referral_commission_bps integer;
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

  select value
  into v_referral_commission_setting
  from ops.system_settings
  where key = 'REFERRAL_COMMISSION_BPS';

  if v_referral_commission_setting is null then
    raise exception 'referral commission bps setting is required';
  else
    if jsonb_typeof(v_referral_commission_setting) = 'object'
       and v_referral_commission_setting ? 'commission_bps'
       and (v_referral_commission_setting ->> 'commission_bps') ~ '^[0-9]+$' then
      v_referral_commission_bps := (v_referral_commission_setting ->> 'commission_bps')::integer;
    else
      raise exception 'invalid referral commission bps setting';
    end if;
  end if;

  if v_referral_commission_bps < 0 or v_referral_commission_bps > 10000 then
    raise exception 'referral commission bps setting must be between 0 and 10000';
  end if;

  -- Referral growth rules:
  -- 1. If this is the invitee's first qualified paid open, grant both sides the first-open reward.
  -- 2. Only later successful opens can grant inviter configured commission based on the K-coin open reward.
  v_referral_first_open := api.referral_process_first_open(v_order.user_id, v_order.id);
  if v_reward_kcoin > 0
     and not coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
    v_referral_commission := api.referral_create_commission(
      v_order.user_id,
      v_order.id,
      v_reward_kcoin,
      v_referral_commission_bps
    );
  elsif coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
    v_referral_commission := jsonb_build_object(
      'processed', false,
      'reason', 'first_open_order_not_commissionable',
      'draw_order_id', v_order.id
    );
  end if;

  insert into gacha.draw_audit (draw_order_id, user_id, pool_version_id, rules_snapshot)
  values (
    v_order.id,
    v_order.user_id,
    v_order.pool_version_id,
    jsonb_build_object(
      'box_id', v_order.box_id,
      'draw_count', v_order.draw_count,
      'quantity', v_order.quantity,
      'open_reward_kcoin', v_order.open_reward_kcoin,
      'referral_commission_bps', v_referral_commission_bps
    )
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


-- ============================================================
