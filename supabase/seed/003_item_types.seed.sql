-- 003_item_types.seed.sql
-- Item type taxonomy for catalog filters and future market listings.

begin;

insert into catalog.item_types (
  code,
  display_name,
  sort_order,
  metadata
) values
  (
    'CHARACTER',
    'Character',
    10,
    '{"display_name_cn":"角色","trade_filter":true,"album_required":true}'::jsonb
  ),
  (
    'PET',
    'Pet',
    20,
    '{"display_name_cn":"宠物","trade_filter":true,"album_required":true}'::jsonb
  ),
  (
    'EGG',
    'Egg',
    30,
    '{"display_name_cn":"蛋","trade_filter":false,"album_required":false}'::jsonb
  ),
  (
    'DECORATION',
    'Decoration',
    40,
    '{"display_name_cn":"装饰","trade_filter":true,"album_required":false}'::jsonb
  ),
  (
    'MATERIAL',
    'Material',
    50,
    '{"display_name_cn":"材料","trade_filter":false,"album_required":false}'::jsonb
  )
on conflict (code) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order,
    metadata = catalog.item_types.metadata || excluded.metadata;

commit;
