-- Phase 6 audit correction RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(14);

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb
) on commit drop;

create temp table _errors (
  key text primary key,
  message text
) on commit drop;

with actor as (
  insert into ops.admin_users (id, email, display_name, status, metadata)
  values (
    '62000000-0000-4000-8000-000000000001',
    'phase6-audit-correction@example.test',
    'Phase 6 Audit Correction Actor',
    'active',
    '{"test":true}'::jsonb
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id)
select 'actor', id from actor;

insert into _ids (key, payload)
values (
  'original_audit',
  api.admin_write_audit_log(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_action => 'phase6.test_original',
    p_target_schema => 'ops',
    p_target_table => 'feature_flags',
    p_target_id => null,
    p_before_state => '{"old":true}'::jsonb,
    p_after_state => '{"new":true}'::jsonb,
    p_ip_hash => 'original-ip',
    p_user_agent => 'original-ua',
    p_reason => 'original audit for correction test'
  )
);

insert into _ids (key, id)
values (
  'original_audit_id',
  ((select payload ->> 'audit_log_id' from _ids where key = 'original_audit'))::uuid
);

select ok(
  to_regprocedure('api.admin_append_audit_correction(uuid,uuid,text,text,jsonb)') is not null,
  'admin_append_audit_correction RPC exists'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = 'admin_append_audit_correction'
      and (
        not p.prosecdef
        or not (p.proconfig @> array['search_path=""'])
      )
  ),
  'admin_append_audit_correction is security definer with fixed empty search_path'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.admin_append_audit_correction(uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'public',
      'api.admin_append_audit_correction(uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'api.admin_append_audit_correction(uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'api.admin_append_audit_correction(uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    ),
  'admin_append_audit_correction is service_role only'
);

select ok(
  not has_table_privilege('anon', 'ops.admin_audit_logs', 'INSERT')
    and not has_table_privilege('anon', 'ops.admin_audit_logs', 'UPDATE')
    and not has_table_privilege('anon', 'ops.admin_audit_logs', 'DELETE')
    and not has_table_privilege('authenticated', 'ops.admin_audit_logs', 'INSERT')
    and not has_table_privilege('authenticated', 'ops.admin_audit_logs', 'UPDATE')
    and not has_table_privilege('authenticated', 'ops.admin_audit_logs', 'DELETE'),
  'anon/authenticated cannot directly write admin audit logs'
);

insert into _ids (key, payload)
values (
  'correction',
  api.admin_append_audit_correction(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_audit_log_id => (select id from _ids where key = 'original_audit_id'),
    p_correction => 'Correct the operator explanation; no original audit fields are changed.',
    p_reason => 'append correction for phase 6 test',
    p_request_context => jsonb_build_object(
      'request_id', 'phase6-audit-correction-request',
      'ip_hash', 'correction-ip',
      'user_agent_hash', 'correction-ua'
    )
  )
);

insert into _ids (key, id)
values (
  'correction_audit_id',
  ((select payload ->> 'audit_log_id' from _ids where key = 'correction'))::uuid
);

select is(
  (select payload ->> 'action' from _ids where key = 'correction'),
  'audit.correction',
  'correction RPC returns audit.correction action'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'audit.correction'
      and target_schema = 'ops'
      and target_table = 'admin_audit_logs'
      and target_id = (select id from _ids where key = 'original_audit_id')
  ),
  1,
  'correction is appended as one audit log row targeting the original audit log'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where id = (select id from _ids where key = 'correction_audit_id')
      and admin_user_id = (select id from _ids where key = 'actor')
      and reason = 'append correction for phase 6 test'
      and before_state -> 'corrected_audit_log' ->> 'id' =
        (select id::text from _ids where key = 'original_audit_id')
      and before_state -> 'corrected_audit_log' ->> 'action' = 'phase6.test_original'
      and after_state -> 'correction' ->> 'note' =
        'Correct the operator explanation; no original audit fields are changed.'
      and after_state -> 'request_context' ->> 'request_id' =
        'phase6-audit-correction-request'
  ),
  'correction row stores correction note and original audit summary'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where id = (select id from _ids where key = 'correction_audit_id')
      and ip_hash = 'correction-ip'
      and user_agent = 'correction-ua'
  ),
  'correction row stores request context hashes'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where id = (select id from _ids where key = 'original_audit_id')
      and action = 'phase6.test_original'
      and before_state = '{"old":true}'::jsonb
      and after_state = '{"new":true}'::jsonb
      and reason = 'original audit for correction test'
  ),
  'correction does not overwrite original audit before_state, after_state or reason'
);

do $$
begin
  perform api.admin_append_audit_correction(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_audit_log_id => '62000000-0000-4000-8000-000000009999',
    p_correction => 'missing target correction',
    p_reason => 'missing target reason',
    p_request_context => '{}'::jsonb
  );
  insert into _errors (key, message) values ('missing_target', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('missing_target', sqlerrm);
end;
$$;

select is(
  (select message from _errors where key = 'missing_target'),
  'AUDIT_CORRECTION_TARGET_NOT_FOUND',
  'correction rejects missing audit log target'
);

do $$
begin
  perform api.admin_append_audit_correction(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_audit_log_id => (select id from _ids where key = 'original_audit_id'),
    p_correction => ' ',
    p_reason => 'blank correction test',
    p_request_context => '{}'::jsonb
  );
  insert into _errors (key, message) values ('blank_correction', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('blank_correction', sqlerrm);
end;
$$;

select is(
  (select message from _errors where key = 'blank_correction'),
  'AUDIT_CORRECTION_REQUIRED',
  'correction rejects blank correction note'
);

do $$
begin
  perform api.admin_append_audit_correction(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_audit_log_id => (select id from _ids where key = 'original_audit_id'),
    p_correction => 'blank reason correction',
    p_reason => ' ',
    p_request_context => '{}'::jsonb
  );
  insert into _errors (key, message) values ('blank_reason', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('blank_reason', sqlerrm);
end;
$$;

select is(
  (select message from _errors where key = 'blank_reason'),
  'AUDIT_CORRECTION_REASON_REQUIRED',
  'correction rejects blank reason'
);

do $$
begin
  perform api.admin_append_audit_correction(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_audit_log_id => (select id from _ids where key = 'correction_audit_id'),
    p_correction => 'nested correction is not allowed',
    p_reason => 'nested correction test',
    p_request_context => '{}'::jsonb
  );
  insert into _errors (key, message) values ('nested_correction', 'NO_ERROR');
exception
  when others then
    insert into _errors (key, message) values ('nested_correction', sqlerrm);
end;
$$;

select is(
  (select message from _errors where key = 'nested_correction'),
  'AUDIT_CORRECTION_TARGET_INVALID',
  'correction rejects correction rows as targets'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'admin')
      and p.proname ~* '(update|delete).*audit'
  ),
  'no update/delete audit-log RPC entrypoint exists'
);

select * from finish();

rollback;
