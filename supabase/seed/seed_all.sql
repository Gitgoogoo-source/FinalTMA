-- seed_all.sql
-- Combined seed data for Telegram Mini App blind-box game.


-- ================================================================
-- BEGIN 001_currencies.seed.sql
-- ================================================================

-- 001_currencies.seed.sql
-- Base currencies for game economy and Telegram Stars display/payment references.

begin;

-- Shared seed helper. 001_currencies.seed.sql installs this once.
create schema if not exists seed_util;

create or replace function seed_util.insert_json(
  p_schema text,
  p_table text,
  p_row jsonb
)
returns void
language plpgsql
as $$
declare
  v_reg regclass;
  v_cols text[];
  v_col_list text;
  v_select_list text;
begin
  v_reg := to_regclass(format('%I.%I', p_schema, p_table));
  if v_reg is null then
    raise notice 'seed skipped: %.% does not exist', p_schema, p_table;
    return;
  end if;

  select array_agg(c.column_name order by c.ordinal_position)
  into v_cols
  from information_schema.columns c
  where c.table_schema = p_schema
    and c.table_name = p_table
    and c.is_generated = 'NEVER'
    and c.column_name in (select jsonb_object_keys(p_row));

  if v_cols is null or array_length(v_cols, 1) = 0 then
    raise notice 'seed skipped: %.% has no matching columns for %', p_schema, p_table, p_row;
    return;
  end if;

  select string_agg(format('%I', c), ', '),
         string_agg(format('x.%I', c), ', ')
  into v_col_list, v_select_list
  from unnest(v_cols) as c;

  execute format(
    'insert into %I.%I (%s) select %s from jsonb_populate_record(null::%I.%I, $1) as x on conflict do nothing',
    p_schema, p_table, v_col_list, v_select_list, p_schema, p_table
  ) using p_row;
end;
$$;

create or replace function seed_util.get_uuid(
  p_schema text,
  p_table text,
  p_key_column text,
  p_key_value text
)
returns uuid
language plpgsql
as $$
declare
  v_result uuid;
begin
  if to_regclass(format('%I.%I', p_schema, p_table)) is null then
    return null;
  end if;

  execute format('select id from %I.%I where %I = $1 limit 1', p_schema, p_table, p_key_column)
  into v_result
  using p_key_value;

  return v_result;
exception when undefined_column then
  return null;
end;
$$;


select seed_util.insert_json('economy','currencies', $$ {
  "code":"KCOIN",
  "name":"K-coin",
  "display_name":"K-coin",
  "symbol":"K",
  "decimals":0,
  "currency_type":"game",
  "currency_kind":"game",
  "is_spendable":true,
  "is_display_only":false,
  "active":true,
  "metadata":{"description":"Main trading currency used for marketplace purchases and synthesis cost."}
} $$::jsonb);

select seed_util.insert_json('economy','currencies', $$ {
  "code":"FGEMS",
  "name":"Fgems",
  "display_name":"Fgems",
  "symbol":"F",
  "decimals":0,
  "currency_type":"game",
  "currency_kind":"game",
  "is_spendable":true,
  "is_display_only":false,
  "active":true,
  "metadata":{"description":"Growth currency obtained from decomposition and tasks, used for upgrading collectibles."}
} $$::jsonb);

select seed_util.insert_json('economy','currencies', $$ {
  "code":"STAR",
  "name":"Telegram Stars",
  "display_name":"Telegram Stars",
  "symbol":"⭐",
  "decimals":0,
  "currency_type":"external_payment",
  "currency_kind":"external_payment",
  "is_spendable":false,
  "is_display_only":true,
  "active":true,
  "metadata":{"telegram_currency":"XTR","description":"External Telegram Stars payment unit; not an internal ledger balance."}
} $$::jsonb);

select seed_util.insert_json('economy','currencies', $$ {
  "code":"TON",
  "name":"TON",
  "display_name":"TON",
  "symbol":"TON",
  "decimals":9,
  "currency_type":"chain",
  "currency_kind":"chain",
  "is_spendable":false,
  "is_display_only":true,
  "active":true,
  "metadata":{"chain":"TON","description":"TON chain display currency for wallet and NFT actions."}
} $$::jsonb);

commit;

-- ================================================================
-- END 001_currencies.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 002_rarities.seed.sql
-- ================================================================

-- 002_rarities.seed.sql
-- Collectible rarity ladder. sort_order is used by pity rules and leaderboard scoring.

begin;

select seed_util.insert_json('catalog','rarities', $$ {
  "code":"COMMON",
  "name":"Common",
  "display_name":"Common",
  "sort_order":10,
  "color_hex":"#9AA3AD",
  "label_class":"rarity-common",
  "min_power":10,
  "is_pity_target":false,
  "active":true,
  "metadata":{"drop_tier":"base","album_score":10,"decompose_fgems":20}
} $$::jsonb);

select seed_util.insert_json('catalog','rarities', $$ {
  "code":"RARE",
  "name":"Rare",
  "display_name":"Rare",
  "sort_order":20,
  "color_hex":"#2E8BFF",
  "label_class":"rarity-rare",
  "min_power":35,
  "is_pity_target":false,
  "active":true,
  "metadata":{"drop_tier":"blue","album_score":30,"decompose_fgems":60}
} $$::jsonb);

select seed_util.insert_json('catalog','rarities', $$ {
  "code":"EPIC",
  "name":"Epic",
  "display_name":"Epic",
  "sort_order":30,
  "color_hex":"#8B5CFF",
  "label_class":"rarity-epic",
  "min_power":90,
  "is_pity_target":true,
  "active":true,
  "metadata":{"drop_tier":"purple","album_score":80,"decompose_fgems":150}
} $$::jsonb);

select seed_util.insert_json('catalog','rarities', $$ {
  "code":"LEGENDARY",
  "name":"Legendary",
  "display_name":"Legendary",
  "sort_order":40,
  "color_hex":"#FF9B28",
  "label_class":"rarity-legendary",
  "min_power":180,
  "is_pity_target":true,
  "active":true,
  "metadata":{"drop_tier":"orange","album_score":220,"decompose_fgems":450}
} $$::jsonb);

select seed_util.insert_json('catalog','rarities', $$ {
  "code":"MYTHIC",
  "name":"Mythic",
  "display_name":"Mythic",
  "sort_order":50,
  "color_hex":"#FF4CE3",
  "label_class":"rarity-mythic",
  "min_power":320,
  "is_pity_target":true,
  "active":true,
  "metadata":{"drop_tier":"rainbow","album_score":500,"decompose_fgems":1200,"limited":true}
} $$::jsonb);

commit;

-- ================================================================
-- END 002_rarities.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 003_item_types.seed.sql
-- ================================================================

-- 003_item_types.seed.sql
-- Item type taxonomy used by filters, catalog pages and marketplace listing filters.

begin;

select seed_util.insert_json('catalog','item_types', $$ {
  "code":"CHARACTER",
  "name":"Character",
  "display_name":"Character",
  "sort_order":10,
  "active":true,
  "metadata":{"trade_filter":true,"album_required":true}
} $$::jsonb);

select seed_util.insert_json('catalog','item_types', $$ {
  "code":"PET",
  "name":"Pet",
  "display_name":"Pet",
  "sort_order":20,
  "active":true,
  "metadata":{"trade_filter":true,"album_required":true}
} $$::jsonb);

select seed_util.insert_json('catalog','item_types', $$ {
  "code":"DECORATION",
  "name":"Decoration",
  "display_name":"Decoration",
  "sort_order":30,
  "active":true,
  "metadata":{"trade_filter":true,"album_required":false}
} $$::jsonb);

select seed_util.insert_json('catalog','item_types', $$ {
  "code":"CONSUMABLE",
  "name":"Consumable",
  "display_name":"Consumable",
  "sort_order":40,
  "active":true,
  "metadata":{"trade_filter":false,"album_required":false}
} $$::jsonb);

select seed_util.insert_json('catalog','item_types', $$ {
  "code":"EGG",
  "name":"Egg",
  "display_name":"Egg",
  "sort_order":50,
  "active":true,
  "metadata":{"trade_filter":false,"album_required":false}
} $$::jsonb);

commit;

-- ================================================================
-- END 003_item_types.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 004_series_factions.seed.sql
-- ================================================================

-- 004_series_factions.seed.sql
-- Series and faction seeds for album grouping and UI filters.

begin;

-- Series
select seed_util.insert_json('catalog','series', $$ {
  "code":"FOREST_GUARDIANS",
  "name":"Forest Guardians",
  "display_name":"Forest Guardians",
  "description":"Sprites, scouts and beasts that protect the green borderlands.",
  "cover_url":"/storage/v1/object/public/banners/series_forest_guardians.png",
  "status":"active",
  "active":true,
  "sort_order":10,
  "metadata":{"theme":"forest","album_weight":1}
} $$::jsonb);

select seed_util.insert_json('catalog','series', $$ {
  "code":"MOON_CROWN",
  "name":"Moon Crown",
  "display_name":"Moon Crown",
  "description":"Moonlit bards, wardens and royal guardians.",
  "cover_url":"/storage/v1/object/public/banners/series_moon_crown.png",
  "status":"active",
  "active":true,
  "sort_order":20,
  "metadata":{"theme":"lunar","album_weight":1}
} $$::jsonb);

select seed_util.insert_json('catalog','series', $$ {
  "code":"CRYSTAL_COVE",
  "name":"Crystal Cove",
  "display_name":"Crystal Cove",
  "description":"Water and crystal creatures from the hidden cove.",
  "cover_url":"/storage/v1/object/public/banners/series_crystal_cove.png",
  "status":"active",
  "active":true,
  "sort_order":30,
  "metadata":{"theme":"crystal","album_weight":1}
} $$::jsonb);

select seed_util.insert_json('catalog','series', $$ {
  "code":"DRAGON_FIRE",
  "name":"Dragon Fire",
  "display_name":"Dragon Fire",
  "description":"Ember drakes and fire-forged beasts.",
  "cover_url":"/storage/v1/object/public/banners/series_dragon_fire.png",
  "status":"active",
  "active":true,
  "sort_order":40,
  "metadata":{"theme":"flame","album_weight":2}
} $$::jsonb);

select seed_util.insert_json('catalog','series', $$ {
  "code":"AURORA_MYTH",
  "name":"Aurora Myth",
  "display_name":"Aurora Myth",
  "description":"Limited mythic characters connected to wallet and NFT campaigns.",
  "cover_url":"/storage/v1/object/public/banners/series_aurora_myth.png",
  "status":"active",
  "active":true,
  "sort_order":50,
  "metadata":{"theme":"aurora","album_weight":3,"limited":true}
} $$::jsonb);

-- Factions
select seed_util.insert_json('catalog','factions', $$ {
  "code":"FOREST",
  "name":"Forest Pact",
  "display_name":"Forest Pact",
  "description":"Nature-aligned faction.",
  "icon_url":"/storage/v1/object/public/icons/faction_forest.png",
  "active":true,
  "sort_order":10,
  "metadata":{"element":"wood"}
} $$::jsonb);

select seed_util.insert_json('catalog','factions', $$ {
  "code":"LUNAR",
  "name":"Lunar Court",
  "display_name":"Lunar Court",
  "description":"Moon and song faction.",
  "icon_url":"/storage/v1/object/public/icons/faction_lunar.png",
  "active":true,
  "sort_order":20,
  "metadata":{"element":"moon"}
} $$::jsonb);

select seed_util.insert_json('catalog','factions', $$ {
  "code":"CRYSTAL",
  "name":"Crystal Tide",
  "display_name":"Crystal Tide",
  "description":"Water and crystal faction.",
  "icon_url":"/storage/v1/object/public/icons/faction_crystal.png",
  "active":true,
  "sort_order":30,
  "metadata":{"element":"water"}
} $$::jsonb);

select seed_util.insert_json('catalog','factions', $$ {
  "code":"FLAME",
  "name":"Flame Nest",
  "display_name":"Flame Nest",
  "description":"Fire and dragon faction.",
  "icon_url":"/storage/v1/object/public/icons/faction_flame.png",
  "active":true,
  "sort_order":40,
  "metadata":{"element":"fire"}
} $$::jsonb);

select seed_util.insert_json('catalog','factions', $$ {
  "code":"AURORA",
  "name":"Aurora Veil",
  "display_name":"Aurora Veil",
  "description":"Rare cross-element faction.",
  "icon_url":"/storage/v1/object/public/icons/faction_aurora.png",
  "active":true,
  "sort_order":50,
  "metadata":{"element":"light","limited":true}
} $$::jsonb);

commit;

-- ================================================================
-- END 004_series_factions.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 005_collectibles.seed.sql
-- ================================================================

-- 005_collectibles.seed.sql
-- Initial collectible catalog. Each evolution stage is a template so marketplace, album and NFT metadata can track concrete forms.

begin;

do $$
declare
  rec record;
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_form_id uuid;
  v_slug text;
  v_storage_base text := '/storage/v1/object/public/collectibles/';
begin
  for rec in
    select * from (values
    ('sproutling_scout_1','Sproutling Scout','A young forest scout watching the box gate.','COMMON','FOREST_GUARDIANS','FOREST',24,1,'CHARACTER'),
    ('sproutling_scout_2','Verdant Ranger','The scout evolves into a precise ranger.','RARE','FOREST_GUARDIANS','FOREST',72,2,'CHARACTER'),
    ('sproutling_scout_3','Ancient Leaf Sentinel','A high-form forest sentinel with ancient roots.','EPIC','FOREST_GUARDIANS','FOREST',165,3,'CHARACTER'),
    ('mooncap_bard_1','Mooncap Bard','A tiny mushroom singer under the new moon.','COMMON','MOON_CROWN','LUNAR',22,1,'CHARACTER'),
    ('mooncap_bard_2','Moonlit Minstrel','A silver-voiced performer of the Lunar Court.','RARE','MOON_CROWN','LUNAR',76,2,'CHARACTER'),
    ('mooncap_bard_3','Crescent Hymn Oracle','An epic oracle whose hymn reveals hidden paths.','EPIC','MOON_CROWN','LUNAR',172,3,'CHARACTER'),
    ('crystal_otter_1','Crystal Otter','A playful otter carrying cove crystals.','COMMON','CRYSTAL_COVE','CRYSTAL',26,1,'PET'),
    ('crystal_otter_2','Tideglass Otter','A rare cove guardian with polished crystal armor.','RARE','CRYSTAL_COVE','CRYSTAL',80,2,'PET'),
    ('crystal_otter_3','Prism Tide Sovereign','An epic sovereign of the crystal tide.','EPIC','CRYSTAL_COVE','CRYSTAL',178,3,'PET'),
    ('ember_whelp_1','Ember Whelp','A rare hatchling from the Flame Nest.','RARE','DRAGON_FIRE','FLAME',88,1,'PET'),
    ('ember_whelp_2','Blazewing Drake','An epic drake that guards molten trails.','EPIC','DRAGON_FIRE','FLAME',188,2,'PET'),
    ('ember_whelp_3','Inferno Crown Dragon','A legendary dragon crowned by fire.','LEGENDARY','DRAGON_FIRE','FLAME',355,3,'PET'),
    ('starfall_warden_1','Starfall Warden','A rare warden touched by moon dust.','RARE','MOON_CROWN','LUNAR',95,1,'CHARACTER'),
    ('starfall_warden_2','Astral Gatekeeper','An epic gatekeeper of the starfall corridor.','EPIC','MOON_CROWN','LUNAR',205,2,'CHARACTER'),
    ('starfall_warden_3','Moon Crown Guardian','A legendary guardian shown in the hero banner.','LEGENDARY','MOON_CROWN','LUNAR',390,3,'CHARACTER'),
    ('aurora_kitsune_1','Aurora Kitsune','An epic fox spirit from the Aurora Veil.','EPIC','AURORA_MYTH','AURORA',230,1,'CHARACTER'),
    ('aurora_kitsune_2','Northern Light Kitsune','A legendary nine-tail guardian of the aurora.','LEGENDARY','AURORA_MYTH','AURORA',430,2,'CHARACTER'),
    ('aurora_kitsune_3','Mythic Aurora Empress','A mythic limited form for launch season collectors.','MYTHIC','AURORA_MYTH','AURORA',720,3,'CHARACTER')
    ) as t(slug, display_name, description, rarity_code, series_code, faction_code, base_power, form_index, type_code)
  loop
    v_series_id := seed_util.get_uuid('catalog','series','code',rec.series_code);
    v_faction_id := seed_util.get_uuid('catalog','factions','code',rec.faction_code);
    v_slug := rec.slug;

    perform seed_util.insert_json('catalog','collectible_templates', jsonb_build_object(
      'slug', rec.slug,
      'code', upper(rec.slug),
      'name', rec.display_name,
      'display_name', rec.display_name,
      'subtitle', initcap(replace(rec.rarity_code, '_', ' ')) || ' · Form ' || rec.form_index,
      'description', rec.description,
      'item_type_code', rec.type_code,
      'type_code', rec.type_code,
      'rarity_code', rec.rarity_code,
      'series_id', v_series_id,
      'faction_id', v_faction_id,
      'base_power', rec.base_power,
      'max_level', 60,
      'tradable', true,
      'mintable', true,
      'decomposable', true,
      'upgradeable', true,
      'evolvable', rec.form_index < 3,
      'status', 'active',
      'release_status', 'active',
      'metadata', jsonb_build_object(
        'launch_seed', true,
        'family_slug', regexp_replace(rec.slug, '_[123]$', ''),
        'form_index', rec.form_index,
        'role', case when rec.type_code = 'PET' then 'support' else 'fighter' end,
        'battle_tags', jsonb_build_array(lower(rec.faction_code), lower(rec.rarity_code))
      )
    ));

    select id into v_template_id
    from catalog.collectible_templates
    where slug = rec.slug
    limit 1;

    perform seed_util.insert_json('catalog','collectible_forms', jsonb_build_object(
      'template_id', v_template_id,
      'form_index', rec.form_index,
      'form_code', 'FORM_' || rec.form_index,
      'code', 'FORM_' || rec.form_index,
      'form_name', rec.display_name,
      'name', rec.display_name,
      'display_name', rec.display_name,
      'required_same_count', 3,
      'sort_order', rec.form_index,
      'image_url', v_storage_base || rec.slug || '_hero.png',
      'thumbnail_url', v_storage_base || rec.slug || '_thumb.png',
      'avatar_url', v_storage_base || rec.slug || '_avatar.png',
      'metadata', jsonb_build_object('seed_form', true, 'form_index', rec.form_index)
    ));

    select id into v_form_id
    from catalog.collectible_forms
    where template_id = v_template_id
    order by form_index asc
    limit 1;

    perform seed_util.insert_json('catalog','collectible_media', jsonb_build_object(
      'template_id', v_template_id,
      'form_id', v_form_id,
      'media_type', 'hero',
      'url', v_storage_base || rec.slug || '_hero.png',
      'storage_bucket', 'collectibles',
      'storage_path', rec.slug || '_hero.png',
      'is_primary', true,
      'sort_order', 10,
      'metadata', jsonb_build_object('seed_media', true, 'usage', 'collection_hero')
    ));

    perform seed_util.insert_json('catalog','collectible_media', jsonb_build_object(
      'template_id', v_template_id,
      'form_id', v_form_id,
      'media_type', 'card',
      'url', v_storage_base || rec.slug || '_card.png',
      'storage_bucket', 'collectibles',
      'storage_path', rec.slug || '_card.png',
      'is_primary', false,
      'sort_order', 20,
      'metadata', jsonb_build_object('seed_media', true, 'usage', 'market_card')
    ));

    perform seed_util.insert_json('catalog','collectible_media', jsonb_build_object(
      'template_id', v_template_id,
      'form_id', v_form_id,
      'media_type', 'thumb',
      'url', v_storage_base || rec.slug || '_thumb.png',
      'storage_bucket', 'collectibles',
      'storage_path', rec.slug || '_thumb.png',
      'is_primary', false,
      'sort_order', 30,
      'metadata', jsonb_build_object('seed_media', true, 'usage', 'grid_thumb')
    ));
  end loop;
end $$;

commit;

-- ================================================================
-- END 005_collectibles.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 006_boxes.seed.sql
-- ================================================================

-- 006_boxes.seed.sql
-- Three launch blind boxes: starter, premium and legendary. Ten-draw uses 9000 bps = 9折.

begin;

do $$
declare
  v_box_id uuid;
begin
  perform seed_util.insert_json('gacha','blind_boxes', $$ {
    "slug":"starter_egg",
    "code":"STARTER_EGG",
    "name":"Starter Egg",
    "display_name":"Starter Egg",
    "subtitle":"Low-cost launch box",
    "description":"Best for new players. Contains Common, Rare and a small chance of Epic collectibles.",
    "image_url":"/storage/v1/object/public/boxes/starter_egg.png",
    "cover_image_url":"/storage/v1/object/public/boxes/starter_egg.png",
    "hero_image_url":"/storage/v1/object/public/boxes/starter_egg_hero.png",
    "tier":"starter",
    "status":"active",
    "price_stars":10,
    "unit_price_stars":10,
    "ten_draw_discount_bps":9000,
    "reward_kcoin_per_draw":100,
    "total_stock":100000,
    "sold_count":0,
    "sort_order":10,
    "metadata":{"launch_box":true,"recommended_for":"new_players"}
  } $$::jsonb);

  perform seed_util.insert_json('gacha','blind_boxes', $$ {
    "slug":"premium_egg",
    "code":"PREMIUM_EGG",
    "name":"Premium Egg",
    "display_name":"Premium Egg",
    "subtitle":"Balanced rare box",
    "description":"Higher Epic rate and chance for Legendary collectibles.",
    "image_url":"/storage/v1/object/public/boxes/premium_egg.png",
    "cover_image_url":"/storage/v1/object/public/boxes/premium_egg.png",
    "hero_image_url":"/storage/v1/object/public/boxes/premium_egg_hero.png",
    "tier":"premium",
    "status":"active",
    "price_stars":30,
    "unit_price_stars":30,
    "ten_draw_discount_bps":9000,
    "reward_kcoin_per_draw":100,
    "total_stock":50000,
    "sold_count":0,
    "sort_order":20,
    "metadata":{"launch_box":true,"recommended_for":"collectors"}
  } $$::jsonb);

  perform seed_util.insert_json('gacha','blind_boxes', $$ {
    "slug":"legendary_egg",
    "code":"LEGENDARY_EGG",
    "name":"Legendary Egg",
    "display_name":"Legendary Egg",
    "subtitle":"High-value limited box",
    "description":"Focused on Epic, Legendary and Mythic launch collectibles.",
    "image_url":"/storage/v1/object/public/boxes/legendary_egg.png",
    "cover_image_url":"/storage/v1/object/public/boxes/legendary_egg.png",
    "hero_image_url":"/storage/v1/object/public/boxes/legendary_egg_hero.png",
    "tier":"legendary",
    "status":"active",
    "price_stars":80,
    "unit_price_stars":80,
    "ten_draw_discount_bps":9000,
    "reward_kcoin_per_draw":100,
    "total_stock":15000,
    "sold_count":0,
    "sort_order":30,
    "metadata":{"launch_box":true,"limited":true,"recommended_for":"advanced_collectors"}
  } $$::jsonb);

  for v_box_id in select id from gacha.blind_boxes where slug in ('starter_egg','premium_egg','legendary_egg') loop
    perform seed_util.insert_json('gacha','box_price_rules', jsonb_build_object(
      'box_id', v_box_id,
      'draw_count', 1,
      'price_stars', (select price_stars from gacha.blind_boxes where id = v_box_id),
      'discount_bps', 10000,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_rule', true, 'mode', 'single')
    ));

    perform seed_util.insert_json('gacha','box_price_rules', jsonb_build_object(
      'box_id', v_box_id,
      'draw_count', 10,
      'price_stars', ceil((select price_stars from gacha.blind_boxes where id = v_box_id) * 10 * 0.9)::integer,
      'discount_bps', 9000,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_rule', true, 'mode', 'ten_draw_discount')
    ));
  end loop;
end $$;

commit;

-- ================================================================
-- END 006_boxes.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 007_drop_pools.seed.sql
-- ================================================================

-- 007_drop_pools.seed.sql
-- Drop pools and pity rules. These are seed defaults; production changes should publish a new pool version, not overwrite old history.

begin;

do $$
declare
  v_box_id uuid;
  v_pool_id uuid;
  rec record;
  v_template_id uuid;
begin
  -- Pool versions
  for rec in
    select * from (values
      ('starter_egg', 1, 'Starter Launch Pool', '{"common":7000,"rare":2500,"epic":500}'::jsonb),
      ('premium_egg', 1, 'Premium Launch Pool', '{"rare":4500,"epic":4500,"legendary":1000}'::jsonb),
      ('legendary_egg', 1, 'Legendary Launch Pool', '{"epic":2500,"legendary":7000,"mythic":500}'::jsonb)
    ) as t(box_slug, version_no, name, probabilities)
  loop
    select id into v_box_id from gacha.blind_boxes where slug = rec.box_slug limit 1;
    if v_box_id is null then
      raise notice 'box not found: %', rec.box_slug;
      continue;
    end if;

    perform seed_util.insert_json('gacha','drop_pool_versions', jsonb_build_object(
      'box_id', v_box_id,
      'version', rec.version_no,
      'version_no', rec.version_no,
      'name', rec.name,
      'status', 'active',
      'active', true,
      'effective_from', now() - interval '1 day',
      'snapshot_json', jsonb_build_object('probabilities', rec.probabilities, 'seed_pool', true),
      'metadata', jsonb_build_object('launch_pool', true)
    ));
  end loop;

  -- Starter pool: 70% common, 25% rare, 5% epic.
  select v.id into v_pool_id
  from gacha.drop_pool_versions v join gacha.blind_boxes b on b.id = v.box_id
  where b.slug = 'starter_egg' order by v.created_at desc limit 1;

  for rec in
    select * from (values
      ('sproutling_scout_1', 1800, 1800, false),
      ('mooncap_bard_1', 1800, 1800, false),
      ('crystal_otter_1', 1700, 1700, false),
      ('sproutling_scout_2', 900, 900, false),
      ('mooncap_bard_2', 800, 800, false),
      ('crystal_otter_2', 700, 700, false),
      ('sproutling_scout_3', 300, 300, true),
      ('mooncap_bard_3', 250, 250, true),
      ('crystal_otter_3', 250, 250, true)
    ) as t(slug, weight, probability_bps, pity_candidate)
  loop
    select id into v_template_id from catalog.collectible_templates where slug = rec.slug limit 1;
    perform seed_util.insert_json('gacha','drop_pool_items', jsonb_build_object(
      'pool_version_id', v_pool_id,
      'collectible_template_id', v_template_id,
      'template_id', v_template_id,
      'weight', rec.weight,
      'probability_bps', rec.probability_bps,
      'is_pity_candidate', rec.pity_candidate,
      'status', 'active',
      'active', true,
      'metadata', jsonb_build_object('seed_item', true)
    ));
  end loop;

  -- Premium pool: strong Epic chance and Legendary chance.
  select v.id into v_pool_id
  from gacha.drop_pool_versions v join gacha.blind_boxes b on b.id = v.box_id
  where b.slug = 'premium_egg' order by v.created_at desc limit 1;

  for rec in
    select * from (values
      ('sproutling_scout_2', 1000, 1000, false),
      ('mooncap_bard_2', 1000, 1000, false),
      ('crystal_otter_2', 1000, 1000, false),
      ('ember_whelp_1', 1500, 1500, false),
      ('sproutling_scout_3', 1100, 1100, true),
      ('mooncap_bard_3', 1100, 1100, true),
      ('crystal_otter_3', 1000, 1000, true),
      ('ember_whelp_2', 1300, 1300, true),
      ('starfall_warden_3', 600, 600, true),
      ('ember_whelp_3', 400, 400, true)
    ) as t(slug, weight, probability_bps, pity_candidate)
  loop
    select id into v_template_id from catalog.collectible_templates where slug = rec.slug limit 1;
    perform seed_util.insert_json('gacha','drop_pool_items', jsonb_build_object(
      'pool_version_id', v_pool_id,
      'collectible_template_id', v_template_id,
      'template_id', v_template_id,
      'weight', rec.weight,
      'probability_bps', rec.probability_bps,
      'is_pity_candidate', rec.pity_candidate,
      'status', 'active',
      'active', true,
      'metadata', jsonb_build_object('seed_item', true)
    ));
  end loop;

  -- Legendary pool: Epic floor, Legendary focus, Mythic limited chance.
  select v.id into v_pool_id
  from gacha.drop_pool_versions v join gacha.blind_boxes b on b.id = v.box_id
  where b.slug = 'legendary_egg' order by v.created_at desc limit 1;

  for rec in
    select * from (values
      ('sproutling_scout_3', 600, 600, false),
      ('mooncap_bard_3', 600, 600, false),
      ('crystal_otter_3', 500, 500, false),
      ('ember_whelp_2', 800, 800, false),
      ('starfall_warden_2', 700, 700, false),
      ('starfall_warden_3', 2600, 2600, true),
      ('ember_whelp_3', 2600, 2600, true),
      ('aurora_kitsune_2', 2400, 2400, true),
      ('aurora_kitsune_3', 500, 500, true)
    ) as t(slug, weight, probability_bps, pity_candidate)
  loop
    select id into v_template_id from catalog.collectible_templates where slug = rec.slug limit 1;
    perform seed_util.insert_json('gacha','drop_pool_items', jsonb_build_object(
      'pool_version_id', v_pool_id,
      'collectible_template_id', v_template_id,
      'template_id', v_template_id,
      'weight', rec.weight,
      'probability_bps', rec.probability_bps,
      'is_pity_candidate', rec.pity_candidate,
      'status', 'active',
      'active', true,
      'metadata', jsonb_build_object('seed_item', true)
    ));
  end loop;

  -- Pity rules
  for rec in
    select * from (values
      ('starter_egg', 'Starter Epic Pity', 'EPIC', 30),
      ('premium_egg', 'Premium Epic Pity', 'EPIC', 20),
      ('legendary_egg', 'Legendary Pity', 'LEGENDARY', 50)
    ) as t(box_slug, rule_name, rarity_code, threshold_value)
  loop
    select id into v_box_id from gacha.blind_boxes where slug = rec.box_slug limit 1;
    perform seed_util.insert_json('gacha','pity_rules', jsonb_build_object(
      'box_id', v_box_id,
      'name', rec.rule_name,
      'display_name', rec.rule_name,
      'target_rarity_code', rec.rarity_code,
      'threshold', rec.threshold_value,
      'pity_threshold', rec.threshold_value,
      'reset_on_target_hit', true,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_pity', true)
    ));
  end loop;
end $$;

commit;

-- ================================================================
-- END 007_drop_pools.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 008_tasks.seed.sql
-- ================================================================

-- 008_tasks.seed.sql
-- Task center, 7-day sign-in, social, trade and chain task defaults.

begin;

do $$
declare
  v_campaign_id uuid;
  rec record;
begin
  -- Task definitions. Reward is an array to match api._apply_reward_json.
  for rec in
    select * from (values
      ('DAILY_OPEN_1', '每日开盒', '每日完成 1 次开盒', 'daily', 'gacha_draw_count', 1, '[{"currency":"KCOIN","amount":50}]'::jsonb, 'daily', 10),
      ('DAILY_MARKET_VIEW', '浏览市场', '每日进入交易市场 1 次', 'daily', 'market_view_count', 1, '[{"currency":"KCOIN","amount":30}]'::jsonb, 'daily', 20),
      ('FIRST_OPEN_BOX', '首次开盒', '完成第一次 Stars 开盒', 'growth', 'first_gacha_paid', 1, '[{"currency":"KCOIN","amount":300}]'::jsonb, 'once', 30),
      ('FIRST_MARKET_BUY', '首次购买藏品', '在市场完成第一次购买', 'trade', 'market_buy_count', 1, '[{"currency":"KCOIN","amount":200}]'::jsonb, 'once', 40),
      ('FIRST_MARKET_SELL', '首次出售藏品', '成功上架 1 个藏品', 'trade', 'market_listing_count', 1, '[{"currency":"FGEMS","amount":80}]'::jsonb, 'once', 50),
      ('CONNECT_TON_WALLET', '连接 TON 钱包', '完成 TON Connect 钱包连接和签名验证', 'chain', 'wallet_verified', 1, '[{"currency":"KCOIN","amount":250}]'::jsonb, 'once', 60),
      ('SYNC_NFT_ONCHAIN', '同步链上 NFT', '同步 TON 钱包 NFT 状态 1 次', 'chain', 'wallet_nft_sync_count', 1, '[{"currency":"FGEMS","amount":100}]'::jsonb, 'weekly', 70),
      ('INVITE_FIRST_FRIEND', '邀请好友开盒', '邀请 1 名好友完成首次开盒', 'social', 'referral_first_open_count', 1, '[{"currency":"KCOIN","amount":500}]'::jsonb, 'once', 80)
    ) as t(code, title, description, category, trigger_type, target_value, reward, period_type, sort_order)
  loop
    perform seed_util.insert_json('tasks','task_definitions', jsonb_build_object(
      'code', rec.code,
      'title', rec.title,
      'name', rec.title,
      'display_name', rec.title,
      'description', rec.description,
      'category', rec.category,
      'trigger_type', rec.trigger_type,
      'target_value', rec.target_value,
      'reward', rec.reward,
      'rewards', rec.reward,
      'period_type', rec.period_type,
      'active', true,
      'status', 'active',
      'sort_order', rec.sort_order,
      'metadata', jsonb_build_object('seed_task', true)
    ));
  end loop;

  perform seed_util.insert_json('tasks','signin_campaigns', $$ {
    "code":"DEFAULT_7_DAY",
    "title":"7 日签到",
    "name":"7 日签到",
    "display_name":"7 日签到",
    "cycle_days":7,
    "active":true,
    "status":"active",
    "metadata":{"seed_campaign":true,"reset_mode":"cycle"}
  } $$::jsonb);

  select id into v_campaign_id
  from tasks.signin_campaigns
  where code = 'DEFAULT_7_DAY'
  limit 1;

  for rec in
    select * from (values
      (1, '[{"currency":"KCOIN","amount":100}]'::jsonb),
      (2, '[{"currency":"FGEMS","amount":50}]'::jsonb),
      (3, '[{"currency":"KCOIN","amount":120}]'::jsonb),
      (4, '[{"currency":"FGEMS","amount":80}]'::jsonb),
      (5, '[{"currency":"KCOIN","amount":180}]'::jsonb),
      (6, '[{"currency":"FGEMS","amount":120}]'::jsonb),
      (7, '[{"currency":"KCOIN","amount":400},{"currency":"FGEMS","amount":200}]'::jsonb)
    ) as t(day_index, reward)
  loop
    perform seed_util.insert_json('tasks','signin_days', jsonb_build_object(
      'campaign_id', v_campaign_id,
      'day_index', rec.day_index,
      'reward', rec.reward,
      'rewards', rec.reward,
      'active', true,
      'metadata', jsonb_build_object('seed_signin_day', true)
    ));

    -- Compatibility with schemas that named this table signin_rewards.
    perform seed_util.insert_json('tasks','signin_rewards', jsonb_build_object(
      'campaign_id', v_campaign_id,
      'day_index', rec.day_index,
      'reward', rec.reward,
      'rewards', rec.reward,
      'metadata', jsonb_build_object('seed_signin_day', true)
    ));
  end loop;
end $$;

commit;

-- ================================================================
-- END 008_tasks.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 009_album.seed.sql
-- ================================================================

-- 009_album.seed.sql
-- Album books, book items, milestones, leaderboard and scoring defaults.

begin;

do $$
declare
  v_all_book_id uuid;
  v_forest_book_id uuid;
  v_moon_book_id uuid;
  v_legendary_book_id uuid;
  rec record;
  v_leaderboard_id uuid;
begin
  perform seed_util.insert_json('album','books', $$ {
    "code":"ALL_COLLECTIONS",
    "name":"全系列图鉴",
    "display_name":"全系列图鉴",
    "description":"所有上线藏品的总收集进度。",
    "cover_url":"/storage/v1/object/public/banners/album_all.png",
    "active":true,
    "status":"active",
    "sort_order":10,
    "filter":{"scope":"all"},
    "metadata":{"seed_book":true}
  } $$::jsonb);

  perform seed_util.insert_json('album','books', $$ {
    "code":"FOREST_GUARDIANS_BOOK",
    "name":"森林守护者分册",
    "display_name":"森林守护者分册",
    "description":"Forest Guardians 系列收集进度。",
    "cover_url":"/storage/v1/object/public/banners/album_forest.png",
    "active":true,
    "status":"active",
    "sort_order":20,
    "filter":{"series":"FOREST_GUARDIANS"},
    "metadata":{"seed_book":true}
  } $$::jsonb);

  perform seed_util.insert_json('album','books', $$ {
    "code":"MOON_CROWN_BOOK",
    "name":"月冠分册",
    "display_name":"月冠分册",
    "description":"Moon Crown 系列收集进度。",
    "cover_url":"/storage/v1/object/public/banners/album_moon.png",
    "active":true,
    "status":"active",
    "sort_order":30,
    "filter":{"series":"MOON_CROWN"},
    "metadata":{"seed_book":true}
  } $$::jsonb);

  perform seed_util.insert_json('album','books', $$ {
    "code":"LEGENDARY_MYTHIC_BOOK",
    "name":"传说与神话图鉴",
    "display_name":"传说与神话图鉴",
    "description":"Legendary 和 Mythic 稀有藏品收集进度。",
    "cover_url":"/storage/v1/object/public/banners/album_legendary.png",
    "active":true,
    "status":"active",
    "sort_order":40,
    "filter":{"rarities":["LEGENDARY","MYTHIC"]},
    "metadata":{"seed_book":true}
  } $$::jsonb);

  select id into v_all_book_id from album.books where code = 'ALL_COLLECTIONS' limit 1;
  select id into v_forest_book_id from album.books where code = 'FOREST_GUARDIANS_BOOK' limit 1;
  select id into v_moon_book_id from album.books where code = 'MOON_CROWN_BOOK' limit 1;
  select id into v_legendary_book_id from album.books where code = 'LEGENDARY_MYTHIC_BOOK' limit 1;

  for rec in select id, slug, series_id, rarity_code from catalog.collectible_templates order by slug loop
    perform seed_util.insert_json('album','book_items', jsonb_build_object(
      'book_id', v_all_book_id,
      'template_id', rec.id,
      'sort_order', 10,
      'metadata', jsonb_build_object('seed_item', true)
    ));

    if exists(select 1 from catalog.series s where s.id = rec.series_id and s.code = 'FOREST_GUARDIANS') then
      perform seed_util.insert_json('album','book_items', jsonb_build_object('book_id', v_forest_book_id, 'template_id', rec.id, 'sort_order', 10));
    end if;

    if exists(select 1 from catalog.series s where s.id = rec.series_id and s.code = 'MOON_CROWN') then
      perform seed_util.insert_json('album','book_items', jsonb_build_object('book_id', v_moon_book_id, 'template_id', rec.id, 'sort_order', 10));
    end if;

    if rec.rarity_code in ('LEGENDARY','MYTHIC') then
      perform seed_util.insert_json('album','book_items', jsonb_build_object('book_id', v_legendary_book_id, 'template_id', rec.id, 'sort_order', 10));
    end if;
  end loop;

  -- Milestones
  for rec in
    select * from (values
      (v_all_book_id, 3, '[{"currency":"KCOIN","amount":300}]'::jsonb),
      (v_all_book_id, 6, '[{"currency":"FGEMS","amount":200}]'::jsonb),
      (v_all_book_id, 12, '[{"currency":"KCOIN","amount":1000},{"currency":"FGEMS","amount":500}]'::jsonb),
      (v_all_book_id, 18, '[{"currency":"KCOIN","amount":3000},{"currency":"FGEMS","amount":1200}]'::jsonb),
      (v_forest_book_id, 3, '[{"currency":"FGEMS","amount":150}]'::jsonb),
      (v_moon_book_id, 3, '[{"currency":"FGEMS","amount":150}]'::jsonb),
      (v_legendary_book_id, 1, '[{"currency":"KCOIN","amount":800}]'::jsonb),
      (v_legendary_book_id, 3, '[{"currency":"KCOIN","amount":2500},{"currency":"FGEMS","amount":800}]'::jsonb)
    ) as t(book_id, required_count, reward)
  loop
    perform seed_util.insert_json('album','milestones', jsonb_build_object(
      'book_id', rec.book_id,
      'required_count', rec.required_count,
      'reward', rec.reward,
      'rewards', rec.reward,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_milestone', true)
    ));
  end loop;

  perform seed_util.insert_json('album','score_rules', $$ {
    "code":"DEFAULT_ALBUM_SCORE",
    "name":"默认图鉴榜计分规则",
    "display_name":"默认图鉴榜计分规则",
    "active":true,
    "status":"active",
    "rule":{"COMMON":10,"RARE":30,"EPIC":80,"LEGENDARY":220,"MYTHIC":500,"mint_bonus":50},
    "metadata":{"seed_score_rule":true}
  } $$::jsonb);

  perform seed_util.insert_json('album','weekly_leaderboards', jsonb_build_object(
    'season_key', 'LAUNCH_WEEK_2026_05_20',
    'name', 'Launch Week Album Ranking',
    'display_name', 'Launch Week Album Ranking',
    'starts_at', '2026-05-20 00:00:00+00'::timestamptz,
    'ends_at', '2026-05-27 00:00:00+00'::timestamptz,
    'status', 'active',
    'metadata', jsonb_build_object('seed_leaderboard', true)
  ));
end $$;

commit;

-- ================================================================
-- END 009_album.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 010_market_rules.seed.sql
-- ================================================================

-- 010_market_rules.seed.sql
-- Marketplace fee, price health, suggested prices, upgrade/evolution/decompose rules.

begin;

do $$
declare
  rec record;
  v_from uuid;
  v_to uuid;
  v_i integer;
  v_cost integer;
  v_gain integer;
begin
  -- Marketplace fee: 5% KCOIN fee.
  perform seed_util.insert_json('economy','fee_rules', $$ {
    "code":"MARKET_DEFAULT_5_PERCENT",
    "name":"Marketplace Default Fee",
    "display_name":"Marketplace Default Fee",
    "fee_type":"market_sale",
    "fee_bps":500,
    "min_fee":1,
    "currency_code":"KCOIN",
    "active":true,
    "status":"active",
    "metadata":{"seed_fee":true,"description":"Default 5% marketplace fee."}
  } $$::jsonb);

  -- Price health by rarity.
  for rec in
    select * from (values
      ('COMMON', 30, 500, 80),
      ('RARE', 100, 1500, 350),
      ('EPIC', 500, 6000, 1600),
      ('LEGENDARY', 3000, 30000, 9000),
      ('MYTHIC', 12000, 120000, 40000)
    ) as t(rarity_code, min_price, max_price, suggested_price)
  loop
    perform seed_util.insert_json('market','price_health_rules', jsonb_build_object(
      'rarity_code', rec.rarity_code,
      'min_price_kcoin', rec.min_price,
      'max_price_kcoin', rec.max_price,
      'low_multiplier', 0.70,
      'high_multiplier', 1.35,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_price_health', true)
    ));

    perform seed_util.insert_json('catalog','market_price_rules', jsonb_build_object(
      'rarity_code', rec.rarity_code,
      'min_price_kcoin', rec.min_price,
      'max_price_kcoin', rec.max_price,
      'suggested_price_kcoin', rec.suggested_price,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_price_rule', true)
    ));
  end loop;

  -- Template-specific suggested prices.
  for rec in select id, slug, rarity_code from catalog.collectible_templates loop
    perform seed_util.insert_json('catalog','market_price_rules', jsonb_build_object(
      'template_id', rec.id,
      'rarity_code', rec.rarity_code,
      'min_price_kcoin', case rec.rarity_code when 'COMMON' then 30 when 'RARE' then 100 when 'EPIC' then 500 when 'LEGENDARY' then 3000 else 12000 end,
      'max_price_kcoin', case rec.rarity_code when 'COMMON' then 500 when 'RARE' then 1500 when 'EPIC' then 6000 when 'LEGENDARY' then 30000 else 120000 end,
      'suggested_price_kcoin', case rec.rarity_code when 'COMMON' then 80 when 'RARE' then 350 when 'EPIC' then 1600 when 'LEGENDARY' then 9000 else 40000 end,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_template_price', true, 'slug', rec.slug)
    ));
  end loop;

  -- Upgrade rules: exact level-by-level rows from 1 to 30.
  for rec in select * from (values
    ('COMMON', 10, 2),
    ('RARE', 25, 4),
    ('EPIC', 60, 8),
    ('LEGENDARY', 160, 15),
    ('MYTHIC', 400, 30)
  ) as t(rarity_code, base_cost, base_gain)
  loop
    for v_i in 1..30 loop
      v_cost := rec.base_cost + (v_i * rec.base_cost / 2);
      v_gain := rec.base_gain + floor(v_i / 3.0)::integer;
      perform seed_util.insert_json('inventory','upgrade_rules', jsonb_build_object(
        'rarity_code', rec.rarity_code,
        'from_level', v_i,
        'to_level', v_i + 1,
        'cost_fgems', v_cost,
        'power_gain', v_gain,
        'active', true,
        'status', 'active',
        'metadata', jsonb_build_object('seed_upgrade', true)
      ));
    end loop;
  end loop;

  -- Decompose rules by rarity and form index.
  for rec in select * from (values
    ('COMMON', 1, 20), ('RARE', 1, 60), ('EPIC', 1, 150), ('LEGENDARY', 1, 450), ('MYTHIC', 1, 1200),
    ('COMMON', 2, 45), ('RARE', 2, 130), ('EPIC', 2, 320), ('LEGENDARY', 2, 900), ('MYTHIC', 2, 2400),
    ('COMMON', 3, 90), ('RARE', 3, 260), ('EPIC', 3, 650), ('LEGENDARY', 3, 1800), ('MYTHIC', 3, 5000)
  ) as t(rarity_code, form_index, reward_fgems)
  loop
    perform seed_util.insert_json('inventory','decompose_rules', jsonb_build_object(
      'rarity_code', rec.rarity_code,
      'form_index', rec.form_index,
      'min_level', 1,
      'reward_fgems', rec.reward_fgems,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_decompose', true)
    ));
  end loop;

  -- Evolution rules: 3 same lower-form collectibles + KCOIN to next form.
  for rec in select * from (values
    ('sproutling_scout_1','sproutling_scout_2',300,8500),
    ('sproutling_scout_2','sproutling_scout_3',900,7000),
    ('mooncap_bard_1','mooncap_bard_2',300,8500),
    ('mooncap_bard_2','mooncap_bard_3',900,7000),
    ('crystal_otter_1','crystal_otter_2',300,8500),
    ('crystal_otter_2','crystal_otter_3',900,7000),
    ('ember_whelp_1','ember_whelp_2',1200,7000),
    ('ember_whelp_2','ember_whelp_3',3600,5500),
    ('starfall_warden_1','starfall_warden_2',1200,7000),
    ('starfall_warden_2','starfall_warden_3',3600,5500),
    ('aurora_kitsune_1','aurora_kitsune_2',5000,5000),
    ('aurora_kitsune_2','aurora_kitsune_3',15000,3500)
  ) as t(from_slug, to_slug, cost_kcoin, success_rate_bps)
  loop
    select id into v_from from catalog.collectible_templates where slug = rec.from_slug limit 1;
    select id into v_to from catalog.collectible_templates where slug = rec.to_slug limit 1;
    perform seed_util.insert_json('inventory','evolution_rules', jsonb_build_object(
      'from_template_id', v_from,
      'to_template_id', v_to,
      'required_count', 3,
      'cost_kcoin', rec.cost_kcoin,
      'success_rate_bps', rec.success_rate_bps,
      'active', true,
      'status', 'active',
      'metadata', jsonb_build_object('seed_evolution', true, 'failure_refund', 'highest_level_main_item_only')
    ));
  end loop;
end $$;

commit;

-- ================================================================
-- END 010_market_rules.seed.sql
-- ================================================================

-- ================================================================
-- BEGIN 011_feature_flags.seed.sql
-- ================================================================

-- 011_feature_flags.seed.sql
-- Feature flags, system settings, TON NFT collection defaults and launch banners.

begin;

do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('gacha_open_enabled', 'Open Box Enabled', true, '{"description":"Allow users to create and pay open-box orders."}'::jsonb),
      ('market_enabled', 'Marketplace Enabled', true, '{"description":"Allow buy, sell, reprice and cancel listings."}'::jsonb),
      ('inventory_growth_enabled', 'Inventory Growth Enabled', true, '{"description":"Allow upgrade, evolution and decomposition."}'::jsonb),
      ('tasks_enabled', 'Tasks Enabled', true, '{"description":"Allow task center, sign-in and reward claim."}'::jsonb),
      ('referral_enabled', 'Referral Enabled', true, '{"description":"Allow invite links, first-open reward and referral commission."}'::jsonb),
      ('wallet_connect_enabled', 'Wallet Connect Enabled', true, '{"description":"Allow TON wallet connect and proof verification."}'::jsonb),
      ('nft_mint_enabled', 'NFT Mint Enabled', false, '{"description":"Start disabled until TON NFT collection is deployed."}'::jsonb),
      ('leaderboard_enabled', 'Leaderboard Enabled', true, '{"description":"Allow weekly album leaderboard display."}'::jsonb),
      ('maintenance_mode', 'Maintenance Mode', false, '{"description":"When true, API should block non-admin mutations."}'::jsonb)
    ) as t(key, name, enabled, metadata)
  loop
    perform seed_util.insert_json('ops','feature_flags', jsonb_build_object(
      'key', rec.key,
      'name', rec.name,
      'display_name', rec.name,
      'enabled', rec.enabled,
      'active', true,
      'rollout', jsonb_build_object('type', 'global', 'percentage', case when rec.enabled then 100 else 0 end),
      'metadata', rec.metadata,
      'description', rec.metadata ->> 'description'
    ));
  end loop;

  for rec in
    select * from (values
      ('market_default_fee_bps', '500'::jsonb, 'Default marketplace fee, 500 = 5%'),
      ('gacha_ten_draw_discount_bps', '9000'::jsonb, 'Ten draw discount, 9000 = 9折'),
      ('gacha_open_reward_kcoin_per_draw', '100'::jsonb, 'K-coin reward returned after each paid draw'),
      ('referral_first_open_reward_kcoin', '500'::jsonb, 'Both inviter and invitee reward after invitee first paid open'),
      ('referral_commission_bps', '1000'::jsonb, 'Inviter commission from invited friend open reward, 1000 = 10%'),
      ('market_listing_expire_days', '30'::jsonb, 'Default listing expiration window'),
      ('max_draw_count_per_order', '10'::jsonb, 'Allowed max draw count per Stars payment order'),
      ('wallet_sync_cooldown_seconds', '60'::jsonb, 'Cooldown for wallet NFT sync')
    ) as t(key, value, description)
  loop
    perform seed_util.insert_json('ops','system_settings', jsonb_build_object(
      'key', rec.key,
      'value', rec.value,
      'description', rec.description,
      'metadata', jsonb_build_object('seed_setting', true)
    ));
  end loop;

  perform seed_util.insert_json('onchain','nft_collections', $$ {
    "code":"K_BOX_LAUNCH_COLLECTION",
    "chain":"TON",
    "network":"mainnet",
    "name":"K-Box Launch Collection",
    "display_name":"K-Box Launch Collection",
    "collection_address":null,
    "metadata_url":"/storage/v1/object/public/nft-metadata/collection.json",
    "royalty_bps":300,
    "status":"draft",
    "metadata":{"seed_collection":true,"standard":"TEP-62","royalty_standard":"TEP-66"}
  } $$::jsonb);

  -- Launch banners shown on market/task pages.
  perform seed_util.insert_json('catalog','banner_campaigns', $$ {
    "code":"MARKET_LAUNCH_DISCOUNT",
    "title":"Launch Market Event",
    "name":"Launch Market Event",
    "display_name":"Launch Market Event",
    "subtitle":"List and trade launch collectibles",
    "image_url":"/storage/v1/object/public/banners/market_launch_event.png",
    "placement":"market_top",
    "action_type":"internal_route",
    "action_payload":{"route":"/trade/buy","utm":"market_launch"},
    "status":"active",
    "active":true,
    "sort_order":10,
    "metadata":{"seed_banner":true}
  } $$::jsonb);

  perform seed_util.insert_json('catalog','banner_campaigns', $$ {
    "code":"INVITE_FRIENDS_500_KCOIN",
    "title":"Invite Friends",
    "name":"Invite Friends",
    "display_name":"Invite Friends",
    "subtitle":"Both sides get 500 K-coin after first open",
    "image_url":"/storage/v1/object/public/banners/invite_500_kcoin.png",
    "placement":"tasks_top",
    "action_type":"internal_route",
    "action_payload":{"route":"/tasks","section":"invite"},
    "status":"active",
    "active":true,
    "sort_order":20,
    "metadata":{"seed_banner":true}
  } $$::jsonb);
end $$;

commit;

-- ================================================================
-- END 011_feature_flags.seed.sql
-- ================================================================
