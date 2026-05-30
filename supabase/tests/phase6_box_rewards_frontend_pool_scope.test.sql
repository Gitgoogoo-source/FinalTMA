-- Phase 6 frontend possible-rewards scope checks.

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
values
  ('template', '65000000-0000-4000-8000-000000000201'),
  ('form', '65000000-0000-4000-8000-000000000202'),
  ('box', '65000000-0000-4000-8000-000000000301'),
  ('active_pool', '65000000-0000-4000-8000-000000000401'),
  ('due_scheduled_pool', '65000000-0000-4000-8000-000000000402'),
  ('future_scheduled_pool', '65000000-0000-4000-8000-000000000403'),
  ('draft_pool', '65000000-0000-4000-8000-000000000404'),
  ('archived_pool', '65000000-0000-4000-8000-000000000405');

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
  'phase6-box-rewards-scope-template',
  'Phase 6 Box Rewards Scope Template',
  'COMMON',
  'CHARACTER',
  'active',
  1
);

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
);

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
  'phase6-box-rewards-scope-box',
  'Phase 6 Box Rewards Scope Box',
  'normal',
  'active',
  1,
  100,
  100
);

insert into gacha.drop_pool_versions (
  id,
  box_id,
  version_no,
  status,
  published_at,
  effective_from,
  effective_to
)
values
  (
    (select id from _ids where key = 'active_pool'),
    (select id from _ids where key = 'box'),
    1,
    'active',
    now() - interval '2 hours',
    now() - interval '2 hours',
    now() + interval '1 day'
  ),
  (
    (select id from _ids where key = 'due_scheduled_pool'),
    (select id from _ids where key = 'box'),
    2,
    'scheduled',
    null,
    now() - interval '5 minutes',
    now() + interval '1 day'
  ),
  (
    (select id from _ids where key = 'future_scheduled_pool'),
    (select id from _ids where key = 'box'),
    3,
    'scheduled',
    null,
    now() + interval '1 day',
    now() + interval '2 days'
  ),
  (
    (select id from _ids where key = 'draft_pool'),
    (select id from _ids where key = 'box'),
    4,
    'draft',
    null,
    now() - interval '5 minutes',
    now() + interval '1 day'
  ),
  (
    (select id from _ids where key = 'archived_pool'),
    (select id from _ids where key = 'box'),
    5,
    'archived',
    now() - interval '3 hours',
    now() - interval '3 hours',
    now() + interval '1 day'
  );

insert into gacha.drop_pool_items (
  pool_version_id,
  template_id,
  form_id,
  rarity_code,
  drop_weight,
  probability_bps,
  is_pity_eligible
)
select
  id,
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form'),
  'COMMON',
  10000,
  10000,
  true
from _ids
where key in ('active_pool', 'due_scheduled_pool', 'future_scheduled_pool', 'draft_pool', 'archived_pool');

select is(
  (api.gacha_get_box_rewards((select id from _ids where key = 'box')) ->> 'pool_version_id')::uuid,
  (select id from _ids where key = 'due_scheduled_pool'),
  'frontend rewards prefer an effective scheduled pool over the previous active pool'
);

select is(
  (api.gacha_get_box_rewards(
    (select id from _ids where key = 'box'),
    (select id from _ids where key = 'active_pool')
  ) ->> 'pool_version_id')::uuid,
  (select id from _ids where key = 'active_pool'),
  'frontend rewards still allow explicitly requested active pool versions'
);

select is(
  api.gacha_get_box_rewards(
    (select id from _ids where key = 'box'),
    (select id from _ids where key = 'future_scheduled_pool')
  ) ->> 'reason',
  'pool',
  'frontend rewards reject scheduled pools before effective_from'
);

select is(
  api.gacha_get_box_rewards(
    (select id from _ids where key = 'box'),
    (select id from _ids where key = 'draft_pool')
  ) ->> 'reason',
  'pool',
  'frontend rewards reject draft pools even when a pool id is supplied'
);

select is(
  api.gacha_get_box_rewards(
    (select id from _ids where key = 'box'),
    (select id from _ids where key = 'archived_pool')
  ) ->> 'reason',
  'pool',
  'frontend rewards reject archived pools even when a pool id is supplied'
);

select ok(
  not (api.gacha_get_box_rewards((select id from _ids where key = 'box')) ? 'status'),
  'frontend rewards do not expose drop pool lifecycle status'
);

select * from finish();

rollback;
