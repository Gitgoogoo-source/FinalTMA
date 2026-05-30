-- Phase 6 blind box, price rule and banner campaign admin RPC checks.

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
  '64000000-0000-4000-8000-000000000001',
  'phase6-box-campaign-admin@example.test',
  'Phase 6 Box Campaign Admin',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select
  '64000000-0000-4000-8000-000000000001'::uuid,
  id,
  '64000000-0000-4000-8000-000000000001'::uuid
from ops.admin_roles
where code = 'OPS'
on conflict (admin_user_id, role_id) do nothing;

insert into _ids (key, id)
values
  ('actor', '64000000-0000-4000-8000-000000000001'),
  ('box', '64000000-0000-4000-8000-000000000101'),
  ('pool', '64000000-0000-4000-8000-000000000102'),
  ('price_rule_conflict', '64000000-0000-4000-8000-000000000103'),
  ('missing_box', '64000000-0000-4000-8000-000000000104'),
  ('banner', '64000000-0000-4000-8000-000000000201'),
  ('task', '64000000-0000-4000-8000-000000000301');

insert into tasks.task_definitions (
  id,
  code,
  title,
  task_type,
  period_type,
  target_count,
  reward,
  active
)
values (
  (select id from _ids where key = 'task'),
  'phase6_box_campaign_task',
  'Phase 6 Box Campaign Task',
  'daily',
  'once',
  1,
  '[]'::jsonb,
  true
)
on conflict (id) do update
set active = excluded.active,
    updated_at = now();

select ok(
  to_regprocedure('api.admin_upsert_blind_box(uuid,text,text,text,text,integer,text,text,jsonb,uuid,text,integer,integer,numeric,text,text,timestamptz,timestamptz,integer,jsonb)') is not null
    and to_regprocedure('api.admin_update_box_status(uuid,uuid,text,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_upsert_box_price_rule(uuid,uuid,integer,integer,text,text,jsonb,uuid,integer,boolean,timestamptz,timestamptz,jsonb)') is not null
    and to_regprocedure('api.admin_upsert_banner_campaign(uuid,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,timestamptz,timestamptz,integer,jsonb)') is not null,
  'box and banner admin RPCs exist with p_-prefixed signatures'
);

with signatures(signature) as (
  values
    ('api.admin_upsert_blind_box(uuid,text,text,text,text,integer,text,text,jsonb,uuid,text,integer,integer,numeric,text,text,timestamptz,timestamptz,integer,jsonb)'),
    ('api.admin_update_box_status(uuid,uuid,text,text,text,jsonb)'),
    ('api.admin_upsert_box_price_rule(uuid,uuid,integer,integer,text,text,jsonb,uuid,integer,boolean,timestamptz,timestamptz,jsonb)'),
    ('api.admin_upsert_banner_campaign(uuid,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,timestamptz,timestamptz,integer,jsonb)')
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
  'box and banner admin RPCs are service_role only'
);

insert into _ids (key, payload)
values (
  'create_box',
  api.admin_upsert_blind_box(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_slug => 'phase6-admin-box',
    p_display_name => 'Phase 6 Admin Box',
    p_tier => 'normal',
    p_status => 'draft',
    p_price_stars => 12,
    p_total_stock => 100,
    p_remaining_stock => 100,
    p_open_reward_kcoin => 100,
    p_reason => 'phase 6 create blind box',
    p_idempotency_key => 'phase6-box-create-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'box')),
  'draft',
  'admin_upsert_blind_box creates a draft blind box'
);

insert into _ids (key, payload)
values (
  'create_box_repeat',
  api.admin_upsert_blind_box(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_slug => 'phase6-admin-box',
    p_display_name => 'Phase 6 Admin Box',
    p_tier => 'normal',
    p_status => 'draft',
    p_price_stars => 12,
    p_total_stock => 100,
    p_remaining_stock => 100,
    p_open_reward_kcoin => 100,
    p_reason => 'phase 6 create blind box',
    p_idempotency_key => 'phase6-box-create-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'create_box_repeat'))::boolean,
  'admin_upsert_blind_box returns idempotent repeat'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_update_box_status(%L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'box'),
      'active',
      'phase 6 active without pool rejected',
      'phase6-box-status-active-no-pool',
      '{}'
    ),
    '%ADMIN_BOX_ACTIVE_POOL_REQUIRED%'
  ),
  'admin_update_box_status rejects active without an active drop pool'
);

insert into gacha.drop_pool_versions (
  id,
  box_id,
  version_no,
  status,
  total_weight,
  published_at,
  effective_from,
  created_by_admin_id
)
values (
  (select id from _ids where key = 'pool'),
  (select id from _ids where key = 'box'),
  1,
  'active',
  1,
  now(),
  now(),
  (select id from _ids where key = 'actor')
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into _ids (key, payload)
values (
  'activate_box',
  api.admin_update_box_status(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_status => 'active',
    p_reason => 'phase 6 activate blind box',
    p_idempotency_key => 'phase6-box-status-active-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'box')),
  'active',
  'admin_update_box_status activates after active pool exists'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_update_box_status(%L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'box'),
      'draft',
      'phase 6 invalid status transition',
      'phase6-box-status-invalid-transition',
      '{}'
    ),
    '%ADMIN_BOX_STATUS_TRANSITION_INVALID%'
  ),
  'admin_update_box_status rejects illegal status transitions'
);

insert into _ids (key, payload)
values (
  'price_rule',
  api.admin_upsert_box_price_rule(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_quantity => 10,
    p_discount_bps => 1000,
    p_reason => 'phase 6 create box price rule',
    p_idempotency_key => 'phase6-box-price-rule-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select discount_bps from gacha.box_price_rules where id = ((select payload ->> 'box_price_rule_id' from _ids where key = 'price_rule'))::uuid),
  1000,
  'admin_upsert_box_price_rule writes the discount'
);

insert into _ids (key, payload)
values (
  'price_rule_repeat',
  api.admin_upsert_box_price_rule(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_quantity => 10,
    p_discount_bps => 1000,
    p_reason => 'phase 6 create box price rule',
    p_idempotency_key => 'phase6-box-price-rule-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'price_rule_repeat'))::boolean,
  'admin_upsert_box_price_rule returns idempotent repeat'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_box_price_rule(p_admin_user_id => %L::uuid, p_box_id => %L::uuid, p_quantity => 10, p_discount_bps => 500, p_reason => %L, p_idempotency_key => %L, p_price_rule_id => %L::uuid)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'box'),
      'phase 6 price overlap rejected',
      'phase6-box-price-rule-overlap',
      (select id::text from _ids where key = 'price_rule_conflict')
    ),
    '%ADMIN_BOX_PRICE_RULE_WINDOW_CONFLICT%'
  ),
  'admin_upsert_box_price_rule rejects overlapping active rule windows'
);

insert into _ids (key, payload)
values (
  'banner_payload',
  api.admin_upsert_banner_campaign(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_banner_campaign_id => (select id from _ids where key = 'banner'),
    p_code => 'phase6-admin-banner',
    p_title => 'Phase 6 Admin Banner',
    p_image_url => 'https://example.test/banner.png',
    p_placement => 'box_top',
    p_target_type => 'box',
    p_target_ref => (select id::text from _ids where key = 'box'),
    p_status => 'active',
    p_reason => 'phase 6 create banner campaign',
    p_idempotency_key => 'phase6-banner-campaign-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select target_type from catalog.banner_campaigns where id = (select id from _ids where key = 'banner')),
  'box',
  'admin_upsert_banner_campaign writes a valid box target'
);

insert into _ids (key, payload)
values (
  'banner_repeat',
  api.admin_upsert_banner_campaign(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_banner_campaign_id => (select id from _ids where key = 'banner'),
    p_code => 'phase6-admin-banner',
    p_title => 'Phase 6 Admin Banner',
    p_image_url => 'https://example.test/banner.png',
    p_placement => 'box_top',
    p_target_type => 'box',
    p_target_ref => (select id::text from _ids where key = 'box'),
    p_status => 'active',
    p_reason => 'phase 6 create banner campaign',
    p_idempotency_key => 'phase6-banner-campaign-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'banner_repeat'))::boolean,
  'admin_upsert_banner_campaign returns idempotent repeat'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_banner_campaign(p_admin_user_id => %L::uuid, p_code => %L, p_title => %L, p_image_url => %L, p_placement => %L, p_target_type => %L, p_target_ref => %L, p_status => %L, p_reason => %L, p_idempotency_key => %L)',
      (select id::text from _ids where key = 'actor'),
      'phase6-missing-target-banner',
      'Phase 6 Missing Target Banner',
      'https://example.test/banner.png',
      'box_top',
      'box',
      (select id::text from _ids where key = 'missing_box'),
      'active',
      'phase 6 missing banner target rejected',
      'phase6-banner-missing-target'
    ),
    '%ADMIN_BANNER_TARGET_NOT_FOUND%'
  ),
  'admin_upsert_banner_campaign rejects missing target references'
);

select is(
  (
    select count(distinct action)::int
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'actor')
      and action in (
        'gacha.blind_box.create',
        'gacha.blind_box.status_update',
        'gacha.box_price_rule.upsert',
        'catalog.banner_campaign.upsert'
      )
  ),
  4,
  'all box and banner admin RPCs write audit logs'
);

select finish();

rollback;
