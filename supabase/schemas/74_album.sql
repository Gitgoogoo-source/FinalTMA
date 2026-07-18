create table album.nodes (
  user_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  first_operation_id uuid,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

create index album_nodes_template_idx on album.nodes (template_id, user_id);

create table album.rewards (
  user_id uuid not null references identity.users(id) on delete cascade,
  chain_id text not null references catalog.chains(id),
  operation_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, chain_id)
);

create or replace function album.unlock_template(p_user_id uuid, p_template_id text, p_operation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  insert into album.nodes (user_id, template_id, first_operation_id)
  values (p_user_id, p_template_id, p_operation_id)
  on conflict (user_id, template_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;
