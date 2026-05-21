-- 002_rarities.seed.sql
-- First-stage rarity ladder used by catalog display, drop pools and pity rules.

begin;

insert into catalog.rarities (
  code,
  display_name,
  sort_order,
  color_token,
  label_bg_token,
  min_power,
  pity_eligible,
  default_decompose_fgems,
  metadata
) values
  (
    'COMMON',
    'Common',
    10,
    'rarity-common',
    'rarity-common-bg',
    10,
    false,
    20,
    '{"display_name_cn":"普通","album_score":10}'::jsonb
  ),
  (
    'RARE',
    'Rare',
    20,
    'rarity-rare',
    'rarity-rare-bg',
    35,
    true,
    60,
    '{"display_name_cn":"稀有","album_score":30}'::jsonb
  ),
  (
    'EPIC',
    'Epic',
    30,
    'rarity-epic',
    'rarity-epic-bg',
    90,
    true,
    150,
    '{"display_name_cn":"史诗","album_score":80}'::jsonb
  ),
  (
    'LEGENDARY',
    'Legendary',
    40,
    'rarity-legendary',
    'rarity-legendary-bg',
    180,
    true,
    450,
    '{"display_name_cn":"传说","album_score":220}'::jsonb
  )
on conflict (code) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order,
    color_token = excluded.color_token,
    label_bg_token = excluded.label_bg_token,
    min_power = excluded.min_power,
    pity_eligible = excluded.pity_eligible,
    default_decompose_fgems = excluded.default_decompose_fgems,
    metadata = catalog.rarities.metadata || excluded.metadata;

commit;
