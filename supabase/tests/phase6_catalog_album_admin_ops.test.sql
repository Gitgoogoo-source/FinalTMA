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
  '[{"item_template_id":"x","amount":1}]',
  'invalid reward test',
  'phase6-album-admin-invalid-reward-001'
), '%ADMIN_ALBUM_MILESTONE_REWARD_INVALID%'), 'album admin update rejects non-currency reward config');

select ok(not has_function_privilege('anon', 'api.admin_update_collectible_template_ops(uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, integer, jsonb, text, text, jsonb)', 'execute'), 'anon cannot execute admin_update_collectible_template_ops');
select ok(not has_function_privilege('authenticated', 'api.admin_update_album_milestone(uuid, uuid, text, integer, jsonb, boolean, integer, jsonb, text, text, jsonb)', 'execute'), 'authenticated cannot execute admin_update_album_milestone');
select ok(has_function_privilege('service_role', 'api.admin_update_collectible_template_ops(uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, integer, jsonb, text, text, jsonb)', 'execute'), 'service_role can execute admin_update_collectible_template_ops');
select ok(has_function_privilege('service_role', 'api.admin_update_album_milestone(uuid, uuid, text, integer, jsonb, boolean, integer, jsonb, text, text, jsonb)', 'execute'), 'service_role can execute admin_update_album_milestone');

select * from finish();

rollback;
