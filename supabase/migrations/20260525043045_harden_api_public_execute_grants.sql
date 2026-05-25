-- Keep trusted API schema RPCs backend-only.
-- SECURITY DEFINER functions in api mutate balances and ledger rows, so browser
-- roles must not inherit EXECUTE through the Postgres PUBLIC grant.

revoke usage on schema api from public, anon, authenticated;
grant usage on schema api to service_role;

revoke execute on all functions in schema api from public, anon, authenticated;
grant execute on all functions in schema api to service_role;

alter default privileges in schema api
  revoke execute on functions from public, anon, authenticated;

alter default privileges in schema api
  grant execute on functions to service_role;

-- Explicitly pin the two high-risk balance-credit RPCs called out by the audit.
revoke execute on function api._credit_balance(uuid, text, numeric, text, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function api.economy_credit(uuid, text, numeric, text, uuid, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function api._credit_balance(uuid, text, numeric, text, uuid, text, text, text, jsonb)
  to service_role;
grant execute on function api.economy_credit(uuid, text, numeric, text, uuid, text, text, text, jsonb)
  to service_role;
