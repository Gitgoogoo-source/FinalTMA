begin;

create table if not exists inventory.evolution_chains (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  description text,
  series_id uuid references catalog.series(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'retired')),
  sort_order integer not null default 100 check (sort_order >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table inventory.evolution_chains is
  'Operator-managed Pokemon-style evolution chains. Each active step maps one collectible template to the next collectible template.';

create table if not exists inventory.evolution_chain_steps (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references inventory.evolution_chains(id) on delete cascade,
  step_index integer not null check (step_index > 0),
  from_template_id uuid not null references catalog.collectible_templates(id) on delete restrict,
  from_form_id uuid not null references catalog.collectible_forms(id) on delete restrict,
  to_template_id uuid not null references catalog.collectible_templates(id) on delete restrict,
  to_form_id uuid not null references catalog.collectible_forms(id) on delete restrict,
  required_count integer not null default 3 check (required_count = 3),
  cost_kcoin numeric(38,0) not null check (cost_kcoin >= 0),
  success_rate_bps integer not null check (success_rate_bps >= 0 and success_rate_bps <= 10000),
  active boolean not null default true,
  evolution_rule_id uuid references inventory.evolution_rules(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, step_index),
  check (from_template_id <> to_template_id)
);

comment on table inventory.evolution_chain_steps is
  'One Pokemon-style evolution step, for example Charmander base form to Charmeleon base form. Publishing a step creates or updates inventory.evolution_rules.';

alter table inventory.evolution_rules
  add column if not exists evolution_chain_id uuid,
  add column if not exists evolution_chain_step_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'evolution_rules_evolution_chain_id_fkey'
  ) then
    alter table inventory.evolution_rules
      add constraint evolution_rules_evolution_chain_id_fkey
      foreign key (evolution_chain_id)
      references inventory.evolution_chains(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'evolution_rules_evolution_chain_step_id_fkey'
  ) then
    alter table inventory.evolution_rules
      add constraint evolution_rules_evolution_chain_step_id_fkey
      foreign key (evolution_chain_step_id)
      references inventory.evolution_chain_steps(id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists evolution_chain_steps_one_active_source
  on inventory.evolution_chain_steps (from_template_id, from_form_id)
  where active = true;

create index if not exists evolution_chain_steps_chain_idx
  on inventory.evolution_chain_steps (chain_id, step_index);

create index if not exists evolution_chain_steps_rule_idx
  on inventory.evolution_chain_steps (evolution_rule_id)
  where evolution_rule_id is not null;

create index if not exists evolution_rules_chain_idx
  on inventory.evolution_rules (evolution_chain_id, evolution_chain_step_id)
  where evolution_chain_id is not null;

create unique index if not exists evolution_rules_one_active_chain_step
  on inventory.evolution_rules (evolution_chain_step_id)
  where active = true and evolution_chain_step_id is not null;

create or replace function inventory.validate_evolution_chain_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.metadata is null or jsonb_typeof(new.metadata) <> 'object' then
    raise exception 'EVOLUTION_CHAIN_STEP_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if new.required_count <> 3 then
    raise exception 'EVOLUTION_CHAIN_REQUIRED_COUNT_UNSUPPORTED' using errcode = 'P0001';
  end if;

  if new.from_template_id = new.to_template_id then
    raise exception 'EVOLUTION_CHAIN_TARGET_TEMPLATE_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from catalog.collectible_forms f
    where f.id = new.from_form_id
      and f.template_id = new.from_template_id
  ) then
    raise exception 'EVOLUTION_CHAIN_FROM_FORM_MISMATCH' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from catalog.collectible_forms f
    where f.id = new.to_form_id
      and f.template_id = new.to_template_id
  ) then
    raise exception 'EVOLUTION_CHAIN_TO_FORM_MISMATCH' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists evolution_chain_steps_validate on inventory.evolution_chain_steps;
create trigger evolution_chain_steps_validate
before insert or update on inventory.evolution_chain_steps
for each row
execute function inventory.validate_evolution_chain_step();

drop trigger if exists evolution_chains_set_updated_at on inventory.evolution_chains;
create trigger evolution_chains_set_updated_at
before update on inventory.evolution_chains
for each row
execute function core.set_updated_at();

drop trigger if exists evolution_chain_steps_set_updated_at on inventory.evolution_chain_steps;
create trigger evolution_chain_steps_set_updated_at
before update on inventory.evolution_chain_steps
for each row
execute function core.set_updated_at();

alter table inventory.evolution_chains enable row level security;
alter table inventory.evolution_chain_steps enable row level security;

revoke all on table inventory.evolution_chains from public, anon, authenticated;
revoke all on table inventory.evolution_chain_steps from public, anon, authenticated;
grant select, insert, update, delete on table inventory.evolution_chains to service_role;
grant select, insert, update, delete on table inventory.evolution_chain_steps to service_role;

create or replace function api._evolution_chain_snapshot(
  p_chain_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'chain', to_jsonb(c),
    'steps', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.step_index asc, s.id asc)
      from inventory.evolution_chain_steps s
      where s.chain_id = c.id
    ), '[]'::jsonb)
  ))
  from inventory.evolution_chains c
  where c.id = p_chain_id;
$$;

create or replace function api.admin_upsert_evolution_chain(
  p_admin_user_id uuid,
  p_chain_id uuid default null,
  p_chain jsonb default '{}'::jsonb,
  p_steps jsonb default null,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_chain inventory.evolution_chains%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_idempotent jsonb;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'inventory.evolution_chain.upsert';
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_body jsonb := coalesce(p_chain, '{}'::jsonb);
  v_chain_id uuid;
  v_code text;
  v_display_name text;
  v_description text;
  v_series_id uuid;
  v_status text;
  v_sort_order integer;
  v_metadata jsonb;
  v_is_create boolean := false;
  v_request_hash text;
  v_step jsonb;
  v_step_id uuid;
  v_current_step_id uuid;
  v_step_index integer;
  v_from_template_id uuid;
  v_from_form_id uuid;
  v_to_template_id uuid;
  v_to_form_id uuid;
  v_required_count integer;
  v_cost_kcoin numeric(38,0);
  v_success_rate_bps integer;
  v_step_active boolean;
  v_step_metadata jsonb;
  v_kept_step_ids uuid[] := array[]::uuid[];
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['catalog:write', 'admin:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_body) <> 'object' then
    raise exception 'ADMIN_EVOLUTION_CHAIN_INVALID' using errcode = 'P0001';
  end if;

  if p_steps is not null and jsonb_typeof(p_steps) <> 'array' then
    raise exception 'ADMIN_EVOLUTION_CHAIN_STEPS_INVALID' using errcode = 'P0001';
  end if;

  v_chain_id := coalesce(p_chain_id, nullif(v_body ->> 'id', '')::uuid);
  v_code := lower(nullif(btrim(coalesce(v_body ->> 'code', '')), ''));

  if v_chain_id is not null then
    select *
    into v_chain
    from inventory.evolution_chains
    where id = v_chain_id
    for update;
  elsif v_code is not null then
    select *
    into v_chain
    from inventory.evolution_chains
    where code = v_code
    for update;
  end if;

  v_is_create := not found;

  if v_is_create then
    v_chain_id := coalesce(v_chain_id, gen_random_uuid());
    v_display_name := nullif(btrim(coalesce(v_body ->> 'display_name', v_body ->> 'displayName', '')), '');
    v_description := nullif(btrim(coalesce(v_body ->> 'description', '')), '');
    v_series_id := nullif(v_body ->> 'series_id', '')::uuid;
    v_status := coalesce(lower(nullif(btrim(coalesce(v_body ->> 'status', '')), '')), 'draft');
    v_sort_order := coalesce(nullif(v_body ->> 'sort_order', '')::integer, 100);
    v_metadata := coalesce(v_body -> 'metadata', '{}'::jsonb);
  else
    v_chain_id := v_chain.id;
    v_before := api._evolution_chain_snapshot(v_chain.id);
    v_code := case when v_body ? 'code' then lower(nullif(btrim(coalesce(v_body ->> 'code', '')), '')) else v_chain.code end;
    v_display_name := case when v_body ? 'display_name' or v_body ? 'displayName' then nullif(btrim(coalesce(v_body ->> 'display_name', v_body ->> 'displayName', '')), '') else v_chain.display_name end;
    v_description := case when v_body ? 'description' then nullif(btrim(coalesce(v_body ->> 'description', '')), '') else v_chain.description end;
    v_series_id := case when v_body ? 'series_id' then nullif(v_body ->> 'series_id', '')::uuid else v_chain.series_id end;
    v_status := case when v_body ? 'status' then lower(nullif(btrim(coalesce(v_body ->> 'status', '')), '')) else v_chain.status end;
    v_sort_order := case when v_body ? 'sort_order' then nullif(v_body ->> 'sort_order', '')::integer else v_chain.sort_order end;
    v_metadata := case when v_body ? 'metadata' then v_body -> 'metadata' else v_chain.metadata end;
  end if;

  if v_code is null or v_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
    raise exception 'ADMIN_EVOLUTION_CHAIN_CODE_INVALID' using errcode = 'P0001';
  end if;

  if v_display_name is null then
    raise exception 'ADMIN_EVOLUTION_CHAIN_NAME_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status not in ('draft', 'active', 'paused', 'retired') then
    raise exception 'ADMIN_EVOLUTION_CHAIN_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_sort_order is null or v_sort_order < 0 then
    raise exception 'ADMIN_EVOLUTION_CHAIN_SORT_INVALID' using errcode = 'P0001';
  end if;

  if v_metadata is null or jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_EVOLUTION_CHAIN_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if v_series_id is not null and not exists (select 1 from catalog.series where id = v_series_id) then
    raise exception 'ADMIN_EVOLUTION_CHAIN_SERIES_INVALID' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'chain_id', v_chain_id,
    'chain', v_body,
    'steps', p_steps,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_is_create then
    insert into inventory.evolution_chains (
      id,
      code,
      display_name,
      description,
      series_id,
      status,
      sort_order,
      metadata
    )
    values (
      v_chain_id,
      v_code,
      v_display_name,
      v_description,
      v_series_id,
      v_status,
      v_sort_order,
      v_metadata
    )
    returning * into v_chain;
  else
    update inventory.evolution_chains
    set code = v_code,
        display_name = v_display_name,
        description = v_description,
        series_id = v_series_id,
        status = v_status,
        sort_order = v_sort_order,
        metadata = v_metadata,
        updated_at = v_now
    where id = v_chain_id
    returning * into v_chain;
  end if;

  if p_steps is not null then
    update inventory.evolution_chain_steps
    set active = false,
        updated_at = v_now
    where chain_id = v_chain.id;

    for v_step in select value from jsonb_array_elements(p_steps) as step_row(value)
    loop
      if jsonb_typeof(v_step) <> 'object' then
        raise exception 'ADMIN_EVOLUTION_CHAIN_STEP_INVALID' using errcode = 'P0001';
      end if;

      v_step_id := nullif(v_step ->> 'id', '')::uuid;
      v_step_index := nullif(v_step ->> 'step_index', '')::integer;
      v_from_template_id := nullif(v_step ->> 'from_template_id', '')::uuid;
      v_from_form_id := nullif(v_step ->> 'from_form_id', '')::uuid;
      v_to_template_id := nullif(v_step ->> 'to_template_id', '')::uuid;
      v_to_form_id := nullif(v_step ->> 'to_form_id', '')::uuid;
      v_required_count := coalesce(nullif(v_step ->> 'required_count', '')::integer, 3);
      v_cost_kcoin := nullif(v_step ->> 'cost_kcoin', '')::numeric(38,0);
      v_success_rate_bps := nullif(v_step ->> 'success_rate_bps', '')::integer;
      v_step_active := coalesce((v_step ->> 'active')::boolean, true);
      v_step_metadata := coalesce(v_step -> 'metadata', '{}'::jsonb);

      if v_step_index is null or v_step_index <= 0 then
        raise exception 'ADMIN_EVOLUTION_CHAIN_STEP_INDEX_INVALID' using errcode = 'P0001';
      end if;

      if v_from_template_id is null or v_from_form_id is null or v_to_template_id is null or v_to_form_id is null then
        raise exception 'ADMIN_EVOLUTION_CHAIN_STEP_TARGET_REQUIRED' using errcode = 'P0001';
      end if;

      if v_required_count <> 3 then
        raise exception 'ADMIN_EVOLUTION_CHAIN_REQUIRED_COUNT_UNSUPPORTED' using errcode = 'P0001';
      end if;

      if v_cost_kcoin is null or v_cost_kcoin < 0 then
        raise exception 'ADMIN_EVOLUTION_CHAIN_COST_INVALID' using errcode = 'P0001';
      end if;

      if v_success_rate_bps is null or v_success_rate_bps < 0 or v_success_rate_bps > 10000 then
        raise exception 'ADMIN_EVOLUTION_CHAIN_SUCCESS_RATE_INVALID' using errcode = 'P0001';
      end if;

      if v_step_metadata is null or jsonb_typeof(v_step_metadata) <> 'object' then
        raise exception 'ADMIN_EVOLUTION_CHAIN_STEP_METADATA_INVALID' using errcode = 'P0001';
      end if;

      if v_step_id is not null then
        update inventory.evolution_chain_steps
        set step_index = v_step_index,
            from_template_id = v_from_template_id,
            from_form_id = v_from_form_id,
            to_template_id = v_to_template_id,
            to_form_id = v_to_form_id,
            required_count = v_required_count,
            cost_kcoin = v_cost_kcoin,
            success_rate_bps = v_success_rate_bps,
            active = v_step_active,
            metadata = v_step_metadata,
            updated_at = v_now
        where id = v_step_id
          and chain_id = v_chain.id
        returning id into v_current_step_id;

        if not found then
          raise exception 'ADMIN_EVOLUTION_CHAIN_STEP_NOT_FOUND' using errcode = 'P0001';
        end if;
      else
        insert into inventory.evolution_chain_steps (
          chain_id,
          step_index,
          from_template_id,
          from_form_id,
          to_template_id,
          to_form_id,
          required_count,
          cost_kcoin,
          success_rate_bps,
          active,
          metadata
        )
        values (
          v_chain.id,
          v_step_index,
          v_from_template_id,
          v_from_form_id,
          v_to_template_id,
          v_to_form_id,
          v_required_count,
          v_cost_kcoin,
          v_success_rate_bps,
          v_step_active,
          v_step_metadata
        )
        on conflict (chain_id, step_index) do update
        set from_template_id = excluded.from_template_id,
            from_form_id = excluded.from_form_id,
            to_template_id = excluded.to_template_id,
            to_form_id = excluded.to_form_id,
            required_count = excluded.required_count,
            cost_kcoin = excluded.cost_kcoin,
            success_rate_bps = excluded.success_rate_bps,
            active = excluded.active,
            metadata = excluded.metadata,
            updated_at = v_now
        returning id into v_current_step_id;
      end if;

      v_kept_step_ids := array_append(v_kept_step_ids, v_current_step_id);
    end loop;

    update inventory.evolution_chain_steps
    set active = false,
        updated_at = v_now
    where chain_id = v_chain.id
      and not (id = any(v_kept_step_ids));
  end if;

  v_after := api._evolution_chain_snapshot(v_chain.id);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'inventory.evolution_chain.upsert',
    'inventory',
    'evolution_chains',
    v_chain.id,
    coalesce(v_before, '{}'::jsonb),
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  v_response := jsonb_build_object(
    'chain_id', v_chain.id,
    'code', v_chain.code,
    'status', v_chain.status,
    'step_count', (
      select count(*)::integer
      from inventory.evolution_chain_steps s
      where s.chain_id = v_chain.id
        and s.active = true
    ),
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_publish_evolution_chain(
  p_admin_user_id uuid,
  p_chain_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_chain inventory.evolution_chains%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_idempotent jsonb;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'inventory.evolution_chain.publish';
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_request_hash text;
  v_active_step_count integer;
  v_invalid_count integer;
  v_deactivated_count integer := 0;
  v_synced_count integer := 0;
  v_rule_id uuid;
  v_rule_ids uuid[] := array[]::uuid[];
  v_step inventory.evolution_chain_steps%rowtype;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['catalog:write', 'admin:write']);

  if p_chain_id is null then
    raise exception 'ADMIN_EVOLUTION_CHAIN_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_chain
  from inventory.evolution_chains
  where id = p_chain_id
  for update;

  if not found then
    raise exception 'ADMIN_EVOLUTION_CHAIN_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_before := api._evolution_chain_snapshot(v_chain.id);

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'chain_id', p_chain_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_chain.status <> 'active' then
    raise exception 'ADMIN_EVOLUTION_CHAIN_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  perform 1
  from inventory.evolution_chain_steps s
  where s.chain_id = v_chain.id
  order by s.step_index asc, s.id asc
  for update;

  select count(*)::integer
  into v_active_step_count
  from inventory.evolution_chain_steps s
  where s.chain_id = v_chain.id
    and s.active = true;

  if v_active_step_count = 0 then
    raise exception 'ADMIN_EVOLUTION_CHAIN_STEPS_REQUIRED' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_invalid_count
  from (
    select
      s.step_index,
      row_number() over (order by s.step_index asc, s.id asc) as expected_index
    from inventory.evolution_chain_steps s
    where s.chain_id = v_chain.id
      and s.active = true
  ) ordered_steps
  where ordered_steps.step_index <> ordered_steps.expected_index;

  if v_invalid_count > 0 then
    raise exception 'ADMIN_EVOLUTION_CHAIN_STEP_INDEX_GAP' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_invalid_count
  from (
    select
      s.*,
      lag(s.to_template_id) over (order by s.step_index asc, s.id asc) as previous_to_template_id,
      lag(s.to_form_id) over (order by s.step_index asc, s.id asc) as previous_to_form_id
    from inventory.evolution_chain_steps s
    where s.chain_id = v_chain.id
      and s.active = true
  ) ordered_steps
  where ordered_steps.previous_to_template_id is not null
    and (
      ordered_steps.from_template_id <> ordered_steps.previous_to_template_id
      or ordered_steps.from_form_id <> ordered_steps.previous_to_form_id
    );

  if v_invalid_count > 0 then
    raise exception 'ADMIN_EVOLUTION_CHAIN_STEP_NOT_CONNECTED' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_invalid_count
  from inventory.evolution_chain_steps s
  join catalog.collectible_templates source_template on source_template.id = s.from_template_id
  join catalog.collectible_templates target_template on target_template.id = s.to_template_id
  where s.chain_id = v_chain.id
    and s.active = true
    and (
      source_template.release_status <> 'active'
      or target_template.release_status <> 'active'
      or source_template.evolvable = false
    );

  if v_invalid_count > 0 then
    raise exception 'ADMIN_EVOLUTION_CHAIN_TEMPLATE_NOT_PUBLISHABLE' using errcode = 'P0001';
  end if;

  update inventory.evolution_rules er
  set active = false,
      metadata = er.metadata || jsonb_build_object(
        'deactivated_by_evolution_chain_id', v_chain.id,
        'deactivated_reason', 'evolution_chain_publish',
        'deactivated_at', v_now
      ),
      updated_at = v_now
  from inventory.evolution_chain_steps s
  where s.chain_id = v_chain.id
    and s.active = false
    and s.evolution_rule_id = er.id
    and er.active = true;

  get diagnostics v_deactivated_count = row_count;

  update inventory.evolution_rules er
  set active = false,
      metadata = er.metadata || jsonb_build_object(
        'deactivated_by_evolution_chain_id', v_chain.id,
        'deactivated_reason', 'same_source_replaced_by_evolution_chain',
        'deactivated_at', v_now
      ),
      updated_at = v_now
  from inventory.evolution_chain_steps s
  where s.chain_id = v_chain.id
    and s.active = true
    and er.from_template_id = s.from_template_id
    and er.from_form_id = s.from_form_id
    and er.active = true
    and (s.evolution_rule_id is null or er.id <> s.evolution_rule_id);

  get diagnostics v_invalid_count = row_count;
  v_deactivated_count := v_deactivated_count + v_invalid_count;

  for v_step in
    select *
    from inventory.evolution_chain_steps
    where chain_id = v_chain.id
      and active = true
    order by step_index asc, id asc
  loop
    v_rule_id := null;

    if v_step.evolution_rule_id is not null then
      update inventory.evolution_rules
      set from_template_id = v_step.from_template_id,
          from_form_id = v_step.from_form_id,
          to_template_id = v_step.to_template_id,
          to_form_id = v_step.to_form_id,
          required_count = v_step.required_count,
          cost_kcoin = v_step.cost_kcoin,
          success_rate_bps = v_step.success_rate_bps,
          active = true,
          evolution_chain_id = v_chain.id,
          evolution_chain_step_id = v_step.id,
          metadata = metadata || jsonb_build_object(
            'source_type', 'evolution_chain',
            'evolution_chain_id', v_chain.id,
            'evolution_chain_step_id', v_step.id,
            'evolution_chain_code', v_chain.code,
            'published_at', v_now
          ),
          updated_at = v_now
      where id = v_step.evolution_rule_id
      returning id into v_rule_id;
    end if;

    if v_rule_id is null then
      insert into inventory.evolution_rules (
        from_template_id,
        from_form_id,
        to_template_id,
        to_form_id,
        required_count,
        cost_kcoin,
        success_rate_bps,
        active,
        evolution_chain_id,
        evolution_chain_step_id,
        metadata
      )
      values (
        v_step.from_template_id,
        v_step.from_form_id,
        v_step.to_template_id,
        v_step.to_form_id,
        v_step.required_count,
        v_step.cost_kcoin,
        v_step.success_rate_bps,
        true,
        v_chain.id,
        v_step.id,
        v_step.metadata || jsonb_build_object(
          'source_type', 'evolution_chain',
          'evolution_chain_id', v_chain.id,
          'evolution_chain_step_id', v_step.id,
          'evolution_chain_code', v_chain.code,
          'published_at', v_now
        )
      )
      returning id into v_rule_id;
    end if;

    update inventory.evolution_chain_steps
    set evolution_rule_id = v_rule_id,
        updated_at = v_now
    where id = v_step.id;

    v_rule_ids := array_append(v_rule_ids, v_rule_id);
    v_synced_count := v_synced_count + 1;
  end loop;

  v_after := api._evolution_chain_snapshot(v_chain.id) || jsonb_build_object(
    'synced_rule_ids', to_jsonb(v_rule_ids),
    'deactivated_rule_count', v_deactivated_count
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'inventory.evolution_chain.publish',
    'inventory',
    'evolution_chains',
    v_chain.id,
    coalesce(v_before, '{}'::jsonb),
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  v_response := jsonb_build_object(
    'chain_id', v_chain.id,
    'code', v_chain.code,
    'synced_rule_ids', to_jsonb(v_rule_ids),
    'synced_rule_count', v_synced_count,
    'deactivated_rule_count', v_deactivated_count,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function inventory.validate_evolution_chain_step() from public, anon, authenticated;
revoke all on function api._evolution_chain_snapshot(uuid) from public, anon, authenticated;
revoke all on function api.admin_upsert_evolution_chain(uuid, uuid, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_publish_evolution_chain(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function api.admin_upsert_evolution_chain(uuid, uuid, jsonb, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_publish_evolution_chain(uuid, uuid, text, text, jsonb) to service_role;

comment on function api.admin_upsert_evolution_chain(uuid, uuid, jsonb, jsonb, text, text, jsonb) is
  'Admin-only audited upsert for Pokemon-style evolution chains and chain steps.';

comment on function api.admin_publish_evolution_chain(uuid, uuid, text, text, jsonb) is
  'Admin-only audited publish that syncs evolution chain steps into inventory.evolution_rules used by player evolution RPCs.';

commit;
