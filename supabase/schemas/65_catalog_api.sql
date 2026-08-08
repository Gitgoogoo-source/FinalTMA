create or replace function api.catalog_current()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'version', 'v1',
    'product_checksum', version.product_checksum,
    'asset_revision', current_release.revision,
    'release_key', release.release_key
  )
  into v_result
  from catalog.current_asset_release current_release
  join catalog.asset_releases release
    on release.id = current_release.release_id
   and release.status = 'active'
  cross join catalog.versions version
  where current_release.singleton
    and version.id = 'v1';

  if v_result is null then
    perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
  end if;

  return v_result;
end
$$;

create or replace function api.catalog_release(
  p_product_checksum text,
  p_release_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
  v_result jsonb;
begin
  if p_product_checksum is null
    or p_product_checksum !~ '^[0-9a-f]{64}$'
    or p_release_key is null
    or p_release_key !~ '^[a-z0-9][a-z0-9._-]{2,127}$'
    or not exists (
      select 1
      from catalog.versions version
      where version.id = 'v1'
        and version.product_checksum = p_product_checksum
    )
  then
    perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
  end if;

  select release.id
  into v_release_id
  from catalog.asset_releases release
  where release.release_key = p_release_key
    and release.status in ('active', 'retired');

  if v_release_id is null then
    perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
  end if;

  select jsonb_build_object(
    'version', 'v1',
    'product_checksum', p_product_checksum,
    'release_key', p_release_key,
    'chains', coalesce((
      select jsonb_agg(to_jsonb(chain) order by chain.global_order)
      from catalog.chains chain
      where chain.catalog_version = 'v1'
    ), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', template.id,
        'chain_id', template.chain_id,
        'stage', template.stage,
        'rarity', template.rarity,
        'name', template.name,
        'sort_order', template.sort_order,
        'combat_power', template.combat_power,
        'market_price', template.market_price,
        'decompose_fgems', template.decompose_fgems,
        'expedition_fgems', template.expedition_fgems,
        'image_thumbnail_url', config.public_origin || '/' || config.public_bucket || '/' || thumbnail.object_key,
        'image_detail_url', config.public_origin || '/' || config.public_bucket || '/' || detail.object_key,
        'draw_weight', template.draw_weight,
        'catalog_version', template.catalog_version
      ) order by template.sort_order)
      from catalog.asset_release_templates item
      join catalog.templates template
        on template.id = item.template_id
       and template.catalog_version = 'v1'
      join catalog.asset_objects thumbnail
        on thumbnail.id = item.thumbnail_object_id
       and thumbnail.object_class = 'runtime'
       and thumbnail.status = 'active'
       and thumbnail.width = 256
       and thumbnail.object_key ~ '^catalog/v[12]/thumb/'
      join catalog.asset_objects detail
        on detail.id = item.detail_object_id
       and detail.object_class = 'runtime'
       and detail.status = 'active'
       and detail.width = 768
       and detail.object_key ~ '^catalog/v[12]/detail/'
      cross join catalog.asset_delivery_config config
      where item.release_id = v_release_id
        and config.singleton
        and thumbnail.bucket = config.public_bucket
        and detail.bucket = config.public_bucket
    ), '[]'::jsonb),
    'boxes', coalesce((
      select jsonb_agg(to_jsonb(box) order by case box.tier when 'normal' then 1 when 'rare' then 2 else 3 end)
      from gacha.boxes box
    ), '[]'::jsonb),
    'topup_products', coalesce((
      select jsonb_agg(product.amount order by product.sort_order)
      from payments.topup_products product
    ), '[]'::jsonb)
  )
  into v_result;

  if jsonb_array_length(v_result->'chains') <> 70
    or jsonb_array_length(v_result->'templates') <> 210
    or jsonb_array_length(v_result->'boxes') <> 3
    or jsonb_array_length(v_result->'topup_products') <> 5
  then
    perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
  end if;

  return v_result;
end
$$;
