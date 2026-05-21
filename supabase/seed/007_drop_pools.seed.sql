-- 007_drop_pools.seed.sql
-- Active launch drop pool versions, weighted reward entries and per-box pity rules.

begin;

do $$
declare
  v_box_id uuid;
  v_pool_id uuid;
  v_template_id uuid;
  v_form_id uuid;
  v_item_id uuid;
  v_pity_id uuid;
  rec record;
begin
  for rec in
    select *
    from (values
      ('starter_egg', 1, 'forest_sproutling', 'COMMON', 3200::numeric, 3200, false, 10),
      ('starter_egg', 1, 'mooncap_bard', 'COMMON', 2600::numeric, 2600, false, 20),
      ('starter_egg', 1, 'crystal_otter', 'COMMON', 2200::numeric, 2200, false, 30),
      ('starter_egg', 1, 'forest_ranger', 'RARE', 850::numeric, 850, true, 40),
      ('starter_egg', 1, 'moonlit_minstrel', 'RARE', 650::numeric, 650, true, 50),
      ('starter_egg', 1, 'tideglass_otter', 'RARE', 350::numeric, 350, true, 60),
      ('starter_egg', 1, 'ancient_leaf_sentinel', 'EPIC', 100::numeric, 100, true, 70),
      ('starter_egg', 1, 'prism_tide_oracle', 'EPIC', 50::numeric, 50, true, 80),

      ('premium_egg', 1, 'forest_ranger', 'RARE', 1800::numeric, 1800, true, 10),
      ('premium_egg', 1, 'moonlit_minstrel', 'RARE', 1600::numeric, 1600, true, 20),
      ('premium_egg', 1, 'tideglass_otter', 'RARE', 1500::numeric, 1500, true, 30),
      ('premium_egg', 1, 'ember_whelp', 'RARE', 1400::numeric, 1400, true, 40),
      ('premium_egg', 1, 'ancient_leaf_sentinel', 'EPIC', 1100::numeric, 1100, true, 50),
      ('premium_egg', 1, 'prism_tide_oracle', 'EPIC', 900::numeric, 900, true, 60),
      ('premium_egg', 1, 'blazewing_drake', 'EPIC', 850::numeric, 850, true, 70),
      ('premium_egg', 1, 'moon_crown_guardian', 'LEGENDARY', 450::numeric, 450, true, 80),
      ('premium_egg', 1, 'inferno_crown_dragon', 'LEGENDARY', 400::numeric, 400, true, 90),

      ('legendary_egg', 1, 'ember_whelp', 'RARE', 1000::numeric, 1000, true, 10),
      ('legendary_egg', 1, 'ancient_leaf_sentinel', 'EPIC', 1800::numeric, 1800, true, 20),
      ('legendary_egg', 1, 'prism_tide_oracle', 'EPIC', 1700::numeric, 1700, true, 30),
      ('legendary_egg', 1, 'blazewing_drake', 'EPIC', 1600::numeric, 1600, true, 40),
      ('legendary_egg', 1, 'moon_crown_guardian', 'LEGENDARY', 2000::numeric, 2000, true, 50),
      ('legendary_egg', 1, 'inferno_crown_dragon', 'LEGENDARY', 1900::numeric, 1900, true, 60)
    ) as t(
      box_slug,
      version_no,
      template_slug,
      rarity_code,
      drop_weight,
      probability_bps,
      is_pity_eligible,
      sort_order
    )
  loop
    select id
    into v_box_id
    from gacha.blind_boxes
    where slug = rec.box_slug;

    if v_box_id is null then
      raise exception 'missing gacha.blind_boxes seed: %', rec.box_slug;
    end if;

    insert into gacha.drop_pool_versions (
      box_id,
      version_no,
      status,
      published_at,
      effective_from,
      effective_to,
      config_snapshot
    ) values (
      v_box_id,
      rec.version_no,
      'active',
      now(),
      now() - interval '1 hour',
      now() + interval '365 days',
      jsonb_build_object('launch_seed', true, 'box_slug', rec.box_slug)
    )
    on conflict (box_id, version_no) do update
    set status = 'active',
        published_at = coalesce(gacha.drop_pool_versions.published_at, excluded.published_at),
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        config_snapshot = gacha.drop_pool_versions.config_snapshot || excluded.config_snapshot,
        updated_at = now()
    returning id into v_pool_id;

    select ct.id, cf.id
    into v_template_id, v_form_id
    from catalog.collectible_templates ct
    join catalog.collectible_forms cf
      on cf.template_id = ct.id
     and cf.is_default = true
    where ct.slug = rec.template_slug
    limit 1;

    if v_template_id is null or v_form_id is null then
      raise exception 'missing collectible seed/template form: %', rec.template_slug;
    end if;

    select id
    into v_item_id
    from gacha.drop_pool_items
    where pool_version_id = v_pool_id
      and template_id = v_template_id
      and form_id = v_form_id
    limit 1;

    if v_item_id is null then
      insert into gacha.drop_pool_items (
        pool_version_id,
        template_id,
        form_id,
        rarity_code,
        drop_weight,
        probability_bps,
        stock_total,
        stock_remaining,
        is_pity_eligible,
        is_featured,
        sort_order,
        metadata
      ) values (
        v_pool_id,
        v_template_id,
        v_form_id,
        rec.rarity_code,
        rec.drop_weight,
        rec.probability_bps,
        null,
        null,
        rec.is_pity_eligible,
        rec.rarity_code in ('EPIC', 'LEGENDARY'),
        rec.sort_order,
        jsonb_build_object('launch_seed', true, 'min_draw_count', 1, 'max_draw_count', null)
      );
    else
      update gacha.drop_pool_items
      set rarity_code = rec.rarity_code,
          drop_weight = rec.drop_weight,
          probability_bps = rec.probability_bps,
          stock_total = null,
          stock_remaining = null,
          is_pity_eligible = rec.is_pity_eligible,
          is_featured = rec.rarity_code in ('EPIC', 'LEGENDARY'),
          sort_order = rec.sort_order,
          metadata = gacha.drop_pool_items.metadata || jsonb_build_object('launch_seed', true, 'min_draw_count', 1, 'max_draw_count', null),
          updated_at = now()
      where id = v_item_id;
    end if;
  end loop;

  for rec in
    select *
    from (values
      ('starter_egg', 'starter_egg_rare_pity', 30, 'RARE', 10),
      ('premium_egg', 'premium_egg_epic_pity', 50, 'EPIC', 10),
      ('legendary_egg', 'legendary_egg_legendary_pity', 80, 'LEGENDARY', 10)
    ) as t(box_slug, rule_name, threshold, target_rarity_code, priority)
  loop
    select bb.id, dpv.id
    into v_box_id, v_pool_id
    from gacha.blind_boxes bb
    join gacha.drop_pool_versions dpv
      on dpv.box_id = bb.id
     and dpv.version_no = 1
    where bb.slug = rec.box_slug;

    if v_box_id is null or v_pool_id is null then
      raise exception 'missing drop pool version for pity rule: %', rec.box_slug;
    end if;

    select id
    into v_pity_id
    from gacha.pity_rules
    where box_id = v_box_id
      and pool_version_id = v_pool_id
      and rule_name = rec.rule_name
    limit 1;

    if v_pity_id is null then
      insert into gacha.pity_rules (
        box_id,
        pool_version_id,
        rule_name,
        threshold,
        target_rarity_code,
        reset_on_rarity_code,
        priority,
        active,
        metadata
      ) values (
        v_box_id,
        v_pool_id,
        rec.rule_name,
        rec.threshold,
        rec.target_rarity_code,
        rec.target_rarity_code,
        rec.priority,
        true,
        jsonb_build_object('launch_seed', true, 'box_slug', rec.box_slug)
      );
    else
      update gacha.pity_rules
      set threshold = rec.threshold,
          target_rarity_code = rec.target_rarity_code,
          reset_on_rarity_code = rec.target_rarity_code,
          priority = rec.priority,
          active = true,
          metadata = gacha.pity_rules.metadata || jsonb_build_object('launch_seed', true, 'box_slug', rec.box_slug),
          updated_at = now()
      where id = v_pity_id;
    end if;
  end loop;
end $$;

commit;
