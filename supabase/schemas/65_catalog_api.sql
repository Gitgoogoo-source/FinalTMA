create or replace function api.catalog_get()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 'v1',
    'product_checksum', (select product_checksum from catalog.versions where id = 'v1'),
    'chains', coalesce((select jsonb_agg(to_jsonb(c) order by c.global_order) from catalog.chains c), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from catalog.templates t), '[]'::jsonb),
    'boxes', coalesce((select jsonb_agg(to_jsonb(b) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end) from gacha.boxes b), '[]'::jsonb),
    'topup_products', coalesce((select jsonb_agg(p.amount order by p.sort_order) from payments.topup_products p), '[]'::jsonb)
  )
$$;
