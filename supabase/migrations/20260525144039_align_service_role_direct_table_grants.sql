-- Align local migration-defined grants with the live project.
-- Vercel API code uses the service-role client for internal direct reads/writes
-- against core sessions/users and ops admin/risk tables after its own API auth
-- checks. These tables are not exposed to browser clients.

grant usage on schema core, ops to service_role;

grant all privileges on all tables in schema core, ops to service_role;
grant usage, select, update on all sequences in schema core, ops to service_role;

alter default privileges in schema core grant all privileges on tables to service_role;
alter default privileges in schema ops grant all privileges on tables to service_role;
alter default privileges in schema core grant usage, select, update on sequences to service_role;
alter default privileges in schema ops grant usage, select, update on sequences to service_role;
