-- Supabase security advisor cleanup:
-- These internal audit/admin/idempotency tables are service-role owned. Keep
-- RLS enabled as defense in depth, remove browser-role privileges, and add an
-- explicit restrictive deny policy so future permissive policies cannot
-- accidentally expose rows to anon/authenticated.

do $$
declare
  target record;
  policy_name text;
  column_list text;
begin
  for target in
    select *
    from (
      values
        ('economy', 'reconciliation_runs'),
        ('gacha', 'draw_audit'),
        ('ops', 'admin_audit_logs'),
        ('ops', 'admin_roles'),
        ('ops', 'admin_user_roles'),
        ('ops', 'api_rate_limits'),
        ('ops', 'feature_flags'),
        ('ops', 'idempotency_keys'),
        ('ops', 'risk_events'),
        ('ops', 'system_settings'),
        ('payments', 'telegram_webhook_events')
    ) as t(schema_name, table_name)
  loop
    policy_name := format('%s_%s_deny_client_access', target.schema_name, target.table_name);

    execute format(
      'revoke all privileges on table %I.%I from public, anon, authenticated',
      target.schema_name,
      target.table_name
    );

    select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into column_list
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = target.schema_name
      and c.relname = target.table_name
      and a.attnum > 0
      and not a.attisdropped;

    if column_list is not null then
      execute format(
        'revoke all privileges (%s) on table %I.%I from public, anon, authenticated',
        column_list,
        target.schema_name,
        target.table_name
      );
    end if;

    execute format(
      'alter table %I.%I enable row level security',
      target.schema_name,
      target.table_name
    );

    execute format(
      'drop policy if exists %I on %I.%I',
      policy_name,
      target.schema_name,
      target.table_name
    );

    execute format(
      'create policy %I on %I.%I as restrictive for all to anon, authenticated using (false) with check (false)',
      policy_name,
      target.schema_name,
      target.table_name
    );
  end loop;
end;
$$;
