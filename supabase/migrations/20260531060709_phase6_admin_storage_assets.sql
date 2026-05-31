-- Phase 6: admin asset upload buckets and public URL guardrails.
-- Assets are uploaded to private admin-temp first, then published into the
-- public bucket that matches the admin surface being saved.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  updated_at
)
values
  (
    'admin-temp',
    'admin-temp',
    false,
    52428800,
    array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'video/webm',
      'video/mp4',
      'application/json'
    ],
    now()
  ),
  (
    'banners',
    'banners',
    true,
    10485760,
    array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif'
    ],
    now()
  ),
  (
    'boxes',
    'boxes',
    true,
    31457280,
    array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'video/webm',
      'video/mp4'
    ],
    now()
  ),
  (
    'collectibles',
    'collectibles',
    true,
    20971520,
    array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif'
    ],
    now()
  )
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();

create or replace function api._admin_is_allowed_storage_public_url(
  p_url text,
  p_allowed_buckets text[]
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_url text := nullif(trim(coalesce(p_url, '')), '');
  v_match text[];
  v_protocol text;
  v_host text;
  v_bucket text;
  v_object_path text;
begin
  if v_url is null then
    return false;
  end if;

  v_match := regexp_match(
    v_url,
    '^(?:(https?)://([^/]+))?/storage/v1/object/public/([^/]+)/(.+)$',
    'i'
  );

  if v_match is null then
    return false;
  end if;

  v_protocol := lower(coalesce(v_match[1], ''));
  v_host := lower(coalesce(v_match[2], ''));
  v_bucket := v_match[3];
  v_object_path := v_match[4];

  if v_bucket is null
     or v_object_path is null
     or v_object_path = ''
     or position('..' in v_object_path) > 0 then
    return false;
  end if;

  if not v_bucket = any(p_allowed_buckets) then
    return false;
  end if;

  if v_host = '' then
    return true;
  end if;

  if v_host = 'localhost'
     or v_host like 'localhost:%'
     or v_host = '127.0.0.1'
     or v_host like '127.0.0.1:%' then
    return v_protocol in ('http', 'https');
  end if;

  return v_protocol = 'https'
      and v_host like '%.supabase.co';
end;
$$;

revoke all on function api._admin_is_allowed_storage_public_url(text, text[])
  from public, anon, authenticated;
grant execute on function api._admin_is_allowed_storage_public_url(text, text[])
  to service_role;

comment on function api._admin_is_allowed_storage_public_url(text, text[])
  is 'Validates that admin-published image URLs point to allowed public Supabase Storage buckets.';

alter table catalog.banner_campaigns
  drop constraint if exists banner_campaigns_image_url_storage_check;

alter table catalog.banner_campaigns
  add constraint banner_campaigns_image_url_storage_check
  check (api._admin_is_allowed_storage_public_url(image_url, array['banners']));

alter table gacha.blind_boxes
  drop constraint if exists blind_boxes_cover_image_url_storage_check;

alter table gacha.blind_boxes
  add constraint blind_boxes_cover_image_url_storage_check
  check (
    cover_image_url is null
    or api._admin_is_allowed_storage_public_url(cover_image_url, array['boxes'])
  );

alter table gacha.blind_boxes
  drop constraint if exists blind_boxes_hero_image_url_storage_check;

alter table gacha.blind_boxes
  add constraint blind_boxes_hero_image_url_storage_check
  check (
    hero_image_url is null
    or api._admin_is_allowed_storage_public_url(hero_image_url, array['boxes'])
  );
