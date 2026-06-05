-- API private-schema RPC facade checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

create temp table _ids (
  key text primary key,
  id uuid
) on commit drop;

insert into _ids (key, id)
select
  'user',
  (api.auth_upsert_telegram_user(
    p_telegram_user_id := 9505004301,
    p_username := 'api_private_facade_user',
    p_first_name := 'Facade',
    p_last_name := 'User',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/api-private-facade.png',
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true)
  ) ->> 'user_id')::uuid;

insert into _ids (key, id)
values
  ('star_order', '71000000-0000-4000-8000-000000000001'),
  ('draw_order', '71000000-0000-4000-8000-000000000002'),
  ('banner', '71000000-0000-4000-8000-000000000003');

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  business_id,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  description,
  idempotency_key,
  expires_at
) values (
  (select id from _ids where key = 'star_order'),
  (select id from _ids where key = 'user'),
  'gacha_open',
  (select id from _ids where key = 'draw_order'),
  'created',
  10,
  'gacha_api_private_facade_payload_001',
  'Facade Box',
  'Open blind box x1',
  'api-private-facade-star-order-001',
  now() + interval '15 minutes'
);

select ok(
  has_function_privilege('service_role', 'api.payment_get_star_order_for_invoice(uuid)', 'EXECUTE'),
  'service_role can execute payment_get_star_order_for_invoice'
);

select ok(
  not has_function_privilege('anon', 'api.payment_get_star_order_for_invoice(uuid)', 'EXECUTE'),
  'anon cannot execute payment_get_star_order_for_invoice'
);

select is(
  api.payment_get_star_order_for_invoice((select id from _ids where key = 'star_order')) ->> 'telegram_invoice_payload',
  'gacha_api_private_facade_payload_001',
  'payment_get_star_order_for_invoice returns the invoice payload'
);

select ok(
  api.payment_get_star_invoice_by_payload('gacha_api_private_facade_payload_001') is null,
  'payment_get_star_invoice_by_payload returns null before invoice is stored'
);

select is(
  api.payment_upsert_star_invoice_success(
    (select id from _ids where key = 'star_order'),
    'gacha_api_private_facade_payload_001',
    'https://t.me/invoice/api-private-facade',
    'web_app_open_invoice',
    now() + interval '15 minutes',
    jsonb_build_object('provider_token_configured', false),
    jsonb_build_object('ok', true)
  ) ->> 'invoice_link',
  'https://t.me/invoice/api-private-facade',
  'payment_upsert_star_invoice_success stores invoice link'
);

select is(
  api.payment_get_star_invoice_by_payload('gacha_api_private_facade_payload_001') ->> 'status',
  'created',
  'payment_get_star_invoice_by_payload reads the stored invoice'
);

select is(
  (api.gacha_count_recent_draw_orders(
    (select id from _ids where key = 'user'),
    now() - interval '5 minutes'
  ) ->> 'count')::integer,
  0,
  'gacha_count_recent_draw_orders returns zero when the user has no draw rows'
);

insert into catalog.banner_campaigns (
  id,
  code,
  title,
  description,
  image_url,
  placement,
  target_type,
  target_ref,
  target_payload,
  status,
  starts_at,
  ends_at,
  sort_order,
  metadata
) values (
  (select id from _ids where key = 'banner'),
  'api-private-facade-banner',
  'API Private Facade Banner',
  'test banner',
  '/storage/v1/object/public/banners/api-private-facade.png',
  'box_top',
  'external',
  'https://example.test/event',
  jsonb_build_object('url', 'https://example.test/event'),
  'active',
  now() - interval '1 minute',
  now() + interval '1 day',
  1,
  jsonb_build_object('test', true)
);

select is(
  api.catalog_list_banner_campaigns('box_top', 10) -> 0 ->> 'code',
  'api-private-facade-banner',
  'catalog_list_banner_campaigns returns active banners through api schema'
);

select * from finish();

rollback;
