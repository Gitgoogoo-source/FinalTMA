-- Phase 6 admin user and role RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(36);

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb,
  value text
) on commit drop;

create temp table _errors (
  key text primary key,
  message text
) on commit drop;

insert into core.users (id, telegram_user_id, username, invite_code)
values
  (
    '61000000-0000-4000-8000-000000000101',
    9600000601,
    'phase6_admin_target',
    'P6ADM0601'
  ),
  (
    '61000000-0000-4000-8000-000000000102',
    9600000602,
    'phase6_admin_other',
    'P6ADM0602'
  )
on conflict (id) do nothing;

with actor as (
  insert into ops.admin_users (id, email, display_name, status, metadata)
  values (
    '61000000-0000-4000-8000-000000000001',
    'phase6-admin-actor@example.test',
    'Phase 6 Admin Actor',
    'active',
    '{"test":true}'::jsonb
  )
  returning id
)
insert into _ids (key, id)
select 'actor', id from actor;

insert into _ids (key, id)
select lower(code) || '_role', id
from ops.admin_roles
where code in ('OPS', 'SUPER_ADMIN');

select ok(
  to_regprocedure('api.admin_create_user(uuid,uuid,bigint,text,text,text,jsonb,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_update_user_status(uuid,uuid,text,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_grant_role(uuid,uuid,uuid,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_revoke_role(uuid,uuid,uuid,text,text,jsonb)') is not null,
  'phase 6 admin user/role RPCs exist'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname in (
        'admin_create_user',
        'admin_update_user_status',
        'admin_grant_role',
        'admin_revoke_role'
      )
      and (
        not p.prosecdef
        or not (p.proconfig @> array['search_path=""'])
      )
  ),
  'phase 6 admin RPCs are security definer with fixed empty search_path'
);

with signatures(signature) as (
  values
    ('api.admin_create_user(uuid,uuid,bigint,text,text,text,jsonb,text,text,jsonb)'),
    ('api.admin_update_user_status(uuid,uuid,text,text,text,jsonb)'),
    ('api.admin_grant_role(uuid,uuid,uuid,text,text,jsonb)'),
    ('api.admin_revoke_role(uuid,uuid,uuid,text,text,jsonb)')
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
  'phase 6 admin RPCs are service_role only'
);

insert into _ids (key, payload)
values (
  'created_admin',
  api.admin_create_user(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_telegram_user_id => 9600000601,
    p_email => 'phase6-target-admin@example.test',
    p_display_name => 'Phase 6 Target Admin',
    p_metadata => '{"source":"phase6-test"}'::jsonb,
    p_reason => 'create admin user for phase 6 test',
    p_idempotency_key => 'phase6-admin-create-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

insert into _ids (key, id)
values (
  'target_admin',
  ((select payload ->> 'admin_user_id' from _ids where key = 'created_admin'))::uuid
);

select is(
  (select payload ->> 'status' from _ids where key = 'created_admin'),
  'active',
  'admin_create_user returns an active admin user'
);

select is(
  (
    select core_user_id
    from ops.admin_users
    where id = (select id from _ids where key = 'target_admin')
  ),
  '61000000-0000-4000-8000-000000000101'::uuid,
  'admin_create_user binds the matching core user from telegram_user_id'
);

select is(
  (
    select display_name
    from ops.admin_users
    where id = (select id from _ids where key = 'target_admin')
  ),
  'Phase 6 Target Admin',
  'admin_create_user writes the admin row'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'admin.create_user'
      and target_table = 'admin_users'
      and target_id = (select id from _ids where key = 'target_admin')
      and reason = 'create admin user for phase 6 test'
  ),
  1,
  'admin_create_user writes one audit log'
);

select is(
  (
    select status
    from ops.idempotency_keys
    where key = 'phase6-admin-create-001'
  ),
  'completed',
  'admin_create_user stores completed idempotency'
);

insert into _ids (key, payload)
values (
  'created_admin_repeat',
  api.admin_create_user(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_telegram_user_id => 9600000601,
    p_email => 'phase6-target-admin@example.test',
    p_display_name => 'Phase 6 Target Admin',
    p_metadata => '{"source":"phase6-test"}'::jsonb,
    p_reason => 'create admin user for phase 6 test',
    p_idempotency_key => 'phase6-admin-create-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'created_admin_repeat'))::boolean,
  'admin_create_user returns idempotent repeat'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'admin.create_user'
      and target_id = (select id from _ids where key = 'target_admin')
      and reason = 'create admin user for phase 6 test'
  ),
  1,
  'admin_create_user idempotent repeat does not duplicate audit'
);

do $$
begin
  perform api.admin_create_user(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_telegram_user_id => 9600000601,
    p_email => 'phase6-target-admin-duplicate@example.test',
    p_display_name => 'Duplicate Admin',
    p_reason => 'duplicate admin user for phase 6 test',
    p_idempotency_key => 'phase6-admin-create-duplicate'
  );
  insert into _errors (key, message) values ('duplicate_admin', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('duplicate_admin', sqlerrm);
end
$$;

select is(
  (select message from _errors where key = 'duplicate_admin'),
  'ADMIN_USER_ALREADY_EXISTS',
  'admin_create_user rejects duplicate bindable identity'
);

do $$
begin
  perform api.admin_create_user(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_display_name => 'Missing Identity Admin',
    p_reason => 'missing identity for phase 6 test',
    p_idempotency_key => 'phase6-admin-create-missing-identity'
  );
  insert into _errors (key, message) values ('missing_identity', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('missing_identity', sqlerrm);
end
$$;

select is(
  (select message from _errors where key = 'missing_identity'),
  'ADMIN_BINDING_IDENTITY_REQUIRED',
  'admin_create_user requires at least one bindable identity'
);

do $$
begin
  perform api.admin_create_user(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_core_user_id => '61000000-0000-4000-8000-000000000102',
    p_telegram_user_id => 9600000601,
    p_email => 'phase6-mismatch@example.test',
    p_display_name => 'Mismatched Admin',
    p_reason => 'mismatch identity for phase 6 test',
    p_idempotency_key => 'phase6-admin-create-mismatch'
  );
  insert into _errors (key, message) values ('core_telegram_mismatch', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('core_telegram_mismatch', sqlerrm);
end
$$;

select is(
  (select message from _errors where key = 'core_telegram_mismatch'),
  'ADMIN_CORE_TELEGRAM_MISMATCH',
  'admin_create_user rejects mismatched core_user_id and telegram_user_id'
);

insert into _ids (key, payload)
values (
  'status_locked',
  api.admin_update_user_status(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    'locked',
    'lock admin user for phase 6 test',
    'phase6-admin-status-locked-001',
    jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select payload ->> 'status' from _ids where key = 'status_locked'),
  'locked',
  'admin_update_user_status returns locked status'
);

select is(
  (
    select status
    from ops.admin_users
    where id = (select id from _ids where key = 'target_admin')
  ),
  'locked',
  'admin_update_user_status writes locked status'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'admin.update_status'
      and target_id = (select id from _ids where key = 'target_admin')
      and reason = 'lock admin user for phase 6 test'
  ),
  1,
  'admin_update_user_status writes one audit log'
);

insert into _ids (key, payload)
values (
  'status_locked_repeat',
  api.admin_update_user_status(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    'locked',
    'lock admin user for phase 6 test',
    'phase6-admin-status-locked-001',
    jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'status_locked_repeat'))::boolean,
  'admin_update_user_status returns idempotent repeat'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'admin.update_status'
      and target_id = (select id from _ids where key = 'target_admin')
      and reason = 'lock admin user for phase 6 test'
  ),
  1,
  'admin_update_user_status idempotent repeat does not duplicate audit'
);

do $$
begin
  perform api.admin_update_user_status(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    'suspended',
    'invalid status for phase 6 test',
    'phase6-admin-status-invalid'
  );
  insert into _errors (key, message) values ('invalid_status', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('invalid_status', sqlerrm);
end
$$;

select is(
  (select message from _errors where key = 'invalid_status'),
  'ADMIN_USER_STATUS_INVALID',
  'admin_update_user_status rejects statuses outside active/disabled/locked'
);

insert into _ids (key, payload)
values (
  'status_active',
  api.admin_update_user_status(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    'active',
    'unlock admin user for role tests',
    'phase6-admin-status-active-001',
    jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (
    select status
    from ops.admin_users
    where id = (select id from _ids where key = 'target_admin')
  ),
  'active',
  'admin_update_user_status can restore active status'
);

insert into _ids (key, payload)
values (
  'disabled_admin',
  api.admin_create_user(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_email => 'phase6-disabled-admin@example.test',
    p_display_name => 'Phase 6 Disabled Admin',
    p_status => 'disabled',
    p_reason => 'create disabled admin user for phase 6 test',
    p_idempotency_key => 'phase6-admin-create-disabled-001'
  )
);

insert into _ids (key, id)
values (
  'disabled_target_admin',
  ((select payload ->> 'admin_user_id' from _ids where key = 'disabled_admin'))::uuid
);

select is(
  (select payload ->> 'status' from _ids where key = 'disabled_admin'),
  'disabled',
  'admin_create_user can create a disabled admin user'
);

insert into _ids (key, payload)
values (
  'grant_ops',
  api.admin_grant_role(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    (select id from _ids where key = 'ops_role'),
    'grant ops role for phase 6 test',
    'phase6-admin-grant-ops-001',
    jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'role_granted' from _ids where key = 'grant_ops'))::boolean,
  'admin_grant_role returns role_granted=true'
);

select is(
  (
    select count(*)::int
    from ops.admin_user_roles
    where admin_user_id = (select id from _ids where key = 'target_admin')
      and role_id = (select id from _ids where key = 'ops_role')
      and granted_by_admin_id = (select id from _ids where key = 'actor')
  ),
  1,
  'admin_grant_role inserts the role link'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'admin.grant_role'
      and target_table = 'admin_user_roles'
      and target_id = (select id from _ids where key = 'target_admin')
      and reason = 'grant ops role for phase 6 test'
  ),
  1,
  'admin_grant_role writes one audit log'
);

insert into _ids (key, payload)
values (
  'grant_ops_repeat',
  api.admin_grant_role(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    (select id from _ids where key = 'ops_role'),
    'grant ops role for phase 6 test',
    'phase6-admin-grant-ops-001',
    jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'grant_ops_repeat'))::boolean,
  'admin_grant_role returns idempotent repeat'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'admin.grant_role'
      and target_id = (select id from _ids where key = 'target_admin')
      and reason = 'grant ops role for phase 6 test'
  ),
  1,
  'admin_grant_role idempotent repeat does not duplicate audit'
);

do $$
begin
  perform api.admin_grant_role(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'disabled_target_admin'),
    (select id from _ids where key = 'ops_role'),
    'grant role to disabled admin for phase 6 test',
    'phase6-admin-grant-disabled'
  );
  insert into _errors (key, message) values ('grant_disabled', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('grant_disabled', sqlerrm);
end
$$;

select is(
  (select message from _errors where key = 'grant_disabled'),
  'ADMIN_TARGET_USER_DISABLED',
  'admin_grant_role rejects disabled target admin users'
);

do $$
begin
  perform api.admin_grant_role(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    '61000000-0000-4000-8000-000000099999',
    'grant missing role for phase 6 test',
    'phase6-admin-grant-missing-role'
  );
  insert into _errors (key, message) values ('grant_missing_role', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('grant_missing_role', sqlerrm);
end
$$;

select is(
  (select message from _errors where key = 'grant_missing_role'),
  'ADMIN_ROLE_NOT_FOUND',
  'admin_grant_role rejects missing roles'
);

insert into _ids (key, payload)
values (
  'revoke_ops',
  api.admin_revoke_role(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    (select id from _ids where key = 'ops_role'),
    'revoke ops role for phase 6 test',
    'phase6-admin-revoke-ops-001',
    jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'role_revoked' from _ids where key = 'revoke_ops'))::boolean,
  'admin_revoke_role returns role_revoked=true'
);

select is(
  (
    select count(*)::int
    from ops.admin_user_roles
    where admin_user_id = (select id from _ids where key = 'target_admin')
      and role_id = (select id from _ids where key = 'ops_role')
  ),
  0,
  'admin_revoke_role deletes the role link'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'admin.revoke_role'
      and target_table = 'admin_user_roles'
      and target_id = (select id from _ids where key = 'target_admin')
      and reason = 'revoke ops role for phase 6 test'
  ),
  1,
  'admin_revoke_role writes one audit log'
);

insert into _ids (key, payload)
values (
  'revoke_ops_repeat',
  api.admin_revoke_role(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    (select id from _ids where key = 'ops_role'),
    'revoke ops role for phase 6 test',
    'phase6-admin-revoke-ops-001',
    jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'revoke_ops_repeat'))::boolean,
  'admin_revoke_role returns idempotent repeat'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'admin.revoke_role'
      and target_id = (select id from _ids where key = 'target_admin')
      and reason = 'revoke ops role for phase 6 test'
  ),
  1,
  'admin_revoke_role idempotent repeat does not duplicate audit'
);

insert into _ids (key, payload)
values (
  'grant_super',
  api.admin_grant_role(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    (select id from _ids where key = 'super_admin_role'),
    'grant super admin role for phase 6 last-role test',
    'phase6-admin-grant-super-001'
  )
);

select ok(
  ((select payload ->> 'role_granted' from _ids where key = 'grant_super'))::boolean,
  'admin_grant_role can grant SUPER_ADMIN'
);

do $$
begin
  perform api.admin_revoke_role(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    (select id from _ids where key = 'super_admin_role'),
    'revoke last super admin for phase 6 test',
    'phase6-admin-revoke-last-super'
  );
  insert into _errors (key, message) values ('revoke_last_super', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('revoke_last_super', sqlerrm);
end
$$;

select is(
  (select message from _errors where key = 'revoke_last_super'),
  'ADMIN_LAST_SUPER_ADMIN_REQUIRED',
  'admin_revoke_role prevents revoking the last active SUPER_ADMIN'
);

do $$
begin
  perform api.admin_update_user_status(
    (select id from _ids where key = 'actor'),
    (select id from _ids where key = 'target_admin'),
    'disabled',
    'disable last super admin for phase 6 test',
    'phase6-admin-disable-last-super'
  );
  insert into _errors (key, message) values ('disable_last_super', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('disable_last_super', sqlerrm);
end
$$;

select is(
  (select message from _errors where key = 'disable_last_super'),
  'ADMIN_LAST_SUPER_ADMIN_REQUIRED',
  'admin_update_user_status also protects the last active SUPER_ADMIN'
);

select * from finish();

rollback;
