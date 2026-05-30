-- Phase 6 admin dangerous operation RPC checks.

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
values
  (
    '62000000-0000-4000-8000-000000000001',
    'phase6-danger-admin@example.test',
    'Phase 6 Danger Admin',
    'active',
    '{"test":true}'::jsonb
  ),
  (
    '62000000-0000-4000-8000-000000000002',
    'phase6-danger-reviewer@example.test',
    'Phase 6 Danger Reviewer',
    'active',
    '{"test":true}'::jsonb
  )
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select admin_id, role_id, '62000000-0000-4000-8000-000000000001'::uuid
from (
  values
    ('62000000-0000-4000-8000-000000000001'::uuid),
    ('62000000-0000-4000-8000-000000000002'::uuid)
) as admins(admin_id)
cross join (
  select id as role_id
  from ops.admin_roles
  where code = 'OPS'
) as role
on conflict (admin_user_id, role_id) do nothing;

insert into _ids (key, id)
values
  ('actor', '62000000-0000-4000-8000-000000000001'),
  ('reviewer', '62000000-0000-4000-8000-000000000002'),
  ('target_user', '62000000-0000-4000-8000-000000000101'),
  ('payment_user', '62000000-0000-4000-8000-000000000102'),
  ('template', '62000000-0000-4000-8000-000000000201'),
  ('box', '62000000-0000-4000-8000-000000000301'),
  ('old_pool', '62000000-0000-4000-8000-000000000302'),
  ('draft_pool', '62000000-0000-4000-8000-000000000303'),
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

insert into gacha.drop_pool_versions (
  id,
  box_id,
  version_no,
  status,
  total_weight,
  created_by_admin_id
)
values (
  (select id from _ids where key = 'draft_pool'),
  (select id from _ids where key = 'box'),
  2,
  'draft',
  10000,
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
  (select id from _ids where key = 'draft_pool'),
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
    and to_regprocedure('api.admin_publish_drop_pool_version(uuid,uuid,text,text,jsonb,jsonb)') is not null
    and to_regprocedure('api.admin_create_approval_request(uuid,text,text,text,uuid,jsonb,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_review_approval_request(uuid,uuid,text,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_execute_approval_request(uuid,uuid,text,jsonb)') is not null,
  'phase 6 admin danger RPCs exist'
);

select ok(
  to_regclass('ops.admin_approval_requests') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'ops'
        and table_name = 'admin_approval_requests'
        and column_name in (
          'requester_admin_user_id',
          'approver_admin_user_id',
          'action',
          'target_schema',
          'target_table',
          'target_id',
          'payload',
          'status',
          'reason',
          'review_reason',
          'created_at',
          'reviewed_at',
          'executed_at'
        )
      group by table_schema, table_name
      having count(*) = 13
    ),
  'admin approval request table has the required two-person review fields'
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
        '_admin_requires_approval',
        '_admin_execute_compensate_asset',
        '_admin_execute_ban_user',
        '_admin_execute_request_star_refund',
        '_admin_execute_release_inventory_lock',
        '_admin_execute_publish_drop_pool_version',
        'admin_create_approval_request',
        'admin_review_approval_request',
        'admin_execute_approval_request',
        'admin_compensate_asset',
        'admin_ban_user',
        'admin_request_star_refund',
        'admin_release_inventory_lock',
        'admin_publish_drop_pool_version',
        'admin_create_drop_pool_draft',
        'admin_update_drop_pool_item',
        'admin_validate_drop_pool',
        'admin_archive_drop_pool_version'
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
    ('api.admin_publish_drop_pool_version(uuid,uuid,text,text,jsonb,jsonb)'),
    ('api.admin_create_approval_request(uuid,text,text,text,uuid,jsonb,text,text,jsonb)'),
    ('api.admin_review_approval_request(uuid,uuid,text,text,text,jsonb)'),
    ('api.admin_execute_approval_request(uuid,uuid,text,jsonb)')
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
    p_drop_pool_version_id => (select id from _ids where key = 'draft_pool'),
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
  (select status from gacha.drop_pool_versions where id = (select id from _ids where key = 'draft_pool')),
  'active',
  'admin_publish_drop_pool_version publishes the draft version'
);

select is(
  (
    select probability_bps
    from gacha.drop_pool_items
    where pool_version_id = (select id from _ids where key = 'draft_pool')
  ),
  10000,
  'admin_publish_drop_pool_version writes probability bps'
);

insert into _ids (key, payload)
values (
  'drop_pool_repeat',
  api.admin_publish_drop_pool_version(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_drop_pool_version_id => (select id from _ids where key = 'draft_pool'),
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

insert into _ids (key, payload)
values (
  'approval_pending',
  api.admin_compensate_asset(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_user_id => (select id from _ids where key = 'target_user'),
    p_currency_code => 'KCOIN',
    p_amount => 13,
    p_reason => 'phase 6 compensation requires approval',
    p_idempotency_key => 'phase6-danger-approval-compensate-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_metadata => '{"case":"approval_compensate"}'::jsonb,
    p_approval_context => '{"requiresApproval":true}'::jsonb
  )
);

insert into _ids (key, id)
values (
  'approval_request',
  ((select payload ->> 'approval_request_id' from _ids where key = 'approval_pending'))::uuid
);

select is(
  (select status from ops.admin_approval_requests where id = (select id from _ids where key = 'approval_request')),
  'pending_approval',
  'requiresApproval creates a pending approval request'
);

select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where idempotency_key = 'admin_compensation:phase6-danger-approval-compensate-001'
  ),
  0,
  'pending approval does not write the business ledger'
);

select is(
  (
    select available_amount
    from economy.user_balances
    where user_id = (select id from _ids where key = 'target_user')
      and currency_code = 'KCOIN'
  ),
  37::numeric,
  'pending approval does not change the balance'
);

insert into _ids (key, payload)
values (
  'approval_pending_repeat',
  api.admin_compensate_asset(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_user_id => (select id from _ids where key = 'target_user'),
    p_currency_code => 'KCOIN',
    p_amount => 13,
    p_reason => 'phase 6 compensation requires approval',
    p_idempotency_key => 'phase6-danger-approval-compensate-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_metadata => '{"case":"approval_compensate"}'::jsonb,
    p_approval_context => '{"requiresApproval":true}'::jsonb
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'approval_pending_repeat'))::boolean
    and ((select payload ->> 'approval_request_id' from _ids where key = 'approval_pending_repeat'))::uuid = (select id from _ids where key = 'approval_request'),
  'pending approval request is idempotent'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_review_approval_request(%L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'approval_request'),
      'approved',
      'self approval must fail',
      'phase6-danger-approval-self-review-001',
      '{"ip_hash":"phase6-ip","user_agent_hash":"phase6-ua"}'
    ),
    '%ADMIN_APPROVER_SELF_REVIEW_NOT_ALLOWED%'
  ),
  'requester cannot approve their own high-risk operation'
);

insert into _ids (key, payload)
values (
  'approval_approved',
  api.admin_review_approval_request(
    p_admin_user_id => (select id from _ids where key = 'reviewer'),
    p_approval_request_id => (select id from _ids where key = 'approval_request'),
    p_decision => 'approved',
    p_review_reason => 'phase 6 approval review test',
    p_idempotency_key => 'phase6-danger-approval-review-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from ops.admin_approval_requests where id = (select id from _ids where key = 'approval_request')),
  'approved',
  'reviewer moves approval request to approved'
);

select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where idempotency_key = 'admin_compensation:phase6-danger-approval-compensate-001'
  ),
  0,
  'approved status still does not write business data before execution'
);

insert into _ids (key, payload)
values (
  'approval_executed',
  api.admin_execute_approval_request(
    p_admin_user_id => (select id from _ids where key = 'reviewer'),
    p_approval_request_id => (select id from _ids where key = 'approval_request'),
    p_idempotency_key => 'phase6-danger-approval-execute-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from ops.admin_approval_requests where id = (select id from _ids where key = 'approval_request')),
  'executed',
  'approved request moves to executed after explicit execution'
);

select ok(
  exists (
    select 1
    from ops.admin_approval_requests
    where id = (select id from _ids where key = 'approval_request')
      and executed_at is not null
      and execute_audit_log_id is not null
      and execution_result -> 'business_result' ->> 'audit_log_id' is not null
  ),
  'executed approval links the business audit result'
);

select is(
  (
    select available_amount
    from economy.user_balances
    where user_id = (select id from _ids where key = 'target_user')
      and currency_code = 'KCOIN'
  ),
  50::numeric,
  'approval execution applies the business compensation exactly once'
);

select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where idempotency_key = 'admin_compensation:phase6-danger-approval-compensate-001'
      and entry_type = 'credit'
  ),
  1,
  'approval execution writes one immutable ledger row'
);

insert into _ids (key, payload)
values (
  'approval_pending_reject',
  api.admin_compensate_asset(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_user_id => (select id from _ids where key = 'target_user'),
    p_currency_code => 'KCOIN',
    p_amount => 19,
    p_reason => 'phase 6 rejected compensation test',
    p_idempotency_key => 'phase6-danger-approval-reject-compensate-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua'),
    p_metadata => '{"case":"approval_reject"}'::jsonb,
    p_approval_context => '{"requiresApproval":true}'::jsonb
  )
);

insert into _ids (key, id)
values (
  'approval_reject_request',
  ((select payload ->> 'approval_request_id' from _ids where key = 'approval_pending_reject'))::uuid
);

insert into _ids (key, payload)
values (
  'approval_rejected',
  api.admin_review_approval_request(
    p_admin_user_id => (select id from _ids where key = 'reviewer'),
    p_approval_request_id => (select id from _ids where key = 'approval_reject_request'),
    p_decision => 'rejected',
    p_review_reason => 'phase 6 reject review test',
    p_idempotency_key => 'phase6-danger-approval-reject-review-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from ops.admin_approval_requests where id = (select id from _ids where key = 'approval_reject_request')),
  'rejected',
  'reviewer can reject a pending approval request'
);

select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where idempotency_key = 'admin_compensation:phase6-danger-approval-reject-compensate-001'
  ),
  0,
  'rejected approval does not write business data'
);

select is(
  (
    select available_amount
    from economy.user_balances
    where user_id = (select id from _ids where key = 'target_user')
      and currency_code = 'KCOIN'
  ),
  50::numeric,
  'rejected approval leaves the balance unchanged'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_execute_approval_request(%L::uuid, %L::uuid, %L, %L::jsonb)',
      (select id::text from _ids where key = 'reviewer'),
      (select id::text from _ids where key = 'approval_reject_request'),
      'phase6-danger-approval-rejected-execute-001',
      '{"ip_hash":"phase6-ip","user_agent_hash":"phase6-ua"}'
    ),
    '%ADMIN_APPROVAL_NOT_APPROVED%'
  ),
  'rejected approval cannot be executed'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where target_table = 'admin_approval_requests'
      and action in ('approval.request', 'approval.approve', 'approval.execute', 'approval.reject')
    group by target_table
    having count(distinct action) = 4
  ),
  'approval request, review, execute and reject paths write audit logs'
);

select * from finish();

rollback;
