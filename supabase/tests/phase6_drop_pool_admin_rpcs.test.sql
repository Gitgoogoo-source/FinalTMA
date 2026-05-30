-- Phase 6 drop pool admin RPC checks.

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

insert into core.users (id, telegram_user_id, username, invite_code, status)
values (
  '63000000-0000-4000-8000-000000000101',
  9800000601,
  'phase6_drop_pool_user',
  'P6DPR0601',
  'active'
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_users (id, email, display_name, status, metadata)
values (
  '63000000-0000-4000-8000-000000000001',
  'phase6-drop-pool-admin@example.test',
  'Phase 6 Drop Pool Admin',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select
  '63000000-0000-4000-8000-000000000001'::uuid,
  id,
  '63000000-0000-4000-8000-000000000001'::uuid
from ops.admin_roles
where code = 'OPS'
on conflict (admin_user_id, role_id) do nothing;

insert into _ids (key, id)
values
  ('actor', '63000000-0000-4000-8000-000000000001'),
  ('user', '63000000-0000-4000-8000-000000000101'),
  ('template', '63000000-0000-4000-8000-000000000201'),
  ('form', '63000000-0000-4000-8000-000000000202'),
  ('box', '63000000-0000-4000-8000-000000000301'),
  ('active_pool', '63000000-0000-4000-8000-000000000302'),
  ('open_order', '63000000-0000-4000-8000-000000000401');

insert into catalog.collectible_templates (
  id,
  slug,
  display_name,
  rarity_code,
  type_code,
  release_status,
  base_power
)
values (
  (select id from _ids where key = 'template'),
  'phase6-drop-pool-template',
  'Phase 6 Drop Pool Template',
  'COMMON',
  'CHARACTER',
  'active',
  1
)
on conflict (id) do update
set release_status = 'active',
    updated_at = now();

insert into catalog.collectible_forms (
  id,
  template_id,
  form_index,
  form_slug,
  display_name,
  is_default
)
values (
  (select id from _ids where key = 'form'),
  (select id from _ids where key = 'template'),
  1,
  'base',
  'Base',
  true
)
on conflict (id) do update
set display_name = excluded.display_name,
    updated_at = now();

insert into gacha.blind_boxes (
  id,
  slug,
  display_name,
  tier,
  status,
  price_stars,
  total_stock,
  remaining_stock
)
values (
  (select id from _ids where key = 'box'),
  'phase6-drop-pool-box',
  'Phase 6 Drop Pool Box',
  'normal',
  'active',
  1,
  100,
  100
)
on conflict (id) do update
set status = 'active',
    updated_at = now();

insert into gacha.drop_pool_versions (
  id,
  box_id,
  version_no,
  status,
  published_at,
  effective_from,
  created_by_admin_id
)
values (
  (select id from _ids where key = 'active_pool'),
  (select id from _ids where key = 'box'),
  1,
  'active',
  now(),
  now(),
  (select id from _ids where key = 'actor')
)
on conflict (id) do update
set status = 'active',
    updated_at = now();

insert into gacha.drop_pool_items (
  pool_version_id,
  template_id,
  form_id,
  rarity_code,
  drop_weight,
  probability_bps,
  is_pity_eligible
)
values (
  (select id from _ids where key = 'active_pool'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form'),
  'COMMON',
  10000,
  10000,
  true
);

insert into gacha.pity_rules (
  box_id,
  pool_version_id,
  rule_name,
  threshold,
  target_rarity_code,
  priority,
  active
)
values (
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'active_pool'),
  'phase6 drop pool pity',
  5,
  'COMMON',
  10,
  true
);

select ok(
  to_regprocedure('api.admin_create_drop_pool_draft(uuid,uuid,uuid,text,jsonb,jsonb,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_update_drop_pool_item(uuid,uuid,uuid,text,jsonb,jsonb,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_validate_drop_pool(uuid,uuid,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_publish_drop_pool_version(uuid,uuid,text,text,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_archive_drop_pool_version(uuid,uuid,text,text,jsonb)') is not null,
  'drop pool admin RPCs exist with version-centric signatures'
);

with signatures(signature) as (
  values
    ('api.admin_create_drop_pool_draft(uuid,uuid,uuid,text,jsonb,jsonb,text,text,jsonb)'),
    ('api.admin_update_drop_pool_item(uuid,uuid,uuid,text,jsonb,jsonb,text,text,jsonb)'),
    ('api.admin_validate_drop_pool(uuid,uuid,text,text,jsonb)'),
    ('api.admin_publish_drop_pool_version(uuid,uuid,text,text,jsonb,jsonb)'),
    ('api.admin_archive_drop_pool_version(uuid,uuid,text,text,jsonb)')
)
select ok(
  not exists (
    select 1
    from signatures
    where not has_function_privilege('service_role', signature, 'EXECUTE')
       or has_function_privilege('public', signature, 'EXECUTE')
       or has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  'drop pool admin RPCs are service_role only'
);

insert into _ids (key, payload)
values (
  'create_draft',
  api.admin_create_drop_pool_draft(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_source_version_id => (select id from _ids where key = 'active_pool'),
    p_version_name => 'clone active for phase6 test',
    p_reason => 'phase 6 create drop pool draft',
    p_idempotency_key => 'phase6-drop-pool-create-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

insert into _ids (key, id)
values (
  'draft_pool',
  ((select payload ->> 'drop_pool_version_id' from _ids where key = 'create_draft'))::uuid
);

select is(
  (select status from gacha.drop_pool_versions where id = (select id from _ids where key = 'draft_pool')),
  'draft',
  'admin_create_drop_pool_draft creates a draft version'
);

select is(
  (
    select count(*)::int
    from gacha.drop_pool_items
    where pool_version_id = (select id from _ids where key = 'draft_pool')
  ),
  1,
  'admin_create_drop_pool_draft clones source items'
);

select ok(
  not exists (
    select 1
    from gacha.pity_rules
    where pool_version_id = (select id from _ids where key = 'draft_pool')
      and active = true
  ),
  'draft pity rules are stored inactive until publish'
);

insert into _ids (key, payload)
values (
  'create_draft_repeat',
  api.admin_create_drop_pool_draft(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_source_version_id => (select id from _ids where key = 'active_pool'),
    p_version_name => 'clone active for phase6 test',
    p_reason => 'phase 6 create drop pool draft',
    p_idempotency_key => 'phase6-drop-pool-create-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'create_draft_repeat'))::boolean,
  'admin_create_drop_pool_draft returns idempotent repeat'
);

insert into _ids (key, payload)
values (
  'update_draft',
  api.admin_update_drop_pool_item(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_drop_pool_version_id => (select id from _ids where key = 'draft_pool'),
    p_box_id => (select id from _ids where key = 'box'),
    p_version_name => 'updated draft for phase6 test',
    p_items => jsonb_build_array(
      jsonb_build_object(
        'template_id', (select id from _ids where key = 'template'),
        'form_id', (select id from _ids where key = 'form'),
        'rarity_code', 'COMMON',
        'drop_weight', 8000,
        'probability_bps', 10000,
        'is_pity_eligible', true
      )
    ),
    p_pity_rules => jsonb_build_array(
      jsonb_build_object(
        'rule_name', 'phase6 updated pity',
        'threshold', 4,
        'target_rarity_code', 'COMMON',
        'priority', 10,
        'active', true
      )
    ),
    p_reason => 'phase 6 update drop pool draft',
    p_idempotency_key => 'phase6-drop-pool-update-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (
    select total_weight::int
    from gacha.drop_pool_versions
    where id = (select id from _ids where key = 'draft_pool')
  ),
  8000,
  'admin_update_drop_pool_item refreshes total weight through trigger'
);

insert into _ids (key, payload)
values (
  'validate_draft',
  api.admin_validate_drop_pool(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_drop_pool_version_id => (select id from _ids where key = 'draft_pool'),
    p_reason => 'phase 6 validate drop pool',
    p_idempotency_key => 'phase6-drop-pool-validate-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'valid' from _ids where key = 'validate_draft'))::boolean,
  'admin_validate_drop_pool returns valid for a complete draft'
);

insert into _ids (key, payload)
values (
  'publish_draft',
  api.admin_publish_drop_pool_version(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_drop_pool_version_id => (select id from _ids where key = 'draft_pool'),
    p_reason => 'phase 6 publish drop pool draft',
    p_idempotency_key => 'phase6-drop-pool-publish-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select is(
  (select status from gacha.drop_pool_versions where id = (select id from _ids where key = 'active_pool')),
  'archived',
  'admin_publish_drop_pool_version archives the previous active version'
);

select is(
  (select status from gacha.drop_pool_versions where id = (select id from _ids where key = 'draft_pool')),
  'active',
  'admin_publish_drop_pool_version publishes the draft as active'
);

select ok(
  exists (
    select 1
    from gacha.drop_pool_versions
    where id = (select id from _ids where key = 'draft_pool')
      and config_snapshot ? 'published'
      and config_snapshot ->> 'previous_version_id' = (select id::text from _ids where key = 'active_pool')
  ),
  'published version stores config snapshot and previous version id'
);

select ok(
  exists (
    select 1
    from gacha.pity_rules
    where pool_version_id = (select id from _ids where key = 'draft_pool')
      and active = true
  ),
  'admin_publish_drop_pool_version activates intended pity rule for the new version'
);

insert into gacha.draw_orders (
  id,
  user_id,
  box_id,
  pool_version_id,
  status,
  quantity,
  unit_price_stars,
  total_price_stars,
  invoice_payload,
  idempotency_key,
  draw_count
)
values (
  (select id from _ids where key = 'open_order'),
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'draft_pool'),
  'invoice_created',
  1,
  1,
  1,
  'phase6-drop-pool-open-order',
  'phase6-drop-pool-open-order',
  1
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_archive_drop_pool_version(%L::uuid, %L::uuid, %L, %L, %L::jsonb)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'draft_pool'),
      'phase 6 archive active with open order',
      'phase6-drop-pool-archive-open-order',
      '{}'
    ),
    '%ADMIN_DROP_POOL_ACTIVE_HAS_OPEN_ORDERS%'
  ),
  'admin_archive_drop_pool_version rejects active version with unfinished orders'
);

update gacha.draw_orders
set status = 'cancelled',
    updated_at = now()
where id = (select id from _ids where key = 'open_order');

insert into _ids (key, payload)
values (
  'archive_published',
  api.admin_archive_drop_pool_version(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_drop_pool_version_id => (select id from _ids where key = 'draft_pool'),
    p_reason => 'phase 6 archive completed drop pool',
    p_idempotency_key => 'phase6-drop-pool-archive-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from gacha.drop_pool_versions where id = (select id from _ids where key = 'draft_pool')),
  'archived',
  'admin_archive_drop_pool_version archives after unfinished orders are cleared'
);

select is(
  (
    select count(distinct action)::int
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'actor')
      and action in (
        'gacha.drop_pool.draft_create',
        'gacha.drop_pool.draft_update',
        'gacha.drop_pool.validate',
        'gacha.drop_pool.publish',
        'gacha.drop_pool.archive'
      )
  ),
  5,
  'all drop pool admin RPCs write audit logs'
);

select finish();

rollback;
