-- Phase 6 catalog/album admin operations added for catalog P2 coverage.

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

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb
) on commit drop;

insert into ops.admin_users (id, email, display_name, status, metadata)
values (
  '6a000000-0000-4000-8000-000000000001',
  'phase6-catalog-album-admin@example.test',
  'Phase 6 Catalog Album Admin',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_roles (code, display_name, permissions)
values (
  'PHASE6_CATALOG_ALBUM_WRITE',
  'Phase 6 Catalog Album Write',
  '["catalog:read","catalog:write"]'::jsonb
)
on conflict (code) do update
set permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select '6a000000-0000-4000-8000-000000000001'::uuid, id, '6a000000-0000-4000-8000-000000000001'::uuid
from ops.admin_roles
where code = 'PHASE6_CATALOG_ALBUM_WRITE'
on conflict (admin_user_id, role_id) do nothing;

with template_row as (
  insert into catalog.collectible_templates (
    slug,
    display_name,
    rarity_code,
    type_code,
    base_power,
    max_level,
    release_status,
    tradeable,
    upgradeable,
    evolvable,
    decomposable,
    nft_mintable,
    sort_order,
    metadata
  )
  values (
    'phase6-catalog-admin-template',
    'Phase 6 Catalog Admin Template',
    'COMMON',
    'CHARACTER',
    10,
    10,
    'active',
    true,
    true,
    true,
    true,
    true,
    10,
    '{"fixture":true}'::jsonb
  )
  on conflict (slug) do update
  set release_status = excluded.release_status,
      tradeable = excluded.tradeable,
      upgradeable = excluded.upgradeable,
      evolvable = excluded.evolvable,
      decomposable = excluded.decomposable,
      nft_mintable = excluded.nft_mintable,
      sort_order = excluded.sort_order,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id)
select 'template', id from template_row;

with book_row as (
  insert into album.books (
    code,
    display_name,
    description,
    book_type,
    active,
    sort_order,
    metadata
  )
  values (
    'phase6_catalog_admin_book',
    'Phase 6 Catalog Admin Book',
    'Catalog admin fixture',
    'event',
    true,
    10,
    '{"fixture":true}'::jsonb
  )
  on conflict (code) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      active = excluded.active,
      sort_order = excluded.sort_order,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id)
select 'book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values ((select id from _ids where key = 'book'), (select id from _ids where key = 'template'), 10)
on conflict (book_id, template_id) do update
set sort_order = excluded.sort_order;

with milestone_row as (
  insert into album.milestones (
    book_id,
    required_count,
    title,
    reward,
    active,
    sort_order,
    metadata
  )
  values (
    (select id from _ids where key = 'book'),
    1,
    'Phase 6 Catalog Admin Reward',
    jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 10)),
    true,
    10,
    '{"fixture":true}'::jsonb
  )
  on conflict (book_id, required_count) do update
  set title = excluded.title,
      reward = excluded.reward,
      active = excluded.active,
      sort_order = excluded.sort_order,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id)
select 'milestone', id from milestone_row;

insert into _ids (key, id)
values ('actor', '6a000000-0000-4000-8000-000000000001');

insert into _ids (key, payload)
select 'template_update', api.admin_update_collectible_template_ops(
  p_admin_user_id => (select id from _ids where key = 'actor'),
  p_template_id => (select id from _ids where key = 'template'),
  p_release_status => 'hidden',
  p_tradeable => false,
  p_upgradeable => false,
  p_evolvable => true,
  p_decomposable => true,
  p_nft_mintable => false,
  p_sort_order => 25,
  p_metadata => '{"ops":"p2"}'::jsonb,
  p_reason => 'catalog p2 test',
  p_idempotency_key => 'phase6-catalog-admin-template-update-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

select is((select release_status from catalog.collectible_templates where id = (select id from _ids where key = 'template')), 'hidden', 'catalog admin update writes release status');
select is((select tradeable from catalog.collectible_templates where id = (select id from _ids where key = 'template')), false, 'catalog admin update writes tradeable flag');
select is(((select payload from _ids where key = 'template_update') ->> 'audit_log_id') is not null, true, 'catalog admin update returns audit log id');
select is((
  select count(*)::integer
  from ops.admin_audit_logs
  where action = 'catalog.collectible_template.ops.update'
    and target_id = (select id from _ids where key = 'template')
), 1, 'catalog admin update writes one audit log');

insert into _ids (key, payload)
select 'template_update_repeat', api.admin_update_collectible_template_ops(
  p_admin_user_id => (select id from _ids where key = 'actor'),
  p_template_id => (select id from _ids where key = 'template'),
  p_release_status => 'hidden',
  p_tradeable => false,
  p_upgradeable => false,
  p_evolvable => true,
  p_decomposable => true,
  p_nft_mintable => false,
  p_sort_order => 25,
  p_metadata => '{"ops":"p2"}'::jsonb,
  p_reason => 'catalog p2 test',
  p_idempotency_key => 'phase6-catalog-admin-template-update-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

select ok(((select payload from _ids where key = 'template_update_repeat') ->> 'idempotent')::boolean, 'catalog admin update idempotent repeat returns cached response');
select is((
  select count(*)::integer
  from ops.admin_audit_logs
  where action = 'catalog.collectible_template.ops.update'
    and target_id = (select id from _ids where key = 'template')
), 1, 'catalog admin update idempotent repeat writes no extra audit log');

grant select on _ids to anon;
set local role anon;
select is((
  select count(*)::integer
  from public.v_collectible_catalog
  where template_id = (select id from _ids where key = 'template')
), 0, 'public collectible catalog view hides hidden templates');
select is((
  select count(*)::integer
  from catalog.collectible_templates
  where id = (select id from _ids where key = 'template')
), 0, 'catalog template RLS hides hidden templates from anon');
reset role;

insert into _ids (key, payload)
select 'template_full_upsert', api.admin_upsert_collectible_template(
  p_admin_user_id => (select id from _ids where key = 'actor'),
  p_template_id => (select id from _ids where key = 'template'),
  p_template => jsonb_build_object(
    'slug', 'phase6-catalog-admin-template',
    'display_name', 'Phase 6 Catalog Full Template',
    'subtitle', 'Full ops',
    'description', 'Full catalog admin update',
    'rarity_code', 'COMMON',
    'type_code', 'CHARACTER',
    'base_power', 20,
    'max_level', 15,
    'supply_limit', 1,
    'release_status', 'active',
    'tradeable', true,
    'upgradeable', true,
    'evolvable', true,
    'decomposable', true,
    'nft_mintable', false,
    'sort_order', 30,
    'metadata', '{"ops":"full"}'::jsonb
  ),
  p_forms => jsonb_build_array(jsonb_build_object(
    'form_slug', 'base',
    'form_index', 1,
    'display_name', 'Base Form',
    'base_power_bonus', 3,
    'is_default', true,
    'metadata', '{"fixture":true}'::jsonb
  )),
  p_media => jsonb_build_array(jsonb_build_object(
    'form_slug', 'base',
    'media_type', 'card',
    'url', 'https://example.test/catalog/base-card.png',
    'sort_order', 10,
    'metadata', '{"fixture":true}'::jsonb
  )),
  p_reason => 'catalog full upsert test',
  p_idempotency_key => 'phase6-catalog-admin-full-upsert-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

select is((select display_name from catalog.collectible_templates where id = (select id from _ids where key = 'template')), 'Phase 6 Catalog Full Template', 'catalog full upsert writes template core fields');
select is((select base_power from catalog.collectible_templates where id = (select id from _ids where key = 'template')), 20, 'catalog full upsert writes base power');
select is((select supply_limit from catalog.collectible_templates where id = (select id from _ids where key = 'template')), 1, 'catalog full upsert writes supply limit');
select is((
  select count(*)::integer
  from catalog.collectible_forms
  where template_id = (select id from _ids where key = 'template')
), 1, 'catalog full upsert replaces forms');
select is((
  select count(*)::integer
  from catalog.collectible_media
  where template_id = (select id from _ids where key = 'template')
), 1, 'catalog full upsert replaces media');
select is(((select payload from _ids where key = 'template_full_upsert') ->> 'audit_log_id') is not null, true, 'catalog full upsert returns audit log id');
select is((
  select count(*)::integer
  from ops.admin_audit_logs
  where action = 'catalog.collectible_template.upsert'
    and target_id = (select id from _ids where key = 'template')
), 1, 'catalog full upsert writes one audit log');

insert into _ids (key, payload)
select 'template_full_upsert_repeat', api.admin_upsert_collectible_template(
  p_admin_user_id => (select id from _ids where key = 'actor'),
  p_template_id => (select id from _ids where key = 'template'),
  p_template => jsonb_build_object(
    'slug', 'phase6-catalog-admin-template',
    'display_name', 'Phase 6 Catalog Full Template',
    'subtitle', 'Full ops',
    'description', 'Full catalog admin update',
    'rarity_code', 'COMMON',
    'type_code', 'CHARACTER',
    'base_power', 20,
    'max_level', 15,
    'supply_limit', 1,
    'release_status', 'active',
    'tradeable', true,
    'upgradeable', true,
    'evolvable', true,
    'decomposable', true,
    'nft_mintable', false,
    'sort_order', 30,
    'metadata', '{"ops":"full"}'::jsonb
  ),
  p_forms => jsonb_build_array(jsonb_build_object(
    'form_slug', 'base',
    'form_index', 1,
    'display_name', 'Base Form',
    'base_power_bonus', 3,
    'is_default', true,
    'metadata', '{"fixture":true}'::jsonb
  )),
  p_media => jsonb_build_array(jsonb_build_object(
    'form_slug', 'base',
    'media_type', 'card',
    'url', 'https://example.test/catalog/base-card.png',
    'sort_order', 10,
    'metadata', '{"fixture":true}'::jsonb
  )),
  p_reason => 'catalog full upsert test',
  p_idempotency_key => 'phase6-catalog-admin-full-upsert-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

select ok(((select payload from _ids where key = 'template_full_upsert_repeat') ->> 'idempotent')::boolean, 'catalog full upsert idempotent repeat returns cached response');

insert into core.users (id, telegram_user_id, username, first_name, status, metadata)
values (
  '6a000000-0000-4000-8000-000000000002',
  606020001,
  'phase6_catalog_supply_user',
  'Supply',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set telegram_user_id = excluded.telegram_user_id,
    status = excluded.status,
    updated_at = now();

insert into _ids (key, id)
select 'form', id
from catalog.collectible_forms
where template_id = (select id from _ids where key = 'template')
  and form_slug = 'base';

insert into inventory.item_instances (
  owner_user_id,
  template_id,
  form_id,
  level,
  power,
  status,
  source_type,
  source_id,
  metadata
)
values (
  '6a000000-0000-4000-8000-000000000002',
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form'),
  1,
  23,
  'available',
  'admin',
  (select id from _ids where key = 'template'),
  '{"fixture":true}'::jsonb
);

select ok(testutil.raises_like(format(
  'insert into inventory.item_instances (owner_user_id, template_id, form_id, level, power, status, source_type, source_id, metadata) values (%L::uuid, %L::uuid, %L::uuid, 1, 23, %L, %L, %L::uuid, %L::jsonb)',
  '6a000000-0000-4000-8000-000000000002',
  (select id::text from _ids where key = 'template'),
  (select id::text from _ids where key = 'form'),
  'available',
  'admin',
  (select id::text from _ids where key = 'template'),
  '{"fixture":true}'
), '%CATALOG_SUPPLY_LIMIT_EXCEEDED%'), 'catalog supply limit prevents over-issuing inventory items');

insert into _ids (key, payload)
select 'milestone_update', api.admin_update_album_milestone(
  p_admin_user_id => (select id from _ids where key = 'actor'),
  p_milestone_id => (select id from _ids where key = 'milestone'),
  p_title => 'Phase 6 Updated Reward',
  p_required_count => 2,
  p_reward => jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 25)),
  p_active => false,
  p_sort_order => 20,
  p_metadata => '{"ops":"p2"}'::jsonb,
  p_reason => 'album p2 test',
  p_idempotency_key => 'phase6-album-admin-milestone-update-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

select is((select title from album.milestones where id = (select id from _ids where key = 'milestone')), 'Phase 6 Updated Reward', 'album admin update writes milestone title');
select is((select active from album.milestones where id = (select id from _ids where key = 'milestone')), false, 'album admin update writes active flag');
select is(((select payload from _ids where key = 'milestone_update') ->> 'audit_log_id') is not null, true, 'album admin update returns audit log id');
select is((
  select count(*)::integer
  from ops.admin_audit_logs
  where action = 'album.milestone.update'
    and target_id = (select id from _ids where key = 'milestone')
), 1, 'album admin update writes one audit log');

select ok(testutil.raises_like(format(
  'select api.admin_update_album_milestone(p_admin_user_id => %L::uuid, p_milestone_id => %L::uuid, p_reward => %L::jsonb, p_reason => %L, p_idempotency_key => %L)',
  (select id::text from _ids where key = 'actor'),
  (select id::text from _ids where key = 'milestone'),
  '[{"reward_type":"ITEM","template_id":"00000000-0000-4000-8000-000000000999","quantity":1}]',
  'invalid reward test',
  'phase6-album-admin-invalid-reward-001'
), '%ADMIN_ALBUM_MILESTONE_REWARD_INVALID%'), 'album admin update rejects invalid item reward config');

insert into _ids (key, payload)
select 'milestone_item_reward_update', api.admin_update_album_milestone(
  p_admin_user_id => (select id from _ids where key = 'actor'),
  p_milestone_id => (select id from _ids where key = 'milestone'),
  p_reward => jsonb_build_array(jsonb_build_object(
    'reward_type', 'ITEM',
    'template_id', (select id from _ids where key = 'template'),
    'quantity', 1
  )),
  p_reason => 'album item reward test',
  p_idempotency_key => 'phase6-album-admin-item-reward-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

select is((
  select reward #>> '{0,reward_type}'
  from album.milestones
  where id = (select id from _ids where key = 'milestone')
), 'ITEM', 'album admin update accepts item reward config');

select ok(not has_function_privilege('anon', 'api.admin_update_collectible_template_ops(uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, integer, jsonb, text, text, jsonb)', 'execute'), 'anon cannot execute admin_update_collectible_template_ops');
select ok(not has_function_privilege('anon', 'api.admin_upsert_collectible_template(uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb)', 'execute'), 'anon cannot execute admin_upsert_collectible_template');
select ok(not has_function_privilege('authenticated', 'api.admin_update_album_milestone(uuid, uuid, text, integer, jsonb, boolean, integer, jsonb, text, text, jsonb)', 'execute'), 'authenticated cannot execute admin_update_album_milestone');
select ok(has_function_privilege('service_role', 'api.admin_update_collectible_template_ops(uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, integer, jsonb, text, text, jsonb)', 'execute'), 'service_role can execute admin_update_collectible_template_ops');
select ok(has_function_privilege('service_role', 'api.admin_upsert_collectible_template(uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb)', 'execute'), 'service_role can execute admin_upsert_collectible_template');
select ok(has_function_privilege('service_role', 'api.admin_update_album_milestone(uuid, uuid, text, integer, jsonb, boolean, integer, jsonb, text, text, jsonb)', 'execute'), 'service_role can execute admin_update_album_milestone');

select * from finish();

rollback;
