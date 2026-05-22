-- Move general-purpose Postgres extensions out of the exposed public schema.
-- Supabase advisor lint 0014 flags extensions in public because their objects
-- become part of the public API surface.

create schema if not exists extensions;

grant usage on schema extensions to public;
revoke create on schema extensions from public;

do $$
declare
  extension_name text;
begin
  foreach extension_name in array array['citext', 'btree_gin', 'pg_trgm']
  loop
    if exists (
      select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      where e.extname = extension_name
        and n.nspname = 'public'
    ) then
      execute format('alter extension %I set schema extensions', extension_name);
    end if;
  end loop;
end;
$$;
