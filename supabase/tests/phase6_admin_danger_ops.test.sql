-- Phase 6 admin dangerous operation RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb,
  value text
) on commit drop;

insert into core.users (id, telegram_user_id, username, invite_code, status)
values
  (
    '62000000-0000-4000-8000-000000000101',
    9700000601,
    'phase6_danger_target',
    'P6DNG0601',
    'active'
  ),
  (
    '62000000-0000-4000-8000-000000000102',
    9700000602,
    'phase6_danger_payment',
    'P6DNG0602',
    'active'
  )
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_users (id, email, display_name, status, metadata)
values (
  '62000000-0000-4000-8000-000000000001',
  'phase6-danger-admin@example.test',
  'Phase 6 Danger Admin',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into _ids (key, id)
values
  ('actor', '62000000-0000-4000-8000-000000000001'),
  ('target_user', '62000000-0000-4000-8000-000000000101'),
  ('payment_user', '62000000-0000-4000-8000-000000000102'),
  ('template', '62000000-0000-4000-8000-000000000201'),
  ('box', '62000000-0000-4000-8000-000000000301'),
  ('old_pool', '62000000-0000-4000-8000-000000000302'),
  ('item', '62000000-0000-4000-8000-000000000401'),
  ('lock', '62000000-0000-4000-8000-000000000402'),
  ('star_order', '62000000-0000-4000-8000-000000000501'),
  ('star_payment', '62000000-0000-4000-8000-000000000502'),
  ('session', '62000000-0000-4000-8000-000000000601');

insert into core.app_sessions (
  id,
  user_id,
  session_token_hash,
  expires_at
)
values (
  (select id from _ids where key = 'session'),
  (select id from _ids where key = 'target_user'),
  'phase6-danger-session-token-hash',
  now() + interval '1 day'
);

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
  'phase6-danger-template',
  'Phase 6 Danger Template',
  'COMMON',
  'CHARACTER',
  'active',
  1
)
on conflict (id) do nothing;

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
  'phase6-danger-box',
  'Phase 6 Danger Box',
  'normal',
  'active',
  1,
  100,
  100
)
on conflict (id) do nothing;

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
  (select id from _ids where key = 'old_pool'),
  (select id from _ids where key = 'box'),
  1,
  'active',
  10000,
  now(),
  now(),
  (select id from _ids where key = 'actor')
)
on conflict (id) do nothing;

insert into gacha.drop_pool_items (
  pool_version_id,
  template_id,
  rarity_code,
  drop_weight,
  probability_bps
)
values (
  (select id from _ids where key = 'old_pool'),
  (select id from _ids where key = 'template'),
  'COMMON',
  10000,
  10000
);

insert into inventory.item_instances (
  id,
  owner_user_id,
  template_id,
  status,
  source_type,
  metadata
)
values (
  (select id from _ids where key = 'item'),
  (select id from _ids where key = 'target_user'),
  (select id from _ids where key = 'template'),
  'locked',
  'admin',
  '{"test":true}'::jsonb
);

insert into inventory.inventory_locks (
  id,
  item_instance_id,
  user_id,
  lock_type,
  source_type,
  status,
  metadata
)
values (
  (select id from _ids where key = 'lock'),
  (select id from _ids where key = 'item'),
  (select id from _ids where key = 'target_user'),
  'admin_hold',
  'admin_hold',
  'active',
  '{"test":true}'::jsonb
);

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  idempotency_key,
  paid_at
)
values (
  (select id from _ids where key = 'star_order'),
  (select id from _ids where key = 'payment_user'),
  'admin_test',
  'paid',
  9,
  'phase6-danger-refund-payload',
  'Phase 6 danger refund',
  'phase6-danger-refund-order',
  now()
);

insert into payments.star_payments (
  id,
  star_order_id,
  user_id,
  telegram_payment_charge_id,
  xtr_amount,
  currency,
  invoice_payload
)
values (
  (select id from _ids where key = 'star_payment'),
  (select id from _ids where key = 'star_order'),
  (select id from _ids where key = 'payment_user'),
  'phase6-danger-charge-id',
  9,
  'XTR',
  'phase6-danger-refund-payload'
);

select ok(
  to_regprocedure('api.admin_compensate_asset(uuid,uuid,text,numeric,text,text,jsonb,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_ban_user(uuid,uuid,text,text,text,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_request_star_refund(uuid,uuid,text,text,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_release_inventory_lock(uuid,uuid,text,text,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_publish_drop_pool_version(uuid,uuid,jsonb,text,text,jsonb,jsonb)') is not null,
  'phase 6 admin danger RPCs exist'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname in (
        '_admin_require_active',
        '_admin_start_idempotency',
        '_admin_complete_idempotency',
        'admin_compensate_asset',
        'admin_ban_user',
        'admin_request_star_refund',
        'admin_release_inventory_lock',
        'admin_publish_drop_pool_version'
      )
      and (
        not p.prosecdef
        or not (p.proconfig @> array['search_path=""'])
      )
  ),
  'phase 6 admin danger RPCs are security definer with fixed empty search_path'
);

with signatures(signature) as (
  values
    ('api.admin_compensate_asset(uuid,uuid,text,numeric,text,text,jsonb,jsonb,jsonb)'),
    ('api.admin_ban_user(uuid,uuid,text,text,text,jsonb,jsonb)'),
    ('api.admin_request_star_refund(uuid,uuid,text,text,jsonb,jsonb)'),
    ('api.admin_release_inventory_lock(uuid,uuid,text,text,jsonb,jsonb)'),
    ('api.admin_publish_drop_pool_version(uuid,uuid,jsonb,text,text,jsonb,jsonb)')
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
  'phase 6 admin danger RPCs are service_role only'
);

select ok(
  exists (
    select 1
    from ops.admin_roles
    where code = 'RISK'
      and permissions ? 'users:ban'
  ),
  'RISK role has users:ban permission for dangerous user actions'
);

insert into _ids (key, payload)
values (
  'compensate',
  api.admin_compensate_asset(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_user_id => (select id from _ids where key = 'target_user'),
    p_currency_code => 'KCOIN',
    p_amount => 37,
    p_reason => 'phase 6 asset compensation test',
    p_idempotency_key => 'phase6-danger-compensate-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_metadata => '{"case":"compensate"}'::jsonb,
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select is(
  (
    select available_amount
    from economy.user_balances
    where user_id = (select id from _ids where key = 'target_user')
      and currency_code = 'KCOIN'
  ),
  37::numeric,
  'admin_compensate_asset credits the user balance'
);

select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where idempotency_key = 'admin_compensation:phase6-danger-compensate-001'
      and entry_type = 'credit'
      and source_type = 'admin_compensation'
  ),
  1,
  'admin_compensate_asset writes one immutable ledger row'
);

insert into _ids (key, payload)
values (
  'compensate_repeat',
  api.admin_compensate_asset(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_user_id => (select id from _ids where key = 'target_user'),
    p_currency_code => 'KCOIN',
    p_amount => 37,
    p_reason => 'phase 6 asset compensation test',
    p_idempotency_key => 'phase6-danger-compensate-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_metadata => '{"case":"compensate"}'::jsonb,
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'compensate_repeat'))::boolean,
  'admin_compensate_asset returns idempotent repeat'
);

insert into _ids (key, payload)
values (
  'ban_user',
  api.admin_ban_user(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_user_id => (select id from _ids where key = 'target_user'),
    p_status => 'banned',
    p_reason => 'phase 6 ban user test',
    p_idempotency_key => 'phase6-danger-ban-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select is(
  (select status from core.users where id = (select id from _ids where key = 'target_user')),
  'banned',
  'admin_ban_user updates target user status'
);

select ok(
  exists (
    select 1
    from core.app_sessions
    where id = (select id from _ids where key = 'session')
      and revoked_at is not null
  ),
  'admin_ban_user revokes active sessions'
);

select ok(
  exists (
    select 1
    from core.user_flags
    where user_id = (select id from _ids where key = 'target_user')
      and flag_code = 'admin_ban'
      and flag_level = 'ban'
      and active
  ),
  'admin_ban_user writes an active ban flag'
);

insert into _ids (key, payload)
values (
  'refund',
  api.admin_request_star_refund(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_order_id => (select id from _ids where key = 'star_order'),
    p_reason => 'phase 6 refund request test',
    p_idempotency_key => 'phase6-danger-refund-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select is(
  (
    select status
    from payments.star_refunds
    where star_order_id = (select id from _ids where key = 'star_order')
  ),
  'requested',
  'admin_request_star_refund records a requested refund'
);

insert into _ids (key, payload)
values (
  'refund_repeat',
  api.admin_request_star_refund(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_star_order_id => (select id from _ids where key = 'star_order'),
    p_reason => 'phase 6 refund request test',
    p_idempotency_key => 'phase6-danger-refund-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'refund_repeat'))::boolean,
  'admin_request_star_refund returns idempotent repeat'
);

insert into _ids (key, payload)
values (
  'release_lock',
  api.admin_release_inventory_lock(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_lock_id => (select id from _ids where key = 'lock'),
    p_reason => 'phase 6 release lock test',
    p_idempotency_key => 'phase6-danger-release-lock-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select is(
  (select status from inventory.inventory_locks where id = (select id from _ids where key = 'lock')),
  'released',
  'admin_release_inventory_lock releases the active lock'
);

select is(
  (select status from inventory.item_instances where id = (select id from _ids where key = 'item')),
  'available',
  'admin_release_inventory_lock restores the item to available'
);

select ok(
  exists (
    select 1
    from inventory.item_instance_events
    where item_instance_id = (select id from _ids where key = 'item')
      and event_type = 'admin_adjusted'
      and source_type = 'admin_release_inventory_lock'
  ),
  'admin_release_inventory_lock writes an item event'
);

insert into _ids (key, payload)
values (
  'release_lock_repeat',
  api.admin_release_inventory_lock(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_lock_id => (select id from _ids where key = 'lock'),
    p_reason => 'phase 6 release lock test',
    p_idempotency_key => 'phase6-danger-release-lock-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'release_lock_repeat'))::boolean,
  'admin_release_inventory_lock returns idempotent repeat'
);

insert into _ids (key, payload)
values (
  'drop_pool',
  api.admin_publish_drop_pool_version(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_items => jsonb_build_array(
      jsonb_build_object(
        'template_id', (select id from _ids where key = 'template'),
        'rarity_code', 'COMMON',
        'drop_weight', 10000,
        'probability_bps', 10000
      )
    ),
    p_reason => 'phase 6 probability publish test',
    p_idempotency_key => 'phase6-danger-drop-pool-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

insert into _ids (key, id)
values (
  'new_pool',
  ((select payload ->> 'drop_pool_version_id' from _ids where key = 'drop_pool'))::uuid
);

select is(
  (select status from gacha.drop_pool_versions where id = (select id from _ids where key = 'old_pool')),
  'archived',
  'admin_publish_drop_pool_version archives the previous active version'
);

select is(
  (select status from gacha.drop_pool_versions where id = (select id from _ids where key = 'new_pool')),
  'active',
  'admin_publish_drop_pool_version creates a new active version'
);

select is(
  (
    select probability_bps
    from gacha.drop_pool_items
    where pool_version_id = (select id from _ids where key = 'new_pool')
  ),
  10000,
  'admin_publish_drop_pool_version writes probability bps'
);

insert into _ids (key, payload)
values (
  'drop_pool_repeat',
  api.admin_publish_drop_pool_version(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_items => jsonb_build_array(
      jsonb_build_object(
        'template_id', (select id from _ids where key = 'template'),
        'rarity_code', 'COMMON',
        'drop_weight', 10000,
        'probability_bps', 10000
      )
    ),
    p_reason => 'phase 6 probability publish test',
    p_idempotency_key => 'phase6-danger-drop-pool-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_approval_context => '{"approvalStatus":"not_required"}'::jsonb
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'drop_pool_repeat'))::boolean,
  'admin_publish_drop_pool_version returns idempotent repeat'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'actor')
      and action in (
        'asset.compensate',
        'user.ban',
        'payment.refund.request',
        'inventory.lock.release',
        'gacha.drop_pool.publish'
      )
    group by admin_user_id
    having count(distinct action) = 5
  ),
  'danger operation RPCs write admin audit logs'
);

select * from finish();

rollback;
