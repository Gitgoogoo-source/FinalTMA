create table admin.database_identity (
  singleton boolean primary key default true check (singleton),
  environment text not null check (environment in ('local', 'real_development', 'production')),
  project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
  bound_at timestamptz not null default now(),
  bound_by text not null
);

create table admin.environment_controls (
  capability text primary key check (capability = 'battle_acceptance_fixture'),
  environment text not null check (environment in ('local', 'real_development', 'production')),
  project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
  enabled boolean not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

create table admin.fixture_commands (
  request_id uuid primary key,
  fixture_version text not null check (fixture_version = 'battle-v1'),
  ordered_user_ids uuid[] not null check (
    array_ndims(ordered_user_ids) = 1
    and array_lower(ordered_user_ids, 1) = 1
    and cardinality(ordered_user_ids) = 4
  ),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  run_key text not null unique check (run_key ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (status in ('running', 'succeeded')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table admin.fixture_user_bindings (
  role text primary key check (role in ('A', 'B', 'C', 'D')),
  fixture_version text not null check (fixture_version = 'battle-v1'),
  user_id uuid not null unique references identity.users(id) on delete cascade,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  bound_at timestamptz not null default now()
);

create table admin.fixture_run_audit (
  run_key text primary key check (run_key ~ '^[0-9a-f]{64}$'),
  fixture_version text not null check (fixture_version = 'battle-v1'),
  fixture_definition_hash text not null check (fixture_definition_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  ordered_user_ids uuid[] not null check (
    array_ndims(ordered_user_ids) = 1
    and array_lower(ordered_user_ids, 1) = 1
    and cardinality(ordered_user_ids) = 4
  ),
  before_aggregate jsonb not null,
  after_aggregate jsonb not null,
  result text not null check (result in ('applied', 'noop')),
  executed_at timestamptz not null default now(),
  executed_by text not null
);

create table admin.fixture_asset_ownership (
  user_id uuid not null references identity.users(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('KCOIN', 'PET')),
  asset_key text not null,
  fixture_version text not null check (fixture_version = 'battle-v1'),
  available_quantity bigint not null default 0 check (available_quantity >= 0),
  locked_quantity bigint not null default 0 check (locked_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, asset_kind, asset_key),
  check (
    (asset_kind = 'KCOIN' and asset_key = 'KCOIN')
    or (asset_kind = 'PET' and asset_key ~ '^PET-[NAT]-[0-9]{3}-[123]$')
  ),
  check (asset_kind = 'KCOIN' or locked_quantity = 0)
);

create table admin.fixture_asset_changes (
  id bigint generated always as identity primary key,
  run_key text not null references admin.fixture_run_audit(run_key) on delete restrict,
  role text not null check (role in ('A', 'B', 'C', 'D')),
  user_id uuid not null references identity.users(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('KCOIN', 'PET')),
  asset_key text not null,
  available_delta bigint not null,
  locked_delta bigint not null default 0,
  aggregate_before jsonb not null,
  aggregate_after jsonb not null,
  fixture_owned_before jsonb not null,
  fixture_owned_after jsonb not null,
  created_at timestamptz not null default now(),
  check (available_delta <> 0 or locked_delta <> 0)
);

create index fixture_commands_payload_idx on admin.fixture_commands (payload_hash, created_at);
create index fixture_run_audit_payload_idx on admin.fixture_run_audit (payload_hash, executed_at);
create index fixture_asset_changes_run_idx on admin.fixture_asset_changes (run_key, id);
create index fixture_asset_changes_user_idx on admin.fixture_asset_changes (user_id, id);

create or replace function admin.assert_owner_call()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner oid;
begin
  select n.nspowner into v_owner
  from pg_catalog.pg_namespace n
  where n.nspname = 'admin';
  if v_owner is null or not pg_catalog.pg_has_role(current_user, v_owner, 'USAGE') then
    raise exception using
      errcode = '42501',
      message = 'BATTLE_FIXTURE_OWNER_REQUIRED';
  end if;
end;
$$;

create or replace function admin.bind_database_identity(
  p_environment text,
  p_project_ref text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_identity admin.database_identity%rowtype;
begin
  perform admin.assert_owner_call();
  if p_environment not in ('local', 'real_development', 'production')
    or p_project_ref !~ '^[a-z]{20}$'
  then
    raise exception using
      errcode = '22023',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_INVALID';
  end if;

  insert into admin.database_identity (
    singleton, environment, project_ref, bound_by
  ) values (
    true, p_environment, p_project_ref, current_user
  )
  on conflict (singleton) do nothing
  returning * into v_identity;
  if v_identity.singleton is null then
    select * into v_identity
    from admin.database_identity
    where singleton
    for update;
    if v_identity.environment <> p_environment or v_identity.project_ref <> p_project_ref then
      raise exception using
        errcode = 'P0001',
        message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_IMMUTABLE';
    end if;
  end if;

  return jsonb_build_object(
    'environment', v_identity.environment,
    'project_ref', v_identity.project_ref,
    'bound_at', v_identity.bound_at
  );
end;
$$;

create or replace function admin.configure_battle_fixture_gate(
  p_environment text,
  p_project_ref text,
  p_enabled boolean,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_identity admin.database_identity%rowtype;
begin
  perform admin.assert_owner_call();
  if p_environment not in ('local', 'real_development', 'production')
    or p_project_ref !~ '^[a-z]{20}$'
    or p_enabled is null
    or p_expires_at is null
  then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_GATE_INVALID';
  end if;
  select * into v_identity
  from admin.database_identity
  where singleton
  for update;
  if v_identity.singleton is null then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_MISSING';
  end if;
  if p_environment <> v_identity.environment or p_project_ref <> v_identity.project_ref then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_MISMATCH';
  end if;
  if p_enabled and p_environment <> 'real_development' then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_ENVIRONMENT_INVALID';
  end if;
  if p_enabled and (p_expires_at <= now() or p_expires_at > now() + interval '24 hours') then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_EXPIRY_INVALID';
  end if;

  insert into admin.environment_controls (
    capability, environment, project_ref, enabled, expires_at, updated_at, updated_by
  ) values (
    'battle_acceptance_fixture', p_environment, p_project_ref, p_enabled,
    p_expires_at, now(), current_user
  )
  on conflict (capability) do update
  set environment = excluded.environment,
      project_ref = excluded.project_ref,
      enabled = excluded.enabled,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  return jsonb_build_object(
    'capability', 'battle_acceptance_fixture',
    'environment', p_environment,
    'project_ref', p_project_ref,
    'enabled', p_enabled,
    'expires_at', p_expires_at
  );
end;
$$;

create or replace function admin.battle_fixture_definition()
returns table (
  fixture_version text,
  role text,
  target_kcoin bigint,
  template_id text,
  target_quantity bigint,
  element text,
  skill_slots text[]
)
language sql
immutable
security invoker
set search_path = ''
as $$
  select *
  from (values
    ('battle-v1', 'A', 500::bigint, 'PET-N-001-1', 2::bigint, 'fire', array['S01','S04']::text[]),
    ('battle-v1', 'A', 500::bigint, 'PET-N-033-2', 1::bigint, 'grass', array['S05','S08','S03']::text[]),
    ('battle-v1', 'A', 500::bigint, 'PET-A-020-3', 1::bigint, 'earth', array['S04','S02','S06','S10']::text[]),
    ('battle-v1', 'B', 500::bigint, 'PET-N-003-2', 2::bigint, 'grass', array['S01','S04','S06']::text[]),
    ('battle-v1', 'B', 500::bigint, 'PET-N-039-3', 1::bigint, 'earth', array['S05','S08','S03','S07']::text[]),
    ('battle-v1', 'B', 500::bigint, 'PET-A-018-1', 1::bigint, 'lightning', array['S04','S02']::text[]),
    ('battle-v1', 'C', 500::bigint, 'PET-N-004-3', 2::bigint, 'earth', array['S01','S04','S06','S09']::text[]),
    ('battle-v1', 'C', 500::bigint, 'PET-N-040-1', 1::bigint, 'lightning', array['S05','S08']::text[]),
    ('battle-v1', 'C', 500::bigint, 'PET-A-019-2', 1::bigint, 'water', array['S04','S02','S06']::text[]),
    ('battle-v1', 'D', 100::bigint, 'PET-N-005-1', 2::bigint, 'lightning', array['S01','S04']::text[]),
    ('battle-v1', 'D', 100::bigint, 'PET-N-036-2', 1::bigint, 'water', array['S05','S08','S03']::text[]),
    ('battle-v1', 'D', 100::bigint, 'PET-A-016-3', 1::bigint, 'fire', array['S04','S02','S06','S10']::text[])
  ) definition(
    fixture_version, role, target_kcoin, template_id, target_quantity, element, skill_slots
  )
$$;

create or replace function admin.battle_fixture_definition_hash()
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'fixture_version', 'battle-v1',
          'catalog_version', 'v1',
          'catalog_checksum', 'ec8d89aec0a700bfb504285401bf6327ed2a4c48c94d4d8bb92559bdae2ee61e',
          'battle_checksum', '8e9a250af9df2f44d45846b0fe5c6fbb4e2f26d74e07146e87ce84a86b8141c6',
          'matrix', jsonb_agg(
            jsonb_build_object(
              'role', d.role,
              'target_kcoin', d.target_kcoin,
              'template_id', d.template_id,
              'target_quantity', d.target_quantity,
              'element', d.element,
              'skill_slots', to_jsonb(d.skill_slots)
            )
            order by d.role, d.template_id
          )
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from admin.battle_fixture_definition() d
$$;

create or replace function admin.track_fixture_balance_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available_owned bigint;
  v_locked_owned bigint;
  v_available_to_locked bigint := 0;
  v_locked_to_available bigint := 0;
  v_available_consumed bigint := 0;
  v_locked_consumed bigint := 0;
begin
  if old.currency <> 'KCOIN' then
    return new;
  end if;
  select available_quantity, locked_quantity
  into v_available_owned, v_locked_owned
  from admin.fixture_asset_ownership
  where user_id = old.user_id and asset_kind = 'KCOIN' and asset_key = 'KCOIN'
  for update;
  if not found then
    return new;
  end if;

  if new.available < old.available and new.locked > old.locked then
    v_available_to_locked := least(
      old.available - new.available,
      new.locked - old.locked,
      v_available_owned
    );
  elsif new.locked < old.locked and new.available > old.available then
    v_locked_to_available := least(
      old.locked - new.locked,
      new.available - old.available,
      v_locked_owned
    );
  end if;

  v_available_owned := v_available_owned - v_available_to_locked + v_locked_to_available;
  v_locked_owned := v_locked_owned + v_available_to_locked - v_locked_to_available;
  v_available_consumed := least(
    greatest(old.available - new.available - v_available_to_locked, 0),
    v_available_owned
  );
  v_locked_consumed := least(
    greatest(old.locked - new.locked - v_locked_to_available, 0),
    v_locked_owned
  );

  update admin.fixture_asset_ownership
  set available_quantity = v_available_owned - v_available_consumed,
      locked_quantity = v_locked_owned - v_locked_consumed,
      updated_at = now()
  where user_id = old.user_id and asset_kind = 'KCOIN' and asset_key = 'KCOIN';
  return new;
end;
$$;

create trigger fixture_balance_ownership_trigger
after update of available, locked on economy.balances
for each row
execute function admin.track_fixture_balance_ownership();

create or replace function admin.track_fixture_holding_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quantity < old.quantity then
    update admin.fixture_asset_ownership
    set available_quantity = greatest(
          available_quantity - (old.quantity - new.quantity),
          0
        ),
        updated_at = now()
    where user_id = old.user_id
      and asset_kind = 'PET'
      and asset_key = old.template_id;
  end if;
  return new;
end;
$$;

create trigger fixture_holding_ownership_trigger
after update of quantity on inventory.holdings
for each row
execute function admin.track_fixture_holding_ownership();

create or replace function admin.battle_fixture_state(
  p_fixture_version text,
  p_ordered_user_ids uuid[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with role_users(role, user_id) as (
    values
      ('A', p_ordered_user_ids[1]),
      ('B', p_ordered_user_ids[2]),
      ('C', p_ordered_user_ids[3]),
      ('D', p_ordered_user_ids[4])
  ),
  fixture_quantities as materialized (
    select quantity.*
    from inventory.quantity_read_model quantity
    where quantity.user_id = any(p_ordered_user_ids)
  ),
  role_targets as (
    select d.role, max(d.target_kcoin) as target_kcoin
    from admin.battle_fixture_definition() d
    where d.fixture_version = p_fixture_version
    group by d.role
  ),
  pet_state as (
    select
      ru.role,
      jsonb_agg(
        jsonb_build_object(
          'template_id', d.template_id,
          'target_quantity', d.target_quantity,
          'fixture_owned_quantity', coalesce(o.available_quantity, 0),
          'aggregate_quantity', coalesce(quantity.total, 0),
          'active_reserved', coalesce(
            quantity.listed + quantity.expedition + quantity.minting + quantity.battling,
            0
          ),
          'available_quantity', coalesce(quantity.available, 0)
        )
        order by d.template_id
      ) as pets,
      bool_and(
        coalesce(o.available_quantity, 0) = d.target_quantity
        and coalesce(o.locked_quantity, 0) = 0
        and coalesce(quantity.total, 0) >= coalesce(o.available_quantity, 0)
      ) as pets_aligned
    from role_users ru
    join admin.battle_fixture_definition() d
      on d.fixture_version = p_fixture_version and d.role = ru.role
    left join admin.fixture_asset_ownership o
      on o.user_id = ru.user_id
      and o.asset_kind = 'PET'
      and o.asset_key = d.template_id
      and o.fixture_version = p_fixture_version
    left join fixture_quantities quantity
      on quantity.user_id = ru.user_id and quantity.template_id = d.template_id
    group by ru.role
  ),
  role_state as (
    select
      ru.role,
      ru.user_id,
      rt.target_kcoin,
      coalesce(ko.available_quantity, 0) as fixture_kcoin_available,
      coalesce(ko.locked_quantity, 0) as fixture_kcoin_locked,
      coalesce(b.available, 0) as aggregate_kcoin_available,
      coalesce(b.locked, 0) as aggregate_kcoin_locked,
      ps.pets,
      fb.user_id is not null as binding_aligned,
      (
        fb.user_id is not null
        and coalesce(ko.available_quantity, 0) = rt.target_kcoin
        and coalesce(ko.locked_quantity, 0) = 0
        and coalesce(b.available, 0) >= coalesce(ko.available_quantity, 0)
        and ps.pets_aligned
      ) as aligned
    from role_users ru
    join role_targets rt on rt.role = ru.role
    join pet_state ps on ps.role = ru.role
    left join admin.fixture_asset_ownership ko
      on ko.user_id = ru.user_id
      and ko.asset_kind = 'KCOIN'
      and ko.asset_key = 'KCOIN'
      and ko.fixture_version = p_fixture_version
    left join economy.balances b
      on b.user_id = ru.user_id and b.currency = 'KCOIN'
    left join admin.fixture_user_bindings fb
      on fb.role = ru.role
      and fb.fixture_version = p_fixture_version
      and fb.user_id = ru.user_id
  )
  select jsonb_build_object(
    'fixture_version', p_fixture_version,
    'fixture_definition_hash', admin.battle_fixture_definition_hash(),
    'aligned', bool_and(aligned),
    'roles', jsonb_agg(
      jsonb_build_object(
        'role', role,
        'user_id', user_id,
        'target_kcoin', target_kcoin,
        'fixture_owned_kcoin', jsonb_build_object(
          'available', fixture_kcoin_available,
          'locked', fixture_kcoin_locked
        ),
        'aggregate_kcoin', jsonb_build_object(
          'available', aggregate_kcoin_available,
          'locked', aggregate_kcoin_locked
        ),
        'binding_aligned', binding_aligned,
        'pets', pets,
        'aligned', aligned
      )
      order by role
    )
  )
  from role_state
$$;

create or replace function admin.battle_fixture_status(
  p_fixture_version text,
  p_ordered_user_ids uuid[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_payload_hash text;
  v_state jsonb;
  v_last_run jsonb;
begin
  perform admin.assert_owner_call();
  if p_fixture_version <> 'battle-v1'
    or array_ndims(p_ordered_user_ids) <> 1
    or array_lower(p_ordered_user_ids, 1) <> 1
    or cardinality(p_ordered_user_ids) <> 4
    or exists (
      select 1
      from unnest(p_ordered_user_ids) u
      group by u
      having count(*) > 1
    )
  then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_PAYLOAD_INVALID';
  end if;

  v_payload := jsonb_build_object(
    'fixture_version', p_fixture_version,
    'roles', jsonb_build_array(
      jsonb_build_object('role', 'A', 'user_id', p_ordered_user_ids[1]),
      jsonb_build_object('role', 'B', 'user_id', p_ordered_user_ids[2]),
      jsonb_build_object('role', 'C', 'user_id', p_ordered_user_ids[3]),
      jsonb_build_object('role', 'D', 'user_id', p_ordered_user_ids[4])
    )
  );
  v_payload_hash := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_state := admin.battle_fixture_state(p_fixture_version, p_ordered_user_ids);
  select jsonb_build_object(
    'run_key', a.run_key,
    'payload_hash', a.payload_hash,
    'result', a.result,
    'executed_at', a.executed_at
  )
  into v_last_run
  from admin.fixture_run_audit a
  where a.payload_hash = v_payload_hash
  order by a.executed_at desc
  limit 1;
  return v_state || jsonb_build_object(
    'payload_hash', v_payload_hash,
    'last_run', v_last_run
  );
end;
$$;

create or replace function admin.reconcile_battle_fixture(
  p_fixture_version text,
  p_request_id uuid,
  p_ordered_user_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gate admin.environment_controls%rowtype;
  v_identity admin.database_identity%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_definition_hash text;
  v_run_key text;
  v_command admin.fixture_commands%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_role_user record;
  v_asset record;
  v_target bigint;
  v_current_available bigint;
  v_current_locked bigint;
  v_owned_available bigint;
  v_owned_locked bigint;
  v_delta bigint;
  v_change_count integer := 0;
  v_catalog_checksum text;
  v_battle_checksum text;
  v_matrix_count integer;
  v_matrix_element_count integer;
  v_matrix_skill_slot_count integer;
  v_binding_count integer;
  v_binding_matches integer;
  v_binding_changed boolean;
  v_previous_user_ids uuid[];
begin
  perform admin.assert_owner_call();
  if p_fixture_version <> 'battle-v1' or p_request_id is null
    or array_ndims(p_ordered_user_ids) <> 1
    or array_lower(p_ordered_user_ids, 1) <> 1
    or cardinality(p_ordered_user_ids) <> 4
    or exists (
      select 1
      from unnest(p_ordered_user_ids) u
      group by u
      having count(*) > 1
    )
  then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_PAYLOAD_INVALID';
  end if;

  v_payload := jsonb_build_object(
    'fixture_version', p_fixture_version,
    'roles', jsonb_build_array(
      jsonb_build_object('role', 'A', 'user_id', p_ordered_user_ids[1]),
      jsonb_build_object('role', 'B', 'user_id', p_ordered_user_ids[2]),
      jsonb_build_object('role', 'C', 'user_id', p_ordered_user_ids[3]),
      jsonb_build_object('role', 'D', 'user_id', p_ordered_user_ids[4])
    )
  );
  v_payload_hash := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_definition_hash := admin.battle_fixture_definition_hash();
  v_run_key := encode(
    extensions.digest(
      convert_to('battle-acceptance-fixture-run|' || p_request_id::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into admin.fixture_commands (
    request_id, fixture_version, ordered_user_ids, payload_hash, run_key
  ) values (
    p_request_id, p_fixture_version, p_ordered_user_ids, v_payload_hash, v_run_key
  )
  on conflict (request_id) do nothing;
  select * into v_command
  from admin.fixture_commands
  where request_id = p_request_id
  for update;
  if v_command.payload_hash <> v_payload_hash then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.status = 'succeeded' then
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_gate
  from admin.environment_controls
  where capability = 'battle_acceptance_fixture'
  for update;
  if v_gate.capability is null or not v_gate.enabled then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_GATE_DISABLED';
  end if;
  select * into v_identity
  from admin.database_identity
  where singleton
  for update;
  if v_identity.singleton is null then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_MISSING';
  end if;
  if v_gate.environment <> v_identity.environment
    or v_gate.project_ref <> v_identity.project_ref
  then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_MISMATCH';
  end if;
  if v_gate.environment <> 'real_development'
    or v_identity.environment <> 'real_development'
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_ENVIRONMENT_MISMATCH';
  end if;
  if v_gate.project_ref !~ '^[a-z]{20}$' then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_PROJECT_REF_INVALID';
  end if;
  if v_gate.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_GATE_EXPIRED';
  end if;

  lock table
    identity.users,
    operations.operations,
    operations.invariant_violations,
    economy.balances,
    economy.ledger,
    inventory.holdings,
    inventory.reservations,
    battle.rooms,
    battle.participants,
    battle.stakes,
    battle.outbox,
    market.listings,
    expedition.expeditions,
    payments.orders,
    onchain.mints
  in share row exclusive mode;

  if exists (
      select 1 from battle.rooms
      where status in (
        'preparing_share', 'waiting', 'lobby_waiting', 'lobby_countdown',
        'active_turn'
      )
    )
    or exists (
      select 1 from battle.participants
      where status in ('preparing_share', 'waiting', 'lobby', 'active')
    )
    or exists (select 1 from battle.stakes where status = 'locked')
    or exists (
      select 1 from inventory.reservations
      where status = 'active'
    )
    or exists (
      select 1 from battle.outbox
      where status in ('pending', 'leased')
    )
    or exists (
      select 1 from operations.invariant_violations
      where resolved_at is null
    )
    or exists (
      select 1 from market.listings
      where status = 'active' and remaining > 0
    )
    or exists (
      select 1 from expedition.expeditions
      where status in ('running', 'claimable')
    )
    or exists (
      select 1 from payments.orders
      where status in ('pending', 'processing', 'paid', 'payment_identity_conflict')
    )
    or exists (
      select 1 from onchain.mints
      where status in ('reserved', 'submitted', 'unknown')
    )
    or exists (
      select 1 from operations.operations
      where status in ('pending', 'unknown')
    )
    or exists (
      select 1 from economy.balances
      where locked <> 0
    )
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_BUSINESS_STATE_ACTIVE';
  end if;

  select product_checksum into v_catalog_checksum
  from catalog.versions where id = 'v1';
  select checksum into v_battle_checksum
  from battle.rulesets where id = 'battle-v1' and status = 'active';
  select
    count(*),
    count(distinct d.element),
    count(distinct skill_slot)
  into v_matrix_count, v_matrix_element_count, v_matrix_skill_slot_count
  from admin.battle_fixture_definition() d
  cross join lateral unnest(d.skill_slots) skill_slot
  where d.fixture_version = p_fixture_version;
  if v_catalog_checksum <> 'ec8d89aec0a700bfb504285401bf6327ed2a4c48c94d4d8bb92559bdae2ee61e'
    or v_battle_checksum <> '8e9a250af9df2f44d45846b0fe5c6fbb4e2f26d74e07146e87ce84a86b8141c6'
    or not battle.rules_complete('battle-v1')
    or v_matrix_count <> 36
    or v_matrix_element_count <> 5
    or v_matrix_skill_slot_count <> 10
    or exists (
      select 1
      from admin.battle_fixture_definition() d
      left join catalog.templates t on t.id = d.template_id and t.catalog_version = 'v1'
      left join battle.template_configs c
        on c.ruleset_id = d.fixture_version and c.template_id = d.template_id
      where d.fixture_version = p_fixture_version
        and (
          t.id is null
          or c.template_id is null
          or c.element <> d.element
          or array_remove(
            array[c.skill_1_id, c.skill_2_id, c.skill_3_id, c.skill_4_id],
            null
          ) <> (
            select array_agg(s.id order by x.ordinality)
            from unnest(d.skill_slots) with ordinality x(slot_id, ordinality)
            join battle.skills s
              on s.ruleset_id = d.fixture_version
              and s.element = d.element
              and s.slot_id = x.slot_id
          )
        )
    )
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_PRODUCT_DATA_DRIFT';
  end if;

  if (
    select count(*) = 4 and bool_and(status = 'normal')
    from identity.users
    where id = any(p_ordered_user_ids)
  ) is not true then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_USERS_INVALID';
  end if;
  perform 1
  from identity.users
  where id = any(p_ordered_user_ids)
  order by id
  for update;

  select count(*) into v_binding_count
  from admin.fixture_user_bindings
  where fixture_version = p_fixture_version;
  select array_agg(user_id order by role) into v_previous_user_ids
  from admin.fixture_user_bindings
  where fixture_version = p_fixture_version;
  if v_binding_count not in (0, 4)
    or exists (
      select 1
      from admin.fixture_asset_ownership o
      left join admin.fixture_user_bindings b
        on b.fixture_version = o.fixture_version and b.user_id = o.user_id
      where b.user_id is null
        and (o.available_quantity <> 0 or o.locked_quantity <> 0)
    )
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
  end if;
  select count(*) into v_binding_matches
  from admin.fixture_user_bindings b
  join (values
    ('A', p_ordered_user_ids[1]),
    ('B', p_ordered_user_ids[2]),
    ('C', p_ordered_user_ids[3]),
    ('D', p_ordered_user_ids[4])
  ) requested(role, user_id)
    on requested.role = b.role and requested.user_id = b.user_id
  where b.fixture_version = p_fixture_version;
  v_binding_changed := v_binding_count = 0 or v_binding_matches <> 4;

  v_before := jsonb_build_object(
    'requested_binding',
    admin.battle_fixture_state(p_fixture_version, p_ordered_user_ids),
    'previous_binding',
    case
      when v_binding_count = 4
        then admin.battle_fixture_state(p_fixture_version, v_previous_user_ids)
      else null
    end
  );
  insert into admin.fixture_run_audit (
    run_key, fixture_version, fixture_definition_hash, payload_hash,
    ordered_user_ids, before_aggregate, after_aggregate, result, executed_by
  ) values (
    v_run_key, p_fixture_version, v_definition_hash, v_payload_hash,
    p_ordered_user_ids, v_before, '{}'::jsonb, 'noop', current_user
  );

  for v_role_user in
    select *
    from (values
      ('A', p_ordered_user_ids[1]),
      ('B', p_ordered_user_ids[2]),
      ('C', p_ordered_user_ids[3]),
      ('D', p_ordered_user_ids[4])
    ) role_user(role, user_id)
    order by user_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('battle-fixture-user:' || v_role_user.user_id::text, 0)
    );
  end loop;

  if v_binding_count = 4 and v_binding_changed then
    for v_role_user in
      select role, user_id
      from admin.fixture_user_bindings
      where fixture_version = p_fixture_version
      order by role
    loop
      v_current_available := null;
      select available, locked
      into v_current_available, v_current_locked
      from economy.balances
      where user_id = v_role_user.user_id and currency = 'KCOIN'
      for update;
      select available_quantity, locked_quantity
      into v_owned_available, v_owned_locked
      from admin.fixture_asset_ownership
      where user_id = v_role_user.user_id
        and asset_kind = 'KCOIN'
        and asset_key = 'KCOIN'
      for update;
      if found and (
        v_current_available is null
        or v_owned_locked <> 0
        or v_owned_available > v_current_available
      ) then
        raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
      end if;
      if found and v_owned_available > 0 then
        update economy.balances
        set available = available - v_owned_available, updated_at = now()
        where user_id = v_role_user.user_id and currency = 'KCOIN';
        insert into economy.ledger (
          operation_id, user_id, currency, amount, reason, reference, balance_after
        ) values (
          null, v_role_user.user_id, 'KCOIN', -v_owned_available,
          'battle_acceptance_fixture',
          v_run_key || ':unbind:' || v_role_user.role,
          v_current_available - v_owned_available
        );
        insert into admin.fixture_asset_changes (
          run_key, role, user_id, asset_kind, asset_key, available_delta,
          aggregate_before, aggregate_after, fixture_owned_before, fixture_owned_after
        ) values (
          v_run_key, v_role_user.role, v_role_user.user_id, 'KCOIN', 'KCOIN',
          -v_owned_available,
          jsonb_build_object('available', v_current_available, 'locked', v_current_locked),
          jsonb_build_object('available', v_current_available - v_owned_available, 'locked', v_current_locked),
          jsonb_build_object('available', v_owned_available, 'locked', v_owned_locked),
          jsonb_build_object('available', 0, 'locked', 0)
        );
        v_change_count := v_change_count + 1;
      end if;

      for v_asset in
        select o.asset_key as template_id, o.available_quantity
        from admin.fixture_asset_ownership o
        where o.user_id = v_role_user.user_id
          and o.asset_kind = 'PET'
          and o.available_quantity > 0
        order by o.asset_key
        for update
      loop
        select quantity into v_current_available
        from inventory.holdings
        where user_id = v_role_user.user_id and template_id = v_asset.template_id
        for update;
        if not found or v_asset.available_quantity > v_current_available then
          raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
        end if;
        update inventory.holdings
        set quantity = quantity - v_asset.available_quantity, updated_at = now()
        where user_id = v_role_user.user_id and template_id = v_asset.template_id;
        insert into admin.fixture_asset_changes (
          run_key, role, user_id, asset_kind, asset_key, available_delta,
          aggregate_before, aggregate_after, fixture_owned_before, fixture_owned_after
        ) values (
          v_run_key, v_role_user.role, v_role_user.user_id, 'PET', v_asset.template_id,
          -v_asset.available_quantity,
          jsonb_build_object('quantity', v_current_available),
          jsonb_build_object('quantity', v_current_available - v_asset.available_quantity),
          jsonb_build_object('quantity', v_asset.available_quantity),
          jsonb_build_object('quantity', 0)
        );
        v_change_count := v_change_count + 1;
      end loop;
      delete from admin.fixture_asset_ownership
      where user_id = v_role_user.user_id and fixture_version = p_fixture_version;
    end loop;
    delete from admin.fixture_user_bindings
    where fixture_version = p_fixture_version;
  end if;

  if v_binding_changed then
    insert into admin.fixture_user_bindings (
      role, fixture_version, user_id, payload_hash
    ) values
      ('A', p_fixture_version, p_ordered_user_ids[1], v_payload_hash),
      ('B', p_fixture_version, p_ordered_user_ids[2], v_payload_hash),
      ('C', p_fixture_version, p_ordered_user_ids[3], v_payload_hash),
      ('D', p_fixture_version, p_ordered_user_ids[4], v_payload_hash);
  end if;

  for v_role_user in
    select *
    from (values
      ('A', p_ordered_user_ids[1]),
      ('B', p_ordered_user_ids[2]),
      ('C', p_ordered_user_ids[3]),
      ('D', p_ordered_user_ids[4])
    ) role_user(role, user_id)
    order by role
  loop
    select max(target_kcoin) into v_target
    from admin.battle_fixture_definition() d
    where d.fixture_version = p_fixture_version and d.role = v_role_user.role;
    insert into economy.balances (user_id, currency)
    values (v_role_user.user_id, 'KCOIN')
    on conflict (user_id, currency) do nothing;
    select available, locked
    into v_current_available, v_current_locked
    from economy.balances
    where user_id = v_role_user.user_id and currency = 'KCOIN'
    for update;
    insert into admin.fixture_asset_ownership (
      user_id, asset_kind, asset_key, fixture_version
    ) values (
      v_role_user.user_id, 'KCOIN', 'KCOIN', p_fixture_version
    )
    on conflict (user_id, asset_kind, asset_key) do nothing;
    select available_quantity, locked_quantity
    into v_owned_available, v_owned_locked
    from admin.fixture_asset_ownership
    where user_id = v_role_user.user_id
      and asset_kind = 'KCOIN'
      and asset_key = 'KCOIN'
    for update;
    if v_owned_locked <> 0 or v_owned_available > v_current_available then
      raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
    end if;
    v_delta := v_target - v_owned_available;
    if v_delta <> 0 then
      if v_current_available + v_delta < 0 then
        raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
      end if;
      update economy.balances
      set available = available + v_delta, updated_at = now()
      where user_id = v_role_user.user_id and currency = 'KCOIN';
      if v_delta > 0 then
        update admin.fixture_asset_ownership
        set fixture_version = p_fixture_version,
            available_quantity = available_quantity + v_delta,
            updated_at = now()
        where user_id = v_role_user.user_id
          and asset_kind = 'KCOIN'
          and asset_key = 'KCOIN';
      end if;
      insert into economy.ledger (
        operation_id, user_id, currency, amount, reason, reference, balance_after
      ) values (
        null, v_role_user.user_id, 'KCOIN', v_delta,
        'battle_acceptance_fixture',
        v_run_key || ':' || v_role_user.role,
        v_current_available + v_delta
      )
      ;
      insert into admin.fixture_asset_changes (
        run_key, role, user_id, asset_kind, asset_key, available_delta,
        aggregate_before, aggregate_after, fixture_owned_before, fixture_owned_after
      ) values (
        v_run_key, v_role_user.role, v_role_user.user_id, 'KCOIN', 'KCOIN', v_delta,
        jsonb_build_object('available', v_current_available, 'locked', v_current_locked),
        jsonb_build_object('available', v_current_available + v_delta, 'locked', v_current_locked),
        jsonb_build_object('available', v_owned_available, 'locked', v_owned_locked),
        jsonb_build_object('available', v_target, 'locked', 0)
      );
      v_change_count := v_change_count + 1;
    end if;

    for v_asset in
      select asset_key as template_id
      from admin.fixture_asset_ownership
      where user_id = v_role_user.user_id and asset_kind = 'PET'
      union
      select d.template_id
      from admin.battle_fixture_definition() d
      where d.fixture_version = p_fixture_version and d.role = v_role_user.role
      order by template_id
    loop
      select coalesce(max(d.target_quantity), 0) into v_target
      from admin.battle_fixture_definition() d
      where d.fixture_version = p_fixture_version
        and d.role = v_role_user.role
        and d.template_id = v_asset.template_id;
      insert into inventory.holdings (user_id, template_id)
      values (v_role_user.user_id, v_asset.template_id)
      on conflict (user_id, template_id) do nothing;
      select quantity into v_current_available
      from inventory.holdings
      where user_id = v_role_user.user_id and template_id = v_asset.template_id
      for update;
      insert into admin.fixture_asset_ownership (
        user_id, asset_kind, asset_key, fixture_version
      ) values (
        v_role_user.user_id, 'PET', v_asset.template_id, p_fixture_version
      )
      on conflict (user_id, asset_kind, asset_key) do nothing;
      select available_quantity, locked_quantity
      into v_owned_available, v_owned_locked
      from admin.fixture_asset_ownership
      where user_id = v_role_user.user_id
        and asset_kind = 'PET'
        and asset_key = v_asset.template_id
      for update;
      if v_owned_locked <> 0 or v_owned_available > v_current_available then
        raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
      end if;
      v_delta := v_target - v_owned_available;
      if v_delta <> 0 then
        if v_current_available + v_delta < 0 then
          raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
        end if;
        update inventory.holdings
        set quantity = quantity + v_delta, updated_at = now()
        where user_id = v_role_user.user_id and template_id = v_asset.template_id;
        if v_delta > 0 then
          update admin.fixture_asset_ownership
          set fixture_version = p_fixture_version,
              available_quantity = available_quantity + v_delta,
              updated_at = now()
          where user_id = v_role_user.user_id
            and asset_kind = 'PET'
            and asset_key = v_asset.template_id;
        end if;
        insert into admin.fixture_asset_changes (
          run_key, role, user_id, asset_kind, asset_key, available_delta,
          aggregate_before, aggregate_after, fixture_owned_before, fixture_owned_after
        ) values (
          v_run_key, v_role_user.role, v_role_user.user_id, 'PET', v_asset.template_id, v_delta,
          jsonb_build_object('quantity', v_current_available),
          jsonb_build_object('quantity', v_current_available + v_delta),
          jsonb_build_object('quantity', v_owned_available),
          jsonb_build_object('quantity', v_target)
        );
        v_change_count := v_change_count + 1;
      end if;
    end loop;
  end loop;

  v_after := admin.battle_fixture_state(p_fixture_version, p_ordered_user_ids);
  if coalesce((v_after->>'aligned')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_RECONCILIATION_FAILED';
  end if;
  v_result := jsonb_build_object(
    'run_key', v_run_key,
    'fixture_version', p_fixture_version,
    'fixture_definition_hash', v_definition_hash,
    'payload_hash', v_payload_hash,
    'result', case when v_change_count = 0 then 'noop' else 'applied' end,
    'asset_change_count', v_change_count,
    'state', v_after,
    'replayed', false
  );
  update admin.fixture_run_audit
  set after_aggregate = v_after,
      result = case when v_change_count = 0 then 'noop' else 'applied' end
  where run_key = v_run_key;
  update admin.fixture_commands
  set status = 'succeeded', result = v_result, completed_at = now()
  where request_id = p_request_id;
  return v_result;
end;
$$;
