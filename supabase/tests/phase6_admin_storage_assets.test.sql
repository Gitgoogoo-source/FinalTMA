-- Phase 6 admin Storage bucket and asset URL guardrail checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.raises_like(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm like p_pattern;
end;
$$;

select no_plan();

select is(
  (select public from storage.buckets where id = 'admin-temp'),
  false,
  'admin-temp bucket is private'
);

select is(
  (select public from storage.buckets where id = 'banners'),
  true,
  'banners bucket is public'
);

select is(
  (select public from storage.buckets where id = 'boxes'),
  true,
  'boxes bucket is public'
);

select is(
  (select public from storage.buckets where id = 'collectibles'),
  true,
  'collectibles bucket is public'
);

select ok(
  (select allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp', 'image/gif'] from storage.buckets where id = 'banners'),
  'banners bucket accepts only image upload formats used by admin assets'
);

select ok(
  (select file_size_limit = 10485760 from storage.buckets where id = 'banners'),
  'banners bucket has a 10 MiB limit'
);

select ok(
  api._admin_is_allowed_storage_public_url(
    '/storage/v1/object/public/banners/phase6/banner.png',
    array['banners']
  ),
  'relative public banner Storage URL is allowed'
);

select ok(
  api._admin_is_allowed_storage_public_url(
    'https://omopnbourswzyeigotbs.supabase.co/storage/v1/object/public/boxes/phase6/box.webp',
    array['boxes']
  ),
  'Supabase-hosted box Storage URL is allowed'
);

select ok(
  not api._admin_is_allowed_storage_public_url(
    'https://cdn.example.test/storage/v1/object/public/banners/phase6/banner.png',
    array['banners']
  ),
  'non-Supabase public-looking URL is rejected'
);

select ok(
  not api._admin_is_allowed_storage_public_url(
    'http://omopnbourswzyeigotbs.supabase.co/storage/v1/object/public/banners/phase6/banner.png',
    array['banners']
  ),
  'Supabase production Storage URLs must use HTTPS'
);

select ok(
  not api._admin_is_allowed_storage_public_url(
    '/storage/v1/object/public/boxes/phase6/wrong-bucket.png',
    array['banners']
  ),
  'wrong public bucket is rejected'
);

insert into catalog.banner_campaigns (
  id,
  code,
  title,
  image_url,
  placement,
  target_type,
  target_payload,
  status
)
values (
  '65000000-0000-4000-8000-000000000001',
  'phase6_storage_banner',
  'Phase 6 Storage Banner',
  '/storage/v1/object/public/banners/phase6/banner.png',
  'home_top',
  'none',
  '{}'::jsonb,
  'draft'
)
on conflict (id) do update
set image_url = excluded.image_url,
    updated_at = now();

select ok(
  exists (
    select 1
    from catalog.banner_campaigns
    where id = '65000000-0000-4000-8000-000000000001'
      and image_url = '/storage/v1/object/public/banners/phase6/banner.png'
  ),
  'banner campaigns accept published banner Storage URLs'
);

select ok(
  testutil.raises_like(
    $sql$
      insert into catalog.banner_campaigns (
        code,
        title,
        image_url,
        placement,
        target_type,
        target_payload,
        status
      )
      values (
        'phase6_bad_storage_banner',
        'Bad Storage Banner',
        'https://cdn.example.test/banner.png',
        'home_top',
        'none',
        '{}'::jsonb,
        'draft'
      )
    $sql$,
    '%banner_campaigns_image_url_storage_check%'
  ),
  'banner campaigns reject non-Storage image_url values'
);

insert into gacha.blind_boxes (
  id,
  slug,
  display_name,
  tier,
  status,
  price_stars,
  cover_image_url,
  hero_image_url
)
values (
  '65000000-0000-4000-8000-000000000101',
  'phase6_storage_box',
  'Phase 6 Storage Box',
  'normal',
  'draft',
  10,
  '/storage/v1/object/public/boxes/phase6/cover.png',
  '/storage/v1/object/public/boxes/phase6/hero.png'
)
on conflict (id) do update
set cover_image_url = excluded.cover_image_url,
    hero_image_url = excluded.hero_image_url,
    updated_at = now();

select ok(
  testutil.raises_like(
    $sql$
      update gacha.blind_boxes
      set cover_image_url = 'https://cdn.example.test/box.png'
      where id = '65000000-0000-4000-8000-000000000101'
    $sql$,
    '%blind_boxes_cover_image_url_storage_check%'
  ),
  'blind boxes reject non-Storage cover_image_url values'
);

select finish();

rollback;
