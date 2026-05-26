-- Security advisor cleanup: these internal tables are backend/service-role
-- owned. Keep RLS enabled, revoke direct browser-role privileges, and add a
-- restrictive deny policy so accidental future permissive policies cannot
-- expose rows to anon/authenticated.
DO $$
DECLARE
  target record;
  policy_name text;
  column_list text;
BEGIN
  FOR target IN
    SELECT *
    FROM (
      VALUES
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
    ) AS t(schema_name, table_name)
  LOOP
    policy_name := format('%s_%s_deny_client_access', target.schema_name, target.table_name);

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM public, anon, authenticated',
      target.schema_name,
      target.table_name
    );

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO column_list
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = target.schema_name
      AND c.relname = target.table_name
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM public, anon, authenticated',
        column_list,
        target.schema_name,
        target.table_name
      );
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      target.schema_name,
      target.table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_name,
      target.schema_name,
      target.table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      policy_name,
      target.schema_name,
      target.table_name
    );
  END LOOP;
END;
$$;
