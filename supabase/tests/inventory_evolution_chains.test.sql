-- Pokemon-style evolution chain configuration tests.

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

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null
)
returns uuid
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := api.auth_upsert_telegram_user(
    p_telegram_user_id := p_telegram_user_id,
    p_username := coalesce(p_username, 'u' || p_telegram_user_id::text),
    p_first_name := 'Test',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.create_chain_collectible(
  p_slug text,
  p_display_name text,
  p_rarity_code text default 'COMMON',
  p_evolvable boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_template_id uuid;
  v_form_id uuid;
begin
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
    p_slug,
    p_display_name,
    p_rarity_code,
    'CHARACTER',
    10,
    100,
    'active',
    true,
    true,
    p_evolvable,
    true,
    true,
    10,
    jsonb_build_object('fixture', true)
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      evolvable = excluded.evolvable,
      updated_at = now()
  returning id into v_template_id;

  insert into catalog.collectible_forms (
    template_id,
    form_index,
    form_slug,
    display_name,
    description,
    image_url,
    thumbnail_url,
    avatar_url,
    base_power_bonus,
    is_default,
    metadata
  )
  values (
    v_template_id,
    1,
    'base',
    p_display_name,
    p_display_name || ' base form',
    'https://example.test/evolution-chain/' || p_slug || '.png',
    'https://example.test/evolution-chain/' || p_slug || '-thumb.png',
    'https://example.test/evolution-chain/' || p_slug || '-avatar.png',
    0,
    true,
    jsonb_build_object('fixture', true)
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      image_url = excluded.image_url,
      thumbnail_url = excluded.thumbnail_url,
      avatar_url = excluded.avatar_url,
      is_default = true,
      updated_at = now()
  returning id into v_form_id;

  return jsonb_build_object(
    'template_id', v_template_id,
    'form_id', v_form_id
  );
end;
$$;

create or replace function testutil.create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid,
  p_level integer default 1,
  p_power integer default 10
)
returns uuid
language plpgsql
as $$
declare
  v_item_id uuid;
begin
  insert into inventory.item_instances (
    owner_user_id,
    template_id,
    form_id,
    level,
    power,
    status,
    source_type,
    metadata
  )
  values (
    p_user_id,
    p_template_id,
    p_form_id,
    p_level,
    p_power,
    'available',
    'admin',
    jsonb_build_object('fixture', true)
  )
  returning id into v_item_id;

  insert into inventory.item_instance_events (
    item_instance_id,
    user_id,
    event_type,
    source_type,
    after_state
  )
  values (
    v_item_id,
    p_user_id,
    'created',
    'admin',
    jsonb_build_object('fixture', true)
  );

  return v_item_id;
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
  '7a000000-0000-4000-8000-000000000001',
  'evolution-chain-admin@example.test',
  'Evolution Chain Admin',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_roles (code, display_name, permissions)
values (
  'EVOLUTION_CHAIN_WRITE',
  'Evolution Chain Write',
  '["catalog:read","catalog:write"]'::jsonb
)
on conflict (code) do update
set permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select '7a000000-0000-4000-8000-000000000001'::uuid, id, '7a000000-0000-4000-8000-000000000001'::uuid
from ops.admin_roles
where code = 'EVOLUTION_CHAIN_WRITE'
on conflict (admin_user_id, role_id) do nothing;

insert into _ids (key, id)
values ('admin', '7a000000-0000-4000-8000-000000000001');

insert into _ids (key, id)
values ('user', testutil.make_user(9800000001, 'evolution_chain_user'));

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'user'),
    'KCOIN',
    1000,
    'test_setup',
    null,
    null,
    'evolution-chain-kcoin-001',
    'fixture',
    '{}'::jsonb
  );
end;
$$;

insert into _ids (key, payload)
values
  ('a', testutil.create_chain_collectible('chain-a-charmander', 'Chain A Charmander')),
  ('b', testutil.create_chain_collectible('chain-b-charmeleon', 'Chain B Charmeleon')),
  ('c', testutil.create_chain_collectible('chain-c-charizard', 'Chain C Charizard'));

insert into _ids (key, id)
select 'a_template', (payload ->> 'template_id')::uuid from _ids where key = 'a';
insert into _ids (key, id)
select 'a_form', (payload ->> 'form_id')::uuid from _ids where key = 'a';
insert into _ids (key, id)
select 'b_template', (payload ->> 'template_id')::uuid from _ids where key = 'b';
insert into _ids (key, id)
select 'b_form', (payload ->> 'form_id')::uuid from _ids where key = 'b';
insert into _ids (key, id)
select 'c_template', (payload ->> 'template_id')::uuid from _ids where key = 'c';
insert into _ids (key, id)
select 'c_form', (payload ->> 'form_id')::uuid from _ids where key = 'c';

with inserted as (
  insert into catalog.collectible_forms (
    template_id,
    form_index,
    form_slug,
    display_name,
    description,
    image_url,
    thumbnail_url,
    avatar_url,
    base_power_bonus,
    is_default,
    metadata
  )
  values (
    (select id from _ids where key = 'a_template'),
    2,
    'old_stage_2',
    'Old Same Template Stage',
    'Old same-template evolution target',
    'https://example.test/evolution-chain/old-stage.png',
    'https://example.test/evolution-chain/old-stage-thumb.png',
    'https://example.test/evolution-chain/old-stage-avatar.png',
    5,
    false,
    '{"fixture":true}'::jsonb
  )
  returning id
)
insert into _ids (key, id)
select 'old_stage_form', id from inserted;

with inserted as (
  insert into inventory.evolution_rules (
    from_template_id,
    from_form_id,
    to_template_id,
    to_form_id,
    required_count,
    cost_kcoin,
    success_rate_bps,
    active,
    metadata
  )
  values (
    (select id from _ids where key = 'a_template'),
    (select id from _ids where key = 'a_form'),
    (select id from _ids where key = 'a_template'),
    (select id from _ids where key = 'old_stage_form'),
    3,
    1,
    10000,
    true,
    '{"fixture":"old_same_template_rule"}'::jsonb
  )
  returning id
)
insert into _ids (key, id)
select 'old_rule', id from inserted;

insert into _ids (key, payload)
select 'chain_upsert', api.admin_upsert_evolution_chain(
  p_admin_user_id => (select id from _ids where key = 'admin'),
  p_chain_id => null,
  p_chain => jsonb_build_object(
    'code', 'starter_fire_chain',
    'display_name', 'Starter Fire Chain',
    'status', 'active',
    'metadata', jsonb_build_object('fixture', true)
  ),
  p_steps => jsonb_build_array(
    jsonb_build_object(
      'step_index', 1,
      'from_template_id', (select id from _ids where key = 'a_template'),
      'from_form_id', (select id from _ids where key = 'a_form'),
      'to_template_id', (select id from _ids where key = 'b_template'),
      'to_form_id', (select id from _ids where key = 'b_form'),
      'required_count', 3,
      'cost_kcoin', 25,
      'success_rate_bps', 10000,
      'metadata', jsonb_build_object('fixture_step', 1)
    ),
    jsonb_build_object(
      'step_index', 2,
      'from_template_id', (select id from _ids where key = 'b_template'),
      'from_form_id', (select id from _ids where key = 'b_form'),
      'to_template_id', (select id from _ids where key = 'c_template'),
      'to_form_id', (select id from _ids where key = 'c_form'),
      'required_count', 3,
      'cost_kcoin', 40,
      'success_rate_bps', 10000,
      'metadata', jsonb_build_object('fixture_step', 2)
    )
  ),
  p_reason => 'configure pokemon-style A to B to C chain',
  p_idempotency_key => 'evolution-chain-upsert-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

insert into _ids (key, id)
select 'chain', ((select payload from _ids where key = 'chain_upsert') ->> 'chain_id')::uuid;

select is(((select payload from _ids where key = 'chain_upsert') ->> 'step_count')::integer, 2, 'admin upsert stores two active chain steps');

insert into _ids (key, payload)
select 'chain_upsert_repeat', api.admin_upsert_evolution_chain(
  p_admin_user_id => (select id from _ids where key = 'admin'),
  p_chain_id => null,
  p_chain => jsonb_build_object(
    'code', 'starter_fire_chain',
    'display_name', 'Starter Fire Chain',
    'status', 'active',
    'metadata', jsonb_build_object('fixture', true)
  ),
  p_steps => jsonb_build_array(
    jsonb_build_object(
      'step_index', 1,
      'from_template_id', (select id from _ids where key = 'a_template'),
      'from_form_id', (select id from _ids where key = 'a_form'),
      'to_template_id', (select id from _ids where key = 'b_template'),
      'to_form_id', (select id from _ids where key = 'b_form'),
      'required_count', 3,
      'cost_kcoin', 25,
      'success_rate_bps', 10000,
      'metadata', jsonb_build_object('fixture_step', 1)
    ),
    jsonb_build_object(
      'step_index', 2,
      'from_template_id', (select id from _ids where key = 'b_template'),
      'from_form_id', (select id from _ids where key = 'b_form'),
      'to_template_id', (select id from _ids where key = 'c_template'),
      'to_form_id', (select id from _ids where key = 'c_form'),
      'required_count', 3,
      'cost_kcoin', 40,
      'success_rate_bps', 10000,
      'metadata', jsonb_build_object('fixture_step', 2)
    )
  ),
  p_reason => 'configure pokemon-style A to B to C chain',
  p_idempotency_key => 'evolution-chain-upsert-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

select ok(((select payload from _ids where key = 'chain_upsert_repeat') ->> 'idempotent')::boolean, 'chain upsert repeat is idempotent');
select is((
  select count(*)::integer
  from ops.admin_audit_logs
  where action = 'inventory.evolution_chain.upsert'
    and target_id = (select id from _ids where key = 'chain')
), 1, 'idempotent chain upsert writes one audit log');

insert into _ids (key, payload)
select 'chain_publish', api.admin_publish_evolution_chain(
  p_admin_user_id => (select id from _ids where key = 'admin'),
  p_chain_id => (select id from _ids where key = 'chain'),
  p_reason => 'publish pokemon-style A to B to C chain',
  p_idempotency_key => 'evolution-chain-publish-001',
  p_request_context => '{"ip_hash":"iphash","user_agent_hash":"uahash"}'::jsonb
);

select is(((select payload from _ids where key = 'chain_publish') ->> 'synced_rule_count')::integer, 2, 'publishing chain syncs two evolution rules');
select is(((select payload from _ids where key = 'chain_publish') ->> 'deactivated_rule_count')::integer, 1, 'publishing chain deactivates old same-source rule');
select is((select active from inventory.evolution_rules where id = (select id from _ids where key = 'old_rule')), false, 'old same-template rule is inactive after chain publish');

select is((
  select er.to_template_id
  from inventory.evolution_rules er
  where er.from_template_id = (select id from _ids where key = 'a_template')
    and er.from_form_id = (select id from _ids where key = 'a_form')
    and er.active = true
), (select id from _ids where key = 'b_template'), 'A source now evolves into B template');

select is((
  select er.to_template_id
  from inventory.evolution_rules er
  where er.from_template_id = (select id from _ids where key = 'b_template')
    and er.from_form_id = (select id from _ids where key = 'b_form')
    and er.active = true
), (select id from _ids where key = 'c_template'), 'B source now evolves into C template');

insert into _ids (key, id)
select 'a1', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'a_template'), (select id from _ids where key = 'a_form'), 1, 10);
insert into _ids (key, id)
select 'a2', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'a_template'), (select id from _ids where key = 'a_form'), 2, 20);
insert into _ids (key, id)
select 'a3', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'a_template'), (select id from _ids where key = 'a_form'), 3, 30);

select is((
  api.inventory_get_evolution_preview(
    (select id from _ids where key = 'user'),
    array[(select id from _ids where key = 'a1')],
    null
  ) ->> 'target_template_id'
)::uuid, (select id from _ids where key = 'b_template'), 'evolution preview uses chain target B');

insert into _ids (key, payload)
select 'a_to_b', api.inventory_evolve_item(
  (select id from _ids where key = 'user'),
  array[
    (select id from _ids where key = 'a1'),
    (select id from _ids where key = 'a2'),
    (select id from _ids where key = 'a3')
  ],
  'evolution-chain-a-to-b-001',
  (select id from _ids where key = 'b_form'),
  25::numeric,
  10000,
  (select id from _ids where key = 'a3')
);

insert into _ids (key, id)
select 'created_b', ((select payload from _ids where key = 'a_to_b') ->> 'result_item_instance_id')::uuid;

select ok(((select payload from _ids where key = 'a_to_b') ->> 'success')::boolean, 'A to B evolution succeeds with 100 percent rule');
select is((select template_id from inventory.item_instances where id = (select id from _ids where key = 'created_b')), (select id from _ids where key = 'b_template'), 'A to B evolution creates B template item');

insert into _ids (key, id)
select 'b2', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'b_template'), (select id from _ids where key = 'b_form'), 1, 10);
insert into _ids (key, id)
select 'b3', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'b_template'), (select id from _ids where key = 'b_form'), 1, 10);

insert into _ids (key, payload)
select 'b_to_c', api.inventory_evolve_item(
  (select id from _ids where key = 'user'),
  array[
    (select id from _ids where key = 'created_b'),
    (select id from _ids where key = 'b2'),
    (select id from _ids where key = 'b3')
  ],
  'evolution-chain-b-to-c-001',
  (select id from _ids where key = 'c_form'),
  40::numeric,
  10000,
  (select id from _ids where key = 'created_b')
);

insert into _ids (key, id)
select 'created_c', ((select payload from _ids where key = 'b_to_c') ->> 'result_item_instance_id')::uuid;

select ok(((select payload from _ids where key = 'b_to_c') ->> 'success')::boolean, 'B to C evolution succeeds with 100 percent rule');
select is((select template_id from inventory.item_instances where id = (select id from _ids where key = 'created_c')), (select id from _ids where key = 'c_template'), 'B to C evolution creates C template item');

select ok(testutil.raises_like(
  format(
    'insert into inventory.evolution_chain_steps (chain_id, step_index, from_template_id, from_form_id, to_template_id, to_form_id, cost_kcoin, success_rate_bps) values (%L::uuid, 99, %L::uuid, %L::uuid, %L::uuid, %L::uuid, 1, 10000)',
    (select id::text from _ids where key = 'chain'),
    (select id::text from _ids where key = 'a_template'),
    (select id::text from _ids where key = 'a_form'),
    (select id::text from _ids where key = 'a_template'),
    (select id::text from _ids where key = 'old_stage_form')
  ),
  '%EVOLUTION_CHAIN_TARGET_TEMPLATE_REQUIRED%'
), 'chain steps reject same-template evolution');

insert into _ids (key, payload)
values
  ('x', testutil.create_chain_collectible('chain-x-gap', 'Chain X Gap')),
  ('y', testutil.create_chain_collectible('chain-y-gap', 'Chain Y Gap'));
insert into _ids (key, id)
select 'x_template', (payload ->> 'template_id')::uuid from _ids where key = 'x';
insert into _ids (key, id)
select 'x_form', (payload ->> 'form_id')::uuid from _ids where key = 'x';
insert into _ids (key, id)
select 'y_template', (payload ->> 'template_id')::uuid from _ids where key = 'y';
insert into _ids (key, id)
select 'y_form', (payload ->> 'form_id')::uuid from _ids where key = 'y';

insert into _ids (key, payload)
select 'gap_chain_upsert', api.admin_upsert_evolution_chain(
  p_admin_user_id => (select id from _ids where key = 'admin'),
  p_chain_id => null,
  p_chain => jsonb_build_object(
    'code', 'gap_chain',
    'display_name', 'Gap Chain',
    'status', 'active'
  ),
  p_steps => jsonb_build_array(
    jsonb_build_object(
      'step_index', 2,
      'from_template_id', (select id from _ids where key = 'x_template'),
      'from_form_id', (select id from _ids where key = 'x_form'),
      'to_template_id', (select id from _ids where key = 'y_template'),
      'to_form_id', (select id from _ids where key = 'y_form'),
      'cost_kcoin', 1,
      'success_rate_bps', 10000
    )
  ),
  p_reason => 'gap chain fixture',
  p_idempotency_key => 'evolution-chain-gap-upsert-001',
  p_request_context => '{}'::jsonb
);

insert into _ids (key, id)
select 'gap_chain', ((select payload from _ids where key = 'gap_chain_upsert') ->> 'chain_id')::uuid;

select ok(testutil.raises_like(
  format(
    'select api.admin_publish_evolution_chain(%L::uuid, %L::uuid, %L::text, %L::text, %L::jsonb)',
    (select id::text from _ids where key = 'admin'),
    (select id::text from _ids where key = 'gap_chain'),
    'publish invalid gap chain',
    'evolution-chain-gap-publish-001',
    '{}'::jsonb::text
  ),
  '%ADMIN_EVOLUTION_CHAIN_STEP_INDEX_GAP%'
), 'publish rejects chains whose active step indexes are not contiguous from 1');

select ok(not has_table_privilege('anon', 'inventory.evolution_chains', 'select'), 'anon cannot select evolution_chains directly');
select ok(not has_table_privilege('authenticated', 'inventory.evolution_chains', 'select'), 'authenticated cannot select evolution_chains directly');
select ok(not has_table_privilege('anon', 'inventory.evolution_chain_steps', 'select'), 'anon cannot select evolution_chain_steps directly');
select ok(not has_table_privilege('authenticated', 'inventory.evolution_chain_steps', 'select'), 'authenticated cannot select evolution_chain_steps directly');
select ok(not has_function_privilege('anon', 'api.admin_upsert_evolution_chain(uuid, uuid, jsonb, jsonb, text, text, jsonb)', 'execute'), 'anon cannot execute admin_upsert_evolution_chain');
select ok(not has_function_privilege('authenticated', 'api.admin_upsert_evolution_chain(uuid, uuid, jsonb, jsonb, text, text, jsonb)', 'execute'), 'authenticated cannot execute admin_upsert_evolution_chain');
select ok(has_function_privilege('service_role', 'api.admin_upsert_evolution_chain(uuid, uuid, jsonb, jsonb, text, text, jsonb)', 'execute'), 'service_role can execute admin_upsert_evolution_chain');
select ok(not has_function_privilege('anon', 'api.admin_publish_evolution_chain(uuid, uuid, text, text, jsonb)', 'execute'), 'anon cannot execute admin_publish_evolution_chain');
select ok(not has_function_privilege('authenticated', 'api.admin_publish_evolution_chain(uuid, uuid, text, text, jsonb)', 'execute'), 'authenticated cannot execute admin_publish_evolution_chain');
select ok(has_function_privilege('service_role', 'api.admin_publish_evolution_chain(uuid, uuid, text, text, jsonb)', 'execute'), 'service_role can execute admin_publish_evolution_chain');

select * from finish();

rollback;
