-- 005_collectibles.seed.sql
-- First-stage launch collectible catalog. User-owned copies live in inventory.item_instances.

begin;

do $$
declare
  rec record;
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_form_id uuid;
  v_storage_base text := '/storage/v1/object/public/collectibles/';
begin
  for rec in
    select *
    from (values
      ('forest_sproutling', 'Forest Sproutling', 'Forest scout', 'A young scout watching the green borderlands.', 'COMMON', 'CHARACTER', 'forest_guardians', 'forest', 100, true, 10),
      ('forest_ranger', 'Verdant Ranger', 'Forest ranger', 'A precise ranger trained by the Forest Pact.', 'RARE', 'CHARACTER', 'forest_guardians', 'forest', 140, true, 20),
      ('ancient_leaf_sentinel', 'Ancient Leaf Sentinel', 'Forest sentinel', 'An old sentinel with roots under the launch gate.', 'EPIC', 'CHARACTER', 'forest_guardians', 'forest', 210, true, 30),
      ('mooncap_bard', 'Mooncap Bard', 'Lunar singer', 'A tiny mushroom singer under the new moon.', 'COMMON', 'CHARACTER', 'moon_crown', 'lunar', 100, true, 40),
      ('moonlit_minstrel', 'Moonlit Minstrel', 'Lunar performer', 'A silver-voiced performer of the Lunar Court.', 'RARE', 'CHARACTER', 'moon_crown', 'lunar', 140, true, 50),
      ('moon_crown_guardian', 'Moon Crown Guardian', 'Lunar guardian', 'A legendary guardian shown in the hero banner.', 'LEGENDARY', 'CHARACTER', 'moon_crown', 'lunar', 330, true, 60),
      ('crystal_otter', 'Crystal Otter', 'Cove pet', 'A playful otter carrying cove crystals.', 'COMMON', 'PET', 'crystal_cove', 'crystal', 100, true, 70),
      ('tideglass_otter', 'Tideglass Otter', 'Cove guardian', 'A rare cove guardian with polished crystal armor.', 'RARE', 'PET', 'crystal_cove', 'crystal', 140, true, 80),
      ('prism_tide_oracle', 'Prism Tide Oracle', 'Cove oracle', 'An epic oracle of the crystal tide.', 'EPIC', 'CHARACTER', 'crystal_cove', 'crystal', 210, true, 90),
      ('ember_whelp', 'Ember Whelp', 'Flame pet', 'A rare hatchling from the Flame Nest.', 'RARE', 'PET', 'dragon_fire', 'flame', 140, true, 100),
      ('blazewing_drake', 'Blazewing Drake', 'Flame drake', 'An epic drake that guards molten trails.', 'EPIC', 'PET', 'dragon_fire', 'flame', 210, true, 110),
      ('inferno_crown_dragon', 'Inferno Crown Dragon', 'Flame dragon', 'A legendary dragon crowned by fire.', 'LEGENDARY', 'PET', 'dragon_fire', 'flame', 330, true, 120)
    ) as t(
      slug,
      display_name,
      subtitle,
      description,
      rarity_code,
      type_code,
      series_slug,
      faction_slug,
      base_power,
      gacha_available,
      sort_order
    )
  loop
    select id
    into v_series_id
    from catalog.series
    where slug = rec.series_slug;

    select id
    into v_faction_id
    from catalog.factions
    where slug = rec.faction_slug;

    if v_series_id is null then
      raise exception 'missing catalog.series seed: %', rec.series_slug;
    end if;

    if v_faction_id is null then
      raise exception 'missing catalog.factions seed: %', rec.faction_slug;
    end if;

    insert into catalog.collectible_templates (
      slug,
      display_name,
      subtitle,
      description,
      rarity_code,
      type_code,
      series_id,
      faction_id,
      base_power,
      max_level,
      release_status,
      tradeable,
      upgradeable,
      evolvable,
      decomposable,
      nft_mintable,
      sort_order,
      metadata
    ) values (
      rec.slug,
      rec.display_name,
      rec.subtitle,
      rec.description,
      rec.rarity_code,
      rec.type_code,
      v_series_id,
      v_faction_id,
      rec.base_power,
      60,
      'active',
      true,
      true,
      true,
      true,
      true,
      rec.sort_order,
      jsonb_build_object(
        'launch_seed', true,
        'is_gacha_available', rec.gacha_available,
        'role_text', rec.subtitle,
        'series_slug', rec.series_slug,
        'faction_slug', rec.faction_slug
      )
    )
    on conflict (slug) do update
    set display_name = excluded.display_name,
        subtitle = excluded.subtitle,
        description = excluded.description,
        rarity_code = excluded.rarity_code,
        type_code = excluded.type_code,
        series_id = excluded.series_id,
        faction_id = excluded.faction_id,
        base_power = excluded.base_power,
        max_level = excluded.max_level,
        release_status = excluded.release_status,
        tradeable = excluded.tradeable,
        upgradeable = excluded.upgradeable,
        evolvable = excluded.evolvable,
        decomposable = excluded.decomposable,
        nft_mintable = excluded.nft_mintable,
        sort_order = excluded.sort_order,
        metadata = catalog.collectible_templates.metadata || excluded.metadata,
        updated_at = now()
    returning id into v_template_id;

    insert into catalog.collectible_forms (
      template_id,
      form_index,
      form_slug,
      display_name,
      description,
      image_url,
      thumbnail_url,
      avatar_url,
      base_power_bonus,
      is_default,
      metadata
    ) values (
      v_template_id,
      1,
      'base',
      rec.display_name,
      rec.description,
      v_storage_base || rec.slug || '_hero.png',
      v_storage_base || rec.slug || '_thumb.png',
      v_storage_base || rec.slug || '_avatar.png',
      0,
      true,
      jsonb_build_object('launch_seed', true, 'form_index', 1)
    )
    on conflict (template_id, form_index) do update
    set form_slug = excluded.form_slug,
        display_name = excluded.display_name,
        description = excluded.description,
        image_url = excluded.image_url,
        thumbnail_url = excluded.thumbnail_url,
        avatar_url = excluded.avatar_url,
        base_power_bonus = excluded.base_power_bonus,
        is_default = excluded.is_default,
        metadata = catalog.collectible_forms.metadata || excluded.metadata,
        updated_at = now()
    returning id into v_form_id;

    insert into catalog.collectible_media (
      template_id,
      form_id,
      media_type,
      url,
      storage_bucket,
      storage_path,
      sort_order,
      metadata
    )
    select
      v_template_id,
      v_form_id,
      m.media_type,
      v_storage_base || rec.slug || '_' || m.file_suffix,
      'collectibles',
      rec.slug || '_' || m.file_suffix,
      m.sort_order,
      jsonb_build_object('launch_seed', true, 'usage', m.media_type)
    from (values
      ('hero', 'hero.png', 10),
      ('card', 'card.png', 20),
      ('thumb', 'thumb.png', 30),
      ('avatar', 'avatar.png', 40)
    ) as m(media_type, file_suffix, sort_order)
    where not exists (
      select 1
      from catalog.collectible_media cm
      where cm.template_id = v_template_id
        and cm.form_id = v_form_id
        and cm.media_type = m.media_type
        and cm.url = v_storage_base || rec.slug || '_' || m.file_suffix
    );
  end loop;
end $$;

commit;
