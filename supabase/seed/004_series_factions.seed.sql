-- 004_series_factions.seed.sql
-- Launch series and factions used by collectible templates and album grouping.

begin;

insert into catalog.series (
  slug,
  display_name,
  description,
  cover_url,
  sort_order,
  status,
  metadata
) values
  (
    'forest_guardians',
    'Forest Guardians',
    'Sprites, scouts and beasts that protect the green borderlands.',
    '/storage/v1/object/public/banners/series_forest_guardians.png',
    10,
    'active',
    '{"display_name_cn":"森境守护者","theme":"forest"}'::jsonb
  ),
  (
    'moon_crown',
    'Moon Crown',
    'Moonlit bards, wardens and royal guardians.',
    '/storage/v1/object/public/banners/series_moon_crown.png',
    20,
    'active',
    '{"display_name_cn":"月冕王庭","theme":"lunar"}'::jsonb
  ),
  (
    'crystal_cove',
    'Crystal Cove',
    'Water and crystal creatures from the hidden cove.',
    '/storage/v1/object/public/banners/series_crystal_cove.png',
    30,
    'active',
    '{"display_name_cn":"晶潮海湾","theme":"crystal"}'::jsonb
  ),
  (
    'dragon_fire',
    'Dragon Fire',
    'Ember drakes and fire-forged beasts.',
    '/storage/v1/object/public/banners/series_dragon_fire.png',
    40,
    'active',
    '{"display_name_cn":"龙焰巢域","theme":"flame"}'::jsonb
  )
on conflict (slug) do update
set display_name = excluded.display_name,
    description = excluded.description,
    cover_url = excluded.cover_url,
    sort_order = excluded.sort_order,
    status = excluded.status,
    metadata = catalog.series.metadata || excluded.metadata,
    updated_at = now();

insert into catalog.factions (
  slug,
  display_name,
  description,
  icon_url,
  sort_order,
  metadata
) values
  (
    'forest',
    'Forest Pact',
    'Nature-aligned faction.',
    '/storage/v1/object/public/icons/faction_forest.png',
    10,
    '{"display_name_cn":"森盟","element":"wood"}'::jsonb
  ),
  (
    'lunar',
    'Lunar Court',
    'Moon and song faction.',
    '/storage/v1/object/public/icons/faction_lunar.png',
    20,
    '{"display_name_cn":"月庭","element":"moon"}'::jsonb
  ),
  (
    'crystal',
    'Crystal Tide',
    'Water and crystal faction.',
    '/storage/v1/object/public/icons/faction_crystal.png',
    30,
    '{"display_name_cn":"晶潮","element":"water"}'::jsonb
  ),
  (
    'flame',
    'Flame Nest',
    'Fire and dragon faction.',
    '/storage/v1/object/public/icons/faction_flame.png',
    40,
    '{"display_name_cn":"焰巢","element":"fire"}'::jsonb
  )
on conflict (slug) do update
set display_name = excluded.display_name,
    description = excluded.description,
    icon_url = excluded.icon_url,
    sort_order = excluded.sort_order,
    metadata = catalog.factions.metadata || excluded.metadata,
    updated_at = now();

commit;
