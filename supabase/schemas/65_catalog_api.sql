create or replace function api.catalog_get()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 'v1',
    'product_checksum', (select product_checksum from catalog.versions where id = 'v1'),
    'asset_revision', (select revision from catalog.current_asset_release where singleton),
    'chains', coalesce((select jsonb_agg(to_jsonb(c) order by c.global_order) from catalog.chains c), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'chain_id', t.chain_id,
      'stage', t.stage,
      'rarity', t.rarity,
      'name', t.name,
      'sort_order', t.sort_order,
      'combat_power', t.combat_power,
      'market_price', t.market_price,
      'decompose_fgems', t.decompose_fgems,
      'expedition_fgems', t.expedition_fgems,
      'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
      'image_detail_url', catalog.template_detail_url(t.id),
      'draw_weight', t.draw_weight,
      'catalog_version', t.catalog_version
    ) order by t.sort_order) from catalog.templates t), '[]'::jsonb),
    'boxes', coalesce((select jsonb_agg(to_jsonb(b) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end) from gacha.boxes b), '[]'::jsonb),
    'topup_products', coalesce((select jsonb_agg(p.amount order by p.sort_order) from payments.topup_products p), '[]'::jsonb)
  )
$$;
