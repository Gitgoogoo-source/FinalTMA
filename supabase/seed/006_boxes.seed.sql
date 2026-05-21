-- 006_boxes.seed.sql
-- Three launch blind boxes. Ten-draw uses discount_bps=1000, meaning 10% off.

begin;

do $$
declare
  rec record;
  v_box_id uuid;
begin
  for rec in
    select *
    from (values
      (
        'starter_egg',
        'Normal Egg',
        'Best for new players. Contains Common, Rare and a small chance of Epic collectibles.',
        'normal',
        10,
        100000,
        '/storage/v1/object/public/boxes/starter_egg.png',
        '/storage/v1/object/public/boxes/starter_egg_hero.png',
        10
      ),
      (
        'premium_egg',
        'Rare Egg',
        'Higher Rare and Epic rates, with a chance for Legendary collectibles.',
        'rare',
        30,
        50000,
        '/storage/v1/object/public/boxes/premium_egg.png',
        '/storage/v1/object/public/boxes/premium_egg_hero.png',
        20
      ),
      (
        'legendary_egg',
        'Legendary Egg',
        'High-value box focused on Epic and Legendary launch collectibles.',
        'legendary',
        80,
        15000,
        '/storage/v1/object/public/boxes/legendary_egg.png',
        '/storage/v1/object/public/boxes/legendary_egg_hero.png',
        30
      )
    ) as t(
      slug,
      display_name,
      description,
      tier,
      price_stars,
      stock,
      cover_image_url,
      hero_image_url,
      sort_order
    )
  loop
    insert into gacha.blind_boxes (
      slug,
      display_name,
      description,
      tier,
      status,
      price_stars,
      total_stock,
      remaining_stock,
      open_reward_kcoin,
      cover_image_url,
      hero_image_url,
      starts_at,
      ends_at,
      sort_order,
      metadata
    ) values (
      rec.slug,
      rec.display_name,
      rec.description,
      rec.tier,
      'active',
      rec.price_stars,
      rec.stock,
      rec.stock,
      100,
      rec.cover_image_url,
      rec.hero_image_url,
      now() - interval '1 hour',
      now() + interval '365 days',
      rec.sort_order,
      jsonb_build_object('launch_seed', true, 'ten_draw_discount_rate', 0.9)
    )
    on conflict (slug) do update
    set display_name = excluded.display_name,
        description = excluded.description,
        tier = excluded.tier,
        status = excluded.status,
        price_stars = excluded.price_stars,
        total_stock = excluded.total_stock,
        remaining_stock = case
          when gacha.blind_boxes.remaining_stock is null then excluded.remaining_stock
          else least(greatest(gacha.blind_boxes.remaining_stock, 0), excluded.total_stock)
        end,
        open_reward_kcoin = excluded.open_reward_kcoin,
        cover_image_url = excluded.cover_image_url,
        hero_image_url = excluded.hero_image_url,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        sort_order = excluded.sort_order,
        metadata = gacha.blind_boxes.metadata || excluded.metadata,
        updated_at = now()
    returning id into v_box_id;

    insert into gacha.box_price_rules (
      box_id,
      quantity,
      discount_bps,
      price_stars_override,
      active,
      metadata
    ) values (
      v_box_id,
      1,
      0,
      null,
      true,
      '{"launch_seed":true,"mode":"single"}'::jsonb
    )
    on conflict (box_id, quantity, active) do update
    set discount_bps = excluded.discount_bps,
        price_stars_override = excluded.price_stars_override,
        metadata = gacha.box_price_rules.metadata || excluded.metadata,
        updated_at = now();

    insert into gacha.box_price_rules (
      box_id,
      quantity,
      discount_bps,
      price_stars_override,
      active,
      metadata
    ) values (
      v_box_id,
      10,
      1000,
      null,
      true,
      '{"launch_seed":true,"mode":"ten_draw_discount"}'::jsonb
    )
    on conflict (box_id, quantity, active) do update
    set discount_bps = excluded.discount_bps,
        price_stars_override = excluded.price_stars_override,
        metadata = gacha.box_price_rules.metadata || excluded.metadata,
        updated_at = now();
  end loop;
end $$;

commit;
