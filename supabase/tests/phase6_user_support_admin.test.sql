-- Phase 6 step 2.10 user/support admin checks.

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

insert into _ids (key, id)
values
  ('admin', '63000000-0000-4000-8000-000000000001'),
  ('target', '63000000-0000-4000-8000-000000000101'),
  ('template', '63000000-0000-4000-8000-000000000201'),
  ('form', '63000000-0000-4000-8000-000000000202'),
  ('ticket', '63000000-0000-4000-8000-000000000301'),
  ('task', '63000000-0000-4000-8000-000000000401'),
  ('task_progress', '63000000-0000-4000-8000-000000000402');

insert into core.users (id, telegram_user_id, username, invite_code, status)
values (
  (select id from _ids where key = 'target'),
  9700001001,
  'phase6_support_target',
  'P6SUP1001',
  'active'
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_users (id, email, display_name, status, metadata)
values (
  (select id from _ids where key = 'admin'),
  'phase6-support-admin@example.test',
  'Phase 6 Support Admin',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select (select id from _ids where key = 'admin'), id, (select id from _ids where key = 'admin')
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
values (
  (select id from _ids where key = 'template'),
  'phase6-support-template',
  'Phase 6 Support Template',
  'COMMON',
  'CHARACTER',
  'active',
  1
)
on conflict (id) do nothing;

insert into catalog.collectible_forms (
  id,
  template_id,
  form_index,
  form_slug,
  display_name,
  base_power_bonus,
  is_default
)
values (
  (select id from _ids where key = 'form'),
  (select id from _ids where key = 'template'),
  1,
  'base',
  'Base',
  0,
  true
)
on conflict (id) do nothing;

insert into tasks.task_definitions (
  id,
  code,
  title,
  task_type,
  period_type,
  target_count,
  reward
)
values (
  (select id from _ids where key = 'task'),
  'phase6_support_claimed_task',
  'Phase 6 Support Claimed Task',
  'daily',
  'daily',
  1,
  '{"currency":"KCOIN","amount":10}'::jsonb
)
on conflict (id) do update
set title = excluded.title,
    updated_at = now();

insert into tasks.user_task_progress (
  id,
  user_id,
  task_id,
  period_key,
  progress_count,
  target_count,
  status,
  completed_at,
  claimed_at
)
values (
  (select id from _ids where key = 'task_progress'),
  (select id from _ids where key = 'target'),
  (select id from _ids where key = 'task'),
  '2026-06-01',
  1,
  1,
  'claimed',
  now(),
  now()
)
on conflict (id) do update
set status = excluded.status,
    claimed_at = excluded.claimed_at,
    updated_at = now();

select ok(
  to_regprocedure('api.admin_compensate_user(uuid,uuid,text,text,numeric,uuid,text,text,jsonb)') is not null,
  'admin_compensate_user RPC exists with expected signature'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.admin_compensate_user(uuid,uuid,text,text,numeric,uuid,text,text,jsonb)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'api.admin_compensate_user(uuid,uuid,text,text,numeric,uuid,text,text,jsonb)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.admin_compensate_user(uuid,uuid,text,text,numeric,uuid,text,text,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'admin_compensate_user is service_role-only'
);

select ok(
  pg_get_functiondef(
    'api.admin_execute_approval_request(uuid,uuid,text,jsonb)'::regprocedure
  ) like '%when ''user.compensate'' then%',
  'approval execution supports user compensation requests'
);

select ok(
  exists (
    select 1
    from ops.admin_roles
    where code = 'SUPPORT'
      and permissions ?& array['users:read', 'payments:read', 'support:read', 'support:write', 'users:compensate']
  ),
  'SUPPORT role has user/support compensation permissions'
);

select ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'ops'
      and rel.relname = 'support_tickets'
      and con.conname = 'support_tickets_status_check'
      and pg_get_constraintdef(con.oid) like '%rejected%'
      and pg_get_constraintdef(con.oid) like '%escalated%'
      and pg_get_constraintdef(con.oid) not like '%closed%'
  ),
  'support_tickets status constraint matches support lifecycle'
);

select ok(
  testutil.raises_like(
    format(
      'insert into ops.support_tickets (id, user_id, ticket_type, subject, status) values (%L::uuid, %L::uuid, ''payment'', ''missing resolution'', ''resolved'')',
      '63000000-0000-4000-8000-000000000302',
      (select id from _ids where key = 'target')
    ),
    '%support_tickets_resolution_required_check%'
  ),
  'resolved support ticket requires resolution'
);

select ok(
  testutil.raises_like(
    format(
      'insert into ops.support_tickets (id, user_id, ticket_type, subject, status) values (%L::uuid, %L::uuid, ''payment'', ''missing rejection reason'', ''rejected'')',
      '63000000-0000-4000-8000-000000000303',
      (select id from _ids where key = 'target')
    ),
    '%support_tickets_rejected_reason_required_check%'
  ),
  'rejected support ticket requires rejected_reason or status_reason'
);

select ok(
  testutil.raises_like(
    format(
      'insert into ops.support_tickets (id, user_id, ticket_type, subject, status) values (%L::uuid, %L::uuid, ''payment'', ''missing escalation target'', ''escalated'')',
      '63000000-0000-4000-8000-000000000304',
      (select id from _ids where key = 'target')
    ),
    '%support_tickets_escalation_target_required_check%'
  ),
  'escalated support ticket requires owner or queue'
);

insert into ops.support_tickets (
  id,
  user_id,
  ticket_type,
  subject,
  status,
  resolution
)
values (
  (select id from _ids where key = 'ticket'),
  (select id from _ids where key = 'target'),
  'payment',
  'phase6 support ticket',
  'resolved',
  'handled by support'
)
on conflict (id) do update
set status = excluded.status,
    resolution = excluded.resolution,
    updated_at = now();

insert into _ids (key, payload)
values (
  'kcoin_compensation',
  api.admin_compensate_user(
    p_admin_user_id => (select id from _ids where key = 'admin'),
    p_target_user_id => (select id from _ids where key = 'target'),
    p_compensation_type => 'K-coin',
    p_currency_code => null,
    p_amount => 55,
    p_item_template_id => null,
    p_reason => 'phase6 support KCOIN compensation',
    p_idempotency_key => 'phase6-support-kcoin-001',
    p_request_context => jsonb_build_object(
      'ip_hash', 'phase6-support-ip',
      'user_agent_hash', 'phase6-support-ua',
      'approval_context', jsonb_build_object('approvalStatus', 'not_required')
    )
  )
);

select is(
  (
    select available_amount
    from economy.user_balances
    where user_id = (select id from _ids where key = 'target')
      and currency_code = 'KCOIN'
  ),
  55::numeric,
  'admin_compensate_user KCOIN writes balance snapshot'
);

select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'target')
      and idempotency_key = 'admin_compensation:phase6-support-kcoin-001'
      and source_type = 'admin_compensation'
  ),
  1,
  'admin_compensate_user KCOIN writes exactly one ledger row'
);

insert into _ids (key, payload)
values (
  'kcoin_compensation_repeat',
  api.admin_compensate_user(
    p_admin_user_id => (select id from _ids where key = 'admin'),
    p_target_user_id => (select id from _ids where key = 'target'),
    p_compensation_type => 'K-coin',
    p_currency_code => null,
    p_amount => 55,
    p_item_template_id => null,
    p_reason => 'phase6 support KCOIN compensation',
    p_idempotency_key => 'phase6-support-kcoin-001',
    p_request_context => jsonb_build_object(
      'ip_hash', 'phase6-support-ip',
      'user_agent_hash', 'phase6-support-ua',
      'approval_context', jsonb_build_object('approvalStatus', 'not_required')
    )
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'kcoin_compensation_repeat'))::boolean,
  'admin_compensate_user repeated idempotency key is idempotent'
);

select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where idempotency_key = 'admin_compensation:phase6-support-kcoin-001'
  ),
  1,
  'repeated idempotency key does not create another ledger row'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_compensate_user(%L::uuid, %L::uuid, ''task_reward'', ''KCOIN'', 10, null, ''phase6 duplicate task reward'', ''phase6-support-task-claimed-001'', jsonb_build_object(''source_task_progress_id'', %L, ''approval_context'', jsonb_build_object(''approvalStatus'', ''not_required'')))',
      (select id from _ids where key = 'admin'),
      (select id from _ids where key = 'target'),
      (select id from _ids where key = 'task_progress')
    ),
    '%ADMIN_TASK_REWARD_ALREADY_CLAIMED%'
  ),
  'task reward compensation refuses already claimed task progress'
);

insert into _ids (key, payload)
values (
  'item_compensation',
  api.admin_compensate_user(
    p_admin_user_id => (select id from _ids where key = 'admin'),
    p_target_user_id => (select id from _ids where key = 'target'),
    p_compensation_type => 'item',
    p_currency_code => null,
    p_amount => null,
    p_item_template_id => (select id from _ids where key = 'template'),
    p_reason => 'phase6 support item compensation',
    p_idempotency_key => 'phase6-support-item-001',
    p_request_context => jsonb_build_object(
      'item_form_id', (select id from _ids where key = 'form'),
      'ip_hash', 'phase6-support-ip',
      'user_agent_hash', 'phase6-support-ua',
      'approval_context', jsonb_build_object('approvalStatus', 'not_required')
    )
  )
);

select is(
  (
    select count(*)::int
    from inventory.item_instances
    where owner_user_id = (select id from _ids where key = 'target')
      and template_id = (select id from _ids where key = 'template')
      and source_type = 'admin_compensation'
  ),
  1,
  'item compensation creates an item instance'
);

select is(
  (
    select count(*)::int
    from inventory.item_instance_events event
    join inventory.item_instances item on item.id = event.item_instance_id
    where item.owner_user_id = (select id from _ids where key = 'target')
      and event.event_type = 'admin_granted'
      and event.source_type = 'admin_compensation'
      and event.metadata ->> 'idempotency_key' = 'phase6-support-item-001'
  ),
  1,
  'item compensation writes item_instance_events admin_granted'
);

select finish();

rollback;
