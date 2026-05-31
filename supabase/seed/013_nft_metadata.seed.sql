-- 013_nft_metadata.seed.sql
-- Keep local db reset seed data aligned with Phase 5 static NFT metadata requirements.

begin;

with default_forms as (
  select
    t.id as template_id,
    t.slug,
    f.id as form_id,
    coalesce(
      (
        select m.url
        from catalog.collectible_media m
        where m.template_id = t.id
          and m.form_id = f.id
          and m.media_type = 'card'
          and nullif(m.url, '') is not null
        order by m.sort_order, m.created_at
        limit 1
      ),
      nullif(f.image_url, ''),
      nullif(f.thumbnail_url, ''),
      nullif(f.avatar_url, '')
    ) as nft_image_url
  from catalog.collectible_templates t
  join lateral (
    select cf.*
    from catalog.collectible_forms cf
    where cf.template_id = t.id
    order by cf.is_default desc, cf.form_index asc, cf.created_at asc
    limit 1
  ) f on true
  where t.release_status = 'active'
    and t.nft_mintable = true
)
insert into catalog.collectible_media (
  template_id,
  form_id,
  media_type,
  url,
  storage_bucket,
  storage_path,
  mime_type,
  sort_order,
  metadata
)
select
  template_id,
  form_id,
  'nft_image',
  nft_image_url,
  null,
  null,
  'image/png',
  50,
  jsonb_build_object(
    'phase', 'phase5',
    'usage', 'nft_image',
    'source', 'static_metadata_seed'
  )
from default_forms df
where df.nft_image_url is not null
  and not exists (
    select 1
    from catalog.collectible_media existing
    where existing.template_id = df.template_id
      and existing.form_id = df.form_id
      and existing.media_type = 'nft_image'
      and nullif(existing.url, '') is not null
  );

with default_forms as (
  select
    t.id as template_id,
    t.slug,
    f.id as form_id
  from catalog.collectible_templates t
  join lateral (
    select cf.*
    from catalog.collectible_forms cf
    where cf.template_id = t.id
    order by cf.is_default desc, cf.form_index asc, cf.created_at asc
    limit 1
  ) f on true
  where t.release_status = 'active'
    and t.nft_mintable = true
)
insert into catalog.collectible_media (
  template_id,
  form_id,
  media_type,
  url,
  storage_bucket,
  storage_path,
  mime_type,
  sort_order,
  metadata
)
select
  template_id,
  form_id,
  'metadata',
  '/nft-metadata/items/' || slug || '.json',
  null,
  'nft-metadata/items/' || slug || '.json',
  'application/json',
  60,
  jsonb_build_object(
    'phase', 'phase5',
    'usage', 'nft_metadata',
    'source', 'static_metadata_seed'
  )
from default_forms df
where not exists (
  select 1
  from catalog.collectible_media existing
  where existing.template_id = df.template_id
    and existing.form_id = df.form_id
    and existing.media_type = 'metadata'
    and existing.url = '/nft-metadata/items/' || df.slug || '.json'
    and existing.mime_type = 'application/json'
);

update catalog.collectible_templates t
set metadata = t.metadata || jsonb_build_object(
      'nft_metadata_strategy', 'static_public_vite',
      'nft_metadata_path', '/nft-metadata/items/' || t.slug || '.json'
    ),
    updated_at = now()
where t.release_status = 'active'
  and t.nft_mintable = true
  and (
    t.metadata ->> 'nft_metadata_strategy' is distinct from 'static_public_vite'
    or t.metadata ->> 'nft_metadata_path' is distinct from '/nft-metadata/items/' || t.slug || '.json'
  );

commit;
