-- Phase 6 drop pool publish preflight validation checks.

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

create or replace function testutil.validation_has_code(p_validation jsonb, p_code text)
returns boolean
language sql
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(p_validation -> 'validation_errors', '[]'::jsonb)) as err(value)
    where err.value ->> 'code' = p_code
  );
$$;

select no_plan();

create temp table _ids (
  key text primary key,
  id uuid
) on commit drop;

insert into _ids (key, id)
values
  ('actor', '64000000-0000-4000-8000-000000000001'),
  ('support_actor', '64000000-0000-4000-8000-000000000002'),
  ('user', '64000000-0000-4000-8000-000000000101'),
  ('template', '64000000-0000-4000-8000-000000000201'),
  ('form', '64000000-0000-4000-8000-000000000202'),
  ('inactive_template', '64000000-0000-4000-8000-000000000203'),
  ('inactive_form', '64000000-0000-4000-8000-000000000204'),
  ('box', '64000000-0000-4000-8000-000000000301'),
  ('archived_box', '64000000-0000-4000-8000-000000000302'),
  ('empty_pool', '64000000-0000-4000-8000-000000000401'),
  ('valid_six_item_pool', '64000000-0000-4000-8000-000000000402'),
  ('probability_pool', '64000000-0000-4000-8000-000000000403'),
  ('inactive_template_pool', '64000000-0000-4000-8000-000000000404'),
  ('missing_form_pool', '64000000-0000-4000-8000-000000000405'),
  ('stock_pool', '64000000-0000-4000-8000-000000000406'),
  ('no_pity_pool', '64000000-0000-4000-8000-000000000407'),
  ('pity_target_pool', '64000000-0000-4000-8000-000000000408'),
  ('scheduled_pool', '64000000-0000-4000-8000-000000000409'),
  ('scheduled_conflict_pool', '64000000-0000-4000-8000-000000000410'),
  ('archived_box_pool', '64000000-0000-4000-8000-000000000411'),
  ('stock_item', '64000000-0000-4000-8000-000000000501'),
  ('stock_order', '64000000-0000-4000-8000-000000000601');

insert into core.users (id, telegram_user_id, username, invite_code, status)
values (
  (select id from _ids where key = 'user'),
  9900000601,
  'phase6_publish_validation_user',
  'P6PV0601',
  'active'
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_users (id, email, display_name, status, metadata)
values
  (
    (select id from _ids where key = 'actor'),
    'phase6-publish-validation-admin@example.test',
    'Phase 6 Publish Validation Admin',
    'active',
    '{"test":true}'::jsonb
  ),
  (
    (select id from _ids where key = 'support_actor'),
    'phase6-publish-validation-support@example.test',
    'Phase 6 Publish Validation Support',
    'active',
    '{"test":true}'::jsonb
  )
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select
  (select id from _ids where key = 'actor'),
  id,
  (select id from _ids where key = 'actor')
from ops.admin_roles
where code = 'OPS'
on conflict (admin_user_id, role_id) do nothing;

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select
  (select id from _ids where key = 'support_actor'),
  id,
  (select id from _ids where key = 'actor')
from ops.admin_roles
where code = 'SUPPORT'
on conflict (admin_user_id, role_id) do nothing;

insert into catalog.collectible_templates (
  id,
  slug,
  display_name,
  rarity_code,
  type_code,
  release_status,
  base_power
)
values
  (
    (select id from _ids where key = 'template'),
    'phase6-publish-validation-template',
    'Phase 6 Publish Validation Template',
    'COMMON',
    'CHARACTER',
    'active',
    1
  ),
  (
    (select id from _ids where key = 'inactive_template'),
    'phase6-publish-validation-inactive-template',
    'Phase 6 Publish Validation Inactive Template',
    'COMMON',
    'CHARACTER',
    'hidden',
    1
  )
on conflict (id) do update
set release_status = excluded.release_status,
    updated_at = now();

insert into catalog.collectible_forms (
  id,
  template_id,
  form_index,
  form_slug,
  display_name,
  is_default
)
values
  (
    (select id from _ids where key = 'form'),
    (select id from _ids where key = 'template'),
    1,
    'base',
    'Base',
    true
  ),
  (
    (select id from _ids where key = 'inactive_form'),
    (select id from _ids where key = 'inactive_template'),
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
values
  (
    (select id from _ids where key = 'box'),
    'phase6-publish-validation-box',
    'Phase 6 Publish Validation Box',
    'normal',
    'active',
    1,
    100,
    100
  ),
  (
    (select id from _ids where key = 'archived_box'),
    'phase6-publish-validation-archived-box',
    'Phase 6 Publish Validation Archived Box',
    'normal',
    'archived',
    1,
    100,
    100
  )
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into gacha.drop_pool_versions (id, box_id, version_no, status, effective_from, effective_to)
values
  ((select id from _ids where key = 'empty_pool'), (select id from _ids where key = 'box'), 1, 'draft', '2029-01-01 00:00:00+00', '2029-02-01 00:00:00+00'),
  ((select id from _ids where key = 'valid_six_item_pool'), (select id from _ids where key = 'box'), 2, 'draft', '2029-02-01 00:00:00+00', '2029-03-01 00:00:00+00'),
  ((select id from _ids where key = 'probability_pool'), (select id from _ids where key = 'box'), 3, 'draft', '2029-03-01 00:00:00+00', '2029-04-01 00:00:00+00'),
  ((select id from _ids where key = 'inactive_template_pool'), (select id from _ids where key = 'box'), 4, 'draft', '2029-04-01 00:00:00+00', '2029-05-01 00:00:00+00'),
  ((select id from _ids where key = 'missing_form_pool'), (select id from _ids where key = 'box'), 5, 'draft', '2029-05-01 00:00:00+00', '2029-06-01 00:00:00+00'),
  ((select id from _ids where key = 'stock_pool'), (select id from _ids where key = 'box'), 6, 'draft', '2029-06-01 00:00:00+00', '2029-07-01 00:00:00+00'),
  ((select id from _ids where key = 'no_pity_pool'), (select id from _ids where key = 'box'), 7, 'draft', '2029-07-01 00:00:00+00', '2029-08-01 00:00:00+00'),
  ((select id from _ids where key = 'pity_target_pool'), (select id from _ids where key = 'box'), 8, 'draft', '2029-08-01 00:00:00+00', '2029-09-01 00:00:00+00'),
  ((select id from _ids where key = 'scheduled_pool'), (select id from _ids where key = 'box'), 9, 'scheduled', '2030-01-01 00:00:00+00', '2030-02-01 00:00:00+00'),
  ((select id from _ids where key = 'scheduled_conflict_pool'), (select id from _ids where key = 'box'), 10, 'draft', '2030-01-15 00:00:00+00', '2030-03-01 00:00:00+00'),
  ((select id from _ids where key = 'archived_box_pool'), (select id from _ids where key = 'archived_box'), 1, 'draft', '2029-09-01 00:00:00+00', '2029-10-01 00:00:00+00');

insert into gacha.drop_pool_items (
  id,
  pool_version_id,
  template_id,
  form_id,
  rarity_code,
  drop_weight,
  probability_bps,
  stock_total,
  stock_remaining,
  is_pity_eligible
)
select
  gen_random_uuid(),
  pool_id,
  template_id,
  form_id,
  rarity_code,
  drop_weight,
  probability_bps,
  stock_total,
  stock_remaining,
  is_pity_eligible
from (
  values
    ((select id from _ids where key = 'valid_six_item_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, null::integer, null::integer, null::integer, true),
    ((select id from _ids where key = 'valid_six_item_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, null::integer, null::integer, null::integer, true),
    ((select id from _ids where key = 'valid_six_item_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, null::integer, null::integer, null::integer, true),
    ((select id from _ids where key = 'valid_six_item_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, null::integer, null::integer, null::integer, true),
    ((select id from _ids where key = 'valid_six_item_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, null::integer, null::integer, null::integer, true),
    ((select id from _ids where key = 'valid_six_item_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, null::integer, null::integer, null::integer, true),
    ((select id from _ids where key = 'probability_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, 7000, null::integer, null::integer, true),
    ((select id from _ids where key = 'probability_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, 2000, null::integer, null::integer, true),
    ((select id from _ids where key = 'inactive_template_pool'), (select id from _ids where key = 'inactive_template'), (select id from _ids where key = 'inactive_form'), 'COMMON', 1::numeric, 10000, null::integer, null::integer, true),
    ((select id from _ids where key = 'missing_form_pool'), (select id from _ids where key = 'template'), null::uuid, 'COMMON', 1::numeric, 10000, null::integer, null::integer, true),
    ((select id from _ids where key = 'no_pity_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, 10000, null::integer, null::integer, true),
    ((select id from _ids where key = 'pity_target_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, 10000, null::integer, null::integer, true),
    ((select id from _ids where key = 'scheduled_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, 10000, null::integer, null::integer, true),
    ((select id from _ids where key = 'scheduled_conflict_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, 10000, null::integer, null::integer, true),
    ((select id from _ids where key = 'archived_box_pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1::numeric, 10000, null::integer, null::integer, true)
) as item(pool_id, template_id, form_id, rarity_code, drop_weight, probability_bps, stock_total, stock_remaining, is_pity_eligible);

insert into gacha.drop_pool_items (
  id,
  pool_version_id,
  template_id,
  form_id,
  rarity_code,
  drop_weight,
  probability_bps,
  stock_total,
  stock_remaining,
  is_pity_eligible
)
values (
  (select id from _ids where key = 'stock_item'),
  (select id from _ids where key = 'stock_pool'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form'),
  'COMMON',
  1,
  10000,
  1,
  1,
  true
);

insert into gacha.pity_rules (
  box_id,
  pool_version_id,
  rule_name,
  threshold,
  target_rarity_code,
  priority,
  active,
  metadata
)
select
  (select id from _ids where key = 'box'),
  pool_id,
  rule_name,
  threshold,
  target_rarity_code,
  10,
  false,
  '{"admin_draft":{"intended_active":true}}'::jsonb
from (
  values
    ((select id from _ids where key = 'valid_six_item_pool'), 'valid six item pity', 5, 'COMMON'),
    ((select id from _ids where key = 'probability_pool'), 'probability pool pity', 5, 'COMMON'),
    ((select id from _ids where key = 'inactive_template_pool'), 'inactive template pity', 5, 'COMMON'),
    ((select id from _ids where key = 'missing_form_pool'), 'missing form pity', 5, 'COMMON'),
    ((select id from _ids where key = 'stock_pool'), 'stock pool pity', 5, 'COMMON'),
    ((select id from _ids where key = 'pity_target_pool'), 'pity target pool pity', 5, 'LEGENDARY'),
    ((select id from _ids where key = 'scheduled_pool'), 'scheduled pool pity', 5, 'COMMON'),
    ((select id from _ids where key = 'scheduled_conflict_pool'), 'scheduled conflict pool pity', 5, 'COMMON')
) as rule(pool_id, rule_name, threshold, target_rarity_code);

insert into gacha.pity_rules (
  box_id,
  pool_version_id,
  rule_name,
  threshold,
  target_rarity_code,
  priority,
  active,
  metadata
)
values (
  (select id from _ids where key = 'archived_box'),
  (select id from _ids where key = 'archived_box_pool'),
  'archived box pool pity',
  5,
  'COMMON',
  10,
  false,
  '{"admin_draft":{"intended_active":true}}'::jsonb
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
  (select id from _ids where key = 'stock_order'),
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'stock_pool'),
  'opened',
  1,
  1,
  1,
  'phase6-publish-validation-stock-order',
  'phase6-publish-validation-stock-order',
  1
);

insert into gacha.draw_results (
  draw_order_id,
  user_id,
  box_id,
  pool_version_id,
  draw_index,
  drop_pool_item_id,
  template_id,
  form_id,
  rarity_code
)
values (
  (select id from _ids where key = 'stock_order'),
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'stock_pool'),
  1,
  (select id from _ids where key = 'stock_item'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form'),
  'COMMON'
);

select ok(
  not testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'valid_six_item_pool')),
    'ADMIN_DROP_POOL_COMPUTED_PROBABILITY_SUM_INVALID'
  ),
  'computed probability bps allows normal rounding drift'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'empty_pool')),
    'ADMIN_DROP_POOL_ITEMS_REQUIRED'
  ),
  'publish validation rejects an empty reward pool'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'empty_pool')),
    'ADMIN_DROP_POOL_WEIGHT_INVALID'
  ),
  'publish validation rejects non-positive total weight'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'probability_pool')),
    'ADMIN_DROP_POOL_PROBABILITY_SUM_INVALID'
  ),
  'publish validation rejects invalid provided probability bps totals'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'inactive_template_pool')),
    'ADMIN_DROP_POOL_TEMPLATE_NOT_ACTIVE'
  ),
  'publish validation rejects inactive reward templates'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'missing_form_pool')),
    'ADMIN_DROP_POOL_FORM_REQUIRED'
  ),
  'publish validation requires every reward item to reference a form'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'stock_pool')),
    'ADMIN_DROP_POOL_STOCK_BELOW_ISSUED'
  ),
  'publish validation rejects finite stock below already issued rewards'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'no_pity_pool')),
    'ADMIN_DROP_POOL_PITY_RULE_MISSING'
  ),
  'publish validation requires an intended active pity rule'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'pity_target_pool')),
    'ADMIN_DROP_POOL_PITY_TARGET_UNSATISFIED'
  ),
  'publish validation rejects pity targets without eligible reward items'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'scheduled_conflict_pool')),
    'ADMIN_DROP_POOL_SCHEDULED_WINDOW_CONFLICT'
  ),
  'publish validation rejects overlapping scheduled windows for the same blind box'
);

select ok(
  testutil.validation_has_code(
    api._admin_validate_drop_pool_config((select id from _ids where key = 'archived_box_pool')),
    'ADMIN_BOX_NOT_PUBLISHABLE'
  ),
  'publish validation rejects archived blind boxes'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_validate_drop_pool(p_admin_user_id => %L::uuid, p_drop_pool_version_id => %L::uuid, p_reason => %L, p_idempotency_key => %L, p_request_context => %L::jsonb)',
      (select id::text from _ids where key = 'support_actor'),
      (select id::text from _ids where key = 'valid_six_item_pool'),
      'phase 6 publish validation permission check',
      'phase6-publish-validation-no-gacha-write',
      '{}'
    ),
    '%ADMIN_PERMISSION_DENIED%'
  ),
  'publish validation requires a gacha:write admin'
);

select finish();

rollback;
