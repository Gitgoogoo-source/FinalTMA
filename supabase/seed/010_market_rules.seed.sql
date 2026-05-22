-- 010_market_rules.seed.sql
-- Phase 2 marketplace fixtures for local development and manual trade-flow tests.

begin;

insert into economy.fee_rules (
  code,
  fee_type,
  currency_code,
  fee_bps,
  min_fee,
  active,
  starts_at,
  ends_at,
  metadata
) values (
  'MARKET_SELL_FEE',
  'market_sell',
  'KCOIN',
  500,
  0,
  true,
  null,
  null,
  '{"description":"Default 5% platform fee for marketplace sales.","seed":"phase2_market"}'::jsonb
)
on conflict (code) do update
set fee_type = excluded.fee_type,
    currency_code = excluded.currency_code,
    fee_bps = excluded.fee_bps,
    min_fee = excluded.min_fee,
    active = true,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    metadata = economy.fee_rules.metadata || excluded.metadata,
    updated_at = now();

do $$
declare
  v_seller_id uuid;
  v_buyer_id uuid;
  v_template_id uuid;
  v_form_id uuid;
  v_base_power integer;
  v_available_count integer;
  v_insert_count integer;
  v_item_id uuid;
  v_kcoin_available numeric(38,0);
  v_kcoin_topup numeric(38,0);
begin
  select (api.auth_upsert_telegram_user(
    p_telegram_user_id := 9200000001,
    p_username := 'phase2_market_seller',
    p_first_name := 'Phase2',
    p_last_name := 'Seller',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/phase2-market-seller.png',
    p_start_param := null,
    p_metadata := '{"seed":"phase2_market","role":"seller"}'::jsonb
  ) ->> 'user_id')::uuid
  into v_seller_id;

  select (api.auth_upsert_telegram_user(
    p_telegram_user_id := 9200000002,
    p_username := 'phase2_market_buyer',
    p_first_name := 'Phase2',
    p_last_name := 'Buyer',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/phase2-market-buyer.png',
    p_start_param := null,
    p_metadata := '{"seed":"phase2_market","role":"buyer"}'::jsonb
  ) ->> 'user_id')::uuid
  into v_buyer_id;

  update core.users
  set status = 'active',
      risk_score = 0,
      metadata = metadata || '{"seed":"phase2_market"}'::jsonb,
      updated_at = now()
  where id in (v_seller_id, v_buyer_id);

  select t.id, f.id, t.base_power
  into v_template_id, v_form_id, v_base_power
  from catalog.collectible_templates t
  join catalog.collectible_forms f on f.template_id = t.id
  where t.slug = 'forest_sproutling'
    and t.tradeable = true
    and t.release_status = 'active'
  order by f.is_default desc, f.form_index asc
  limit 1;

  if v_template_id is null or v_form_id is null then
    raise exception 'phase2 marketplace seed requires active tradeable forest_sproutling template and form';
  end if;

  select count(*)::integer
  into v_available_count
  from inventory.item_instances ii
  join catalog.collectible_templates t on t.id = ii.template_id
  where ii.owner_user_id = v_seller_id
    and ii.template_id = v_template_id
    and ii.form_id = v_form_id
    and ii.status = 'available'
    and t.tradeable = true;

  v_insert_count := greatest(0, 3 - coalesce(v_available_count, 0));

  if v_insert_count > 0 then
    for i in 1..v_insert_count loop
      insert into inventory.item_instances (
        owner_user_id,
        template_id,
        form_id,
        level,
        exp,
        power,
        status,
        source_type,
        metadata
      ) values (
        v_seller_id,
        v_template_id,
        v_form_id,
        1,
        0,
        coalesce(v_base_power, 10),
        'available',
        'admin',
        jsonb_build_object(
          'seed',
          'phase2_market',
          'role',
          'seller_inventory',
          'fixture_index',
          i
        )
      )
      returning id into v_item_id;

      insert into inventory.item_instance_events (
        item_instance_id,
        user_id,
        event_type,
        source_type,
        source_id,
        after_state,
        metadata
      ) values (
        v_item_id,
        v_seller_id,
        'created',
        'admin',
        null,
        jsonb_build_object(
          'status',
          'available',
          'template_id',
          v_template_id,
          'form_id',
          v_form_id
        ),
        '{"seed":"phase2_market"}'::jsonb
      );
    end loop;
  end if;

  select available_amount
  into v_kcoin_available
  from economy.user_balances
  where user_id = v_buyer_id
    and currency_code = 'KCOIN';

  v_kcoin_topup := greatest(0, 10000 - coalesce(v_kcoin_available, 0));

  if v_kcoin_topup > 0 then
    perform api._credit_balance(
      p_user_id := v_buyer_id,
      p_currency_code := 'KCOIN',
      p_amount := v_kcoin_topup,
      p_source_type := 'admin',
      p_source_id := null,
      p_source_ref := 'phase2-market-seed-buyer-kcoin',
      p_idempotency_key := null,
      p_note := 'Phase 2 marketplace seed buyer KCOIN top-up',
      p_metadata := jsonb_build_object(
        'seed',
        'phase2_market',
        'target_available_amount',
        10000
      )
    );
  end if;
end $$;

commit;
