create table monster_tamer.rulesets (
  id text primary key check (id ~ '^v[0-9]+$'),
  map_checksum text not null check (map_checksum ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index monster_tamer_one_active_ruleset_idx
on monster_tamer.rulesets (active)
where active;

create table monster_tamer.chain_profiles (
  chain_id text primary key references catalog.chains(id) on delete cascade,
  rules_version text not null references monster_tamer.rulesets(id),
  element text not null check (element in ('water', 'fire', 'wood', 'wind', 'lightning'))
);

create table monster_tamer.skill_profiles (
  rules_version text not null references monster_tamer.rulesets(id),
  element text not null check (element in ('water', 'fire', 'wood', 'wind', 'lightning')),
  stage smallint not null check (stage between 1 and 3),
  slot smallint not null check (slot between 1 and 3),
  code text not null,
  name text not null,
  power_bp integer not null check (power_bp between 0 and 30000),
  effect_kind text not null check (
    effect_kind in (
      'none', 'heal_self', 'shield_self', 'burn_enemy', 'attack_up_self',
      'drain_self', 'regen_self', 'weaken_enemy', 'charge_self'
    )
  ),
  effect_value_bp integer not null check (effect_value_bp between 0 and 30000),
  duration_turns smallint not null check (duration_turns between 0 and 10),
  primary key (rules_version, element, stage, slot),
  unique (rules_version, code)
);

create table monster_tamer.regions (
  id text primary key check (
    id in (
      'camp', 'luminous_forest', 'tidal_wetland', 'windswept_highlands',
      'crystal_cavern', 'molten_basin', 'hidden_cave', 'guardian_lair'
    )
  ),
  rules_version text not null references monster_tamer.rulesets(id),
  name text not null,
  sort_order smallint not null unique check (sort_order between 1 and 8),
  element text check (element in ('water', 'fire', 'wood', 'wind', 'lightning')),
  width_tiles smallint not null check (width_tiles between 8 and 128),
  height_tiles smallint not null check (height_tiles between 8 and 128),
  spawn_x smallint not null check (spawn_x >= 0 and spawn_x < width_tiles),
  spawn_y smallint not null check (spawn_y >= 0 and spawn_y < height_tiles),
  environment_effect_code text not null,
  difficulty_min_bp integer not null check (difficulty_min_bp between 5000 and 20000),
  difficulty_max_bp integer not null check (difficulty_max_bp between difficulty_min_bp and 25000)
);

create table monster_tamer.world_cells (
  rules_version text not null references monster_tamer.rulesets(id),
  region_id text not null references monster_tamer.regions(id),
  cell_id text not null check (cell_id ~ '^[0-9]+:[0-9]+$'),
  x smallint not null check (x >= 0),
  y smallint not null check (y >= 0),
  walkable boolean not null,
  primary key (rules_version, region_id, cell_id),
  unique (rules_version, region_id, x, y),
  check (cell_id = x::text || ':' || y::text)
);

create table monster_tamer.world_nodes (
  id text primary key,
  rules_version text not null references monster_tamer.rulesets(id),
  region_id text not null references monster_tamer.regions(id),
  kind text not null check (
    kind in ('chest', 'gate', 'shortcut', 'supply', 'gather', 'exit', 'rematch')
  ),
  name text not null,
  x smallint not null check (x >= 0),
  y smallint not null check (y >= 0),
  required_ability text check (
    required_ability in ('vine_bridge', 'tidal_walk', 'wind_glide', 'lightning_charge', 'heat_shield')
  ),
  target_region text references monster_tamer.regions(id),
  refreshable boolean not null,
  supply_reward integer not null default 0 check (supply_reward between 0 and 20),
  heal_bp integer not null default 0 check (heal_bp between 0 and 10000)
);

create index monster_tamer_world_nodes_region_idx
on monster_tamer.world_nodes (region_id, kind, id);

create table monster_tamer.encounter_definitions (
  id text primary key,
  rules_version text not null references monster_tamer.rulesets(id),
  region_id text not null references monster_tamer.regions(id),
  kind text not null check (kind in ('normal', 'elite', 'boss', 'guardian')),
  template_id text not null references catalog.templates(id),
  x smallint not null check (x >= 0),
  y smallint not null check (y >= 0),
  supply_reward integer not null default 0 check (supply_reward between 0 and 20),
  reward_ability text check (
    reward_ability in ('vine_bridge', 'tidal_walk', 'wind_glide', 'lightning_charge', 'heat_shield')
  ),
  mechanic_code text not null check (
    mechanic_code in (
      'none', 'forest_regrowth', 'wetland_tide_shield',
      'highland_gust_followup', 'cavern_thunder_cycle',
      'basin_scorch', 'guardian_element_cycle'
    )
  ),
  engage_radius smallint not null check (engage_radius between 1 and 5),
  check (
    (kind in ('normal', 'elite') and mechanic_code = 'none')
    or (kind in ('boss', 'guardian') and mechanic_code <> 'none')
  )
);

create index monster_tamer_encounters_region_idx
on monster_tamer.encounter_definitions (region_id, kind, id);

create table monster_tamer.rematch_nodes (
  node_id text primary key references monster_tamer.world_nodes(id) on delete cascade,
  encounter_id text not null unique references monster_tamer.encounter_definitions(id) on delete cascade
);

create table monster_tamer.player_progress (
  user_id uuid primary key references identity.users(id) on delete cascade,
  rules_version text not null references monster_tamer.rulesets(id),
  state_version bigint not null default 0 check (state_version >= 0),
  current_region text not null default 'camp' references monster_tamer.regions(id),
  resume_x smallint not null check (resume_x >= 0),
  resume_y smallint not null check (resume_y >= 0),
  region_entry_serial bigint not null default 0 check (region_entry_serial >= 0),
  party_template_ids text[] not null default '{}'::text[],
  party_state jsonb not null default '[]'::jsonb check (jsonb_typeof(party_state) = 'array'),
  unlocked_regions text[] not null default array['luminous_forest', 'tidal_wetland']::text[],
  abilities text[] not null default '{}'::text[],
  revealed_cells jsonb not null default '{}'::jsonb check (jsonb_typeof(revealed_cells) = 'object'),
  completed_node_ids text[] not null default '{}'::text[],
  defeated_elite_ids text[] not null default '{}'::text[],
  defeated_boss_ids text[] not null default '{}'::text[],
  guardian_completed_at timestamptz,
  supply_count integer not null default 0 check (supply_count between 0 and 999),
  regional_boost_region text references monster_tamer.regions(id),
  last_checkpoint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(party_template_ids) between 0 and 3)
);

create table monster_tamer.refreshable_claims (
  user_id uuid not null references identity.users(id) on delete cascade,
  region_entry_serial bigint not null check (region_entry_serial > 0),
  claim_id text not null,
  claim_kind text not null check (claim_kind in ('encounter', 'supply', 'gather')),
  claimed_at timestamptz not null default now(),
  primary key (user_id, region_entry_serial, claim_kind, claim_id)
);

create index monster_tamer_refreshable_claims_user_serial_idx
on monster_tamer.refreshable_claims (user_id, region_entry_serial);

create table monster_tamer.battles (
  id uuid primary key,
  user_id uuid not null references identity.users(id) on delete cascade,
  encounter_id text not null references monster_tamer.encounter_definitions(id),
  region_entry_serial bigint not null,
  status text not null default 'active' check (status in ('active', 'won', 'lost')),
  state_version bigint not null default 0 check (state_version >= 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  result_acknowledged_at timestamptz,
  check (result_acknowledged_at is null or status in ('won', 'lost'))
);

create unique index monster_tamer_one_unacknowledged_battle_per_user_idx
on monster_tamer.battles (user_id)
where result_acknowledged_at is null;

create index monster_tamer_battles_user_created_idx
on monster_tamer.battles (user_id, created_at desc);

create or replace function monster_tamer.max_hp(
  p_combat_power integer,
  p_rarity text,
  p_stage smallint,
  p_scale_bp integer default 10000
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    1,
    floor(
      (
        100
        + sqrt(p_combat_power::numeric) * 8
        + p_stage * 20
        + catalog.rarity_rank(p_rarity) * 12
      ) * p_scale_bp / 10000
    )::integer
  )
$$;

create or replace function monster_tamer.attack(
  p_combat_power integer,
  p_rarity text,
  p_stage smallint,
  p_scale_bp integer default 10000
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    1,
    floor(
      (
        15
        + sqrt(p_combat_power::numeric) * 2
        + p_stage * 3
        + catalog.rarity_rank(p_rarity) * 2
      ) * p_scale_bp / 10000
    )::integer
  )
$$;

create or replace function monster_tamer.empty_statuses()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'shield_hp', 0,
    'burn_turns', 0,
    'burn_damage', 0,
    'attack_up_bp', 0,
    'weakened_bp', 0,
    'regen_turns', 0,
    'regen_amount', 0,
    'charge_damage', 0
  )
$$;

create or replace function monster_tamer.template_profile_json(p_template_id text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'template_id', t.id,
    'name', t.name,
    'rarity', t.rarity,
    'stage', t.stage,
    'chain_id', t.chain_id,
    'image_thumbnail_path', t.image_thumbnail_path,
    'image_detail_path', t.image_detail_path,
    'combat_power', t.combat_power,
    'element', cp.element,
    'max_hp', monster_tamer.max_hp(t.combat_power, t.rarity, t.stage),
    'attack', monster_tamer.attack(t.combat_power, t.rarity, t.stage),
    'skills', (
      select jsonb_agg(
        jsonb_build_object(
          'slot', sp.slot,
          'code', sp.code,
          'name', sp.name,
          'element', sp.element,
          'power_bp', sp.power_bp,
          'effect_kind', sp.effect_kind,
          'effect_value_bp', sp.effect_value_bp,
          'duration_turns', sp.duration_turns
        )
        order by sp.slot
      )
      from monster_tamer.skill_profiles sp
      where sp.rules_version = cp.rules_version
        and sp.element = cp.element
        and sp.stage = t.stage
    )
  )
  from catalog.templates t
  join monster_tamer.chain_profiles cp on cp.chain_id = t.chain_id
  where t.id = p_template_id
$$;

create or replace function monster_tamer.combatant_json(
  p_template_id text,
  p_current_hp integer default null,
  p_scale_bp integer default 10000
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'template_id', t.id,
    'name', t.name,
    'image_thumbnail_path', t.image_thumbnail_path,
    'image_detail_path', t.image_detail_path,
    'element', cp.element,
    'current_hp', least(
      coalesce(p_current_hp, monster_tamer.max_hp(t.combat_power, t.rarity, t.stage, p_scale_bp)),
      monster_tamer.max_hp(t.combat_power, t.rarity, t.stage, p_scale_bp)
    ),
    'max_hp', monster_tamer.max_hp(t.combat_power, t.rarity, t.stage, p_scale_bp),
    'attack', monster_tamer.attack(t.combat_power, t.rarity, t.stage, p_scale_bp),
    'down', coalesce(p_current_hp, 1) <= 0,
    'statuses', monster_tamer.empty_statuses(),
    'skills', monster_tamer.template_profile_json(t.id)->'skills'
  )
  from catalog.templates t
  join monster_tamer.chain_profiles cp on cp.chain_id = t.chain_id
  where t.id = p_template_id
$$;

create or replace function monster_tamer.apply_attack_boost(
  p_combatant jsonb,
  p_boost_bp integer
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_boost_bp <= 0 then p_combatant
    else jsonb_set(
      p_combatant,
      '{attack}',
      to_jsonb(
        greatest(
          1,
          floor((p_combatant->>'attack')::numeric * (10000 + p_boost_bp) / 10000)::integer
        )
      ),
      false
    )
  end
$$;

create or replace function monster_tamer.apply_raw_damage(
  p_defender jsonb,
  p_damage integer
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_defender jsonb := p_defender;
  v_statuses jsonb := p_defender->'statuses';
  v_shield integer := (v_statuses->>'shield_hp')::integer;
  v_hp integer := (p_defender->>'current_hp')::integer;
  v_remaining integer := greatest(0, p_damage - v_shield);
begin
  v_statuses := jsonb_set(
    v_statuses,
    '{shield_hp}',
    to_jsonb(greatest(0, v_shield - p_damage))
  );
  v_hp := greatest(0, v_hp - v_remaining);
  v_defender := jsonb_set(v_defender, '{current_hp}', to_jsonb(v_hp));
  v_defender := jsonb_set(v_defender, '{down}', to_jsonb(v_hp <= 0));
  return jsonb_set(v_defender, '{statuses}', v_statuses);
end;
$$;

create or replace function monster_tamer.ensure_progress(p_user_id uuid)
returns monster_tamer.player_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress monster_tamer.player_progress%rowtype;
  v_rules_version text;
begin
  select id into v_rules_version
  from monster_tamer.rulesets
  where active;
  if v_rules_version is null then
    perform api.raise_business_error('INTERNAL_ERROR', 'Monster Tamer 规则未启用');
  end if;
  insert into monster_tamer.player_progress (
    user_id, rules_version, resume_x, resume_y
  )
  select p_user_id, v_rules_version, r.spawn_x, r.spawn_y
  from monster_tamer.regions r
  where r.id = 'camp' and r.rules_version = v_rules_version
  on conflict (user_id) do nothing;
  select * into v_progress
  from monster_tamer.player_progress
  where user_id = p_user_id;
  return v_progress;
end;
$$;

create or replace function monster_tamer.progress_json(
  p_progress monster_tamer.player_progress,
  p_force_reselection boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'state_version', p_progress.state_version,
    'current_region', case when p_force_reselection then 'camp' else p_progress.current_region end,
    'resume_position', jsonb_build_object(
      'x', p_progress.resume_x,
      'y', p_progress.resume_y
    ),
    'region_entry_serial', p_progress.region_entry_serial,
    'party', case when p_force_reselection then '[]'::jsonb else p_progress.party_state end,
    'unlocked_regions', to_jsonb(p_progress.unlocked_regions),
    'abilities', to_jsonb(p_progress.abilities),
    'revealed_cells', p_progress.revealed_cells,
    'completed_node_ids', to_jsonb(p_progress.completed_node_ids),
    'defeated_elite_ids', to_jsonb(p_progress.defeated_elite_ids),
    'defeated_boss_ids', to_jsonb(p_progress.defeated_boss_ids),
    'guardian_completed_at', p_progress.guardian_completed_at,
    'supply_count', p_progress.supply_count,
    'regional_boost', case
      when p_progress.regional_boost_region is null then null
      else jsonb_build_object(
        'region_id', p_progress.regional_boost_region,
        'attack_bp', 1000
      )
    end,
    'last_checkpoint', p_progress.last_checkpoint,
    'current_refreshable_claim_ids', coalesce((
      select jsonb_agg(c.claim_id order by c.claim_id)
      from monster_tamer.refreshable_claims c
      where c.user_id = p_progress.user_id
        and c.region_entry_serial = p_progress.region_entry_serial
    ), '[]'::jsonb)
  )
$$;

create or replace function monster_tamer.battle_json(p_battle monster_tamer.battles)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'battle_id', p_battle.id,
    'encounter_id', p_battle.encounter_id,
    'kind', e.kind,
    'status', p_battle.status,
    'state_version', p_battle.state_version,
    'turn', (p_battle.state->>'turn')::bigint,
    'active_template_id', p_battle.state->>'active_template_id',
    'party', p_battle.state->'party',
    'enemy', p_battle.state->'enemy',
    'environment', p_battle.state->'environment',
    'mechanic_code', e.mechanic_code,
    'mechanic_notice', p_battle.state->>'mechanic_notice'
  )
  from monster_tamer.encounter_definitions e
  where e.id = p_battle.encounter_id
$$;

create or replace function monster_tamer.lock_and_validate_team(
  p_user_id uuid,
  p_template_ids text[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_valid_count integer;
begin
  if cardinality(p_template_ids) not between 1 and 3
    or cardinality(p_template_ids) <> (
      select count(distinct value)
      from unnest(p_template_ids) value
    )
  then
    return false;
  end if;
  perform 1
  from inventory.holdings h
  where h.user_id = p_user_id
    and h.template_id = any(p_template_ids)
  order by h.template_id
  for update;
  select count(*) into v_valid_count
  from unnest(p_template_ids) template_id
  where inventory.available_quantity(p_user_id, template_id) > 0
    and exists (
      select 1
      from monster_tamer.chain_profiles cp
      join catalog.templates t on t.chain_id = cp.chain_id
      where t.id = template_id
    );
  return v_valid_count = cardinality(p_template_ids);
end;
$$;

create or replace function monster_tamer.full_party_state(p_template_ids text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'template_id', t.id,
      'current_hp', monster_tamer.max_hp(t.combat_power, t.rarity, t.stage),
      'max_hp', monster_tamer.max_hp(t.combat_power, t.rarity, t.stage)
    )
    order by selected.ordinality
  ), '[]'::jsonb)
  from unnest(p_template_ids) with ordinality selected(template_id, ordinality)
  join catalog.templates t on t.id = selected.template_id
$$;

create or replace function monster_tamer.encounter_available(
  p_progress monster_tamer.player_progress,
  p_encounter monster_tamer.encounter_definitions
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_encounter.region_id = any(p_progress.unlocked_regions)
    and case p_encounter.kind
      when 'normal' then not exists (
        select 1
        from monster_tamer.refreshable_claims c
        where c.user_id = p_progress.user_id
          and c.region_entry_serial = p_progress.region_entry_serial
          and c.claim_kind = 'encounter'
          and c.claim_id = p_encounter.id
      )
      when 'elite' then not p_encounter.id = any(p_progress.defeated_elite_ids)
      when 'boss' then not p_encounter.id = any(p_progress.defeated_boss_ids)
      when 'guardian' then p_progress.guardian_completed_at is null
      else false
    end
$$;

create or replace function monster_tamer.cell_traversable(
  p_progress monster_tamer.player_progress,
  p_x smallint,
  p_y smallint
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from monster_tamer.world_cells c
    where c.rules_version = p_progress.rules_version
      and c.region_id = p_progress.current_region
      and c.x = p_x
      and c.y = p_y
      and c.walkable
  )
  and not exists (
    select 1
    from monster_tamer.world_nodes n
    where n.rules_version = p_progress.rules_version
      and n.region_id = p_progress.current_region
      and n.x = p_x
      and n.y = p_y
      and n.kind in ('gate', 'shortcut')
      and not n.id = any(p_progress.completed_node_ids)
  )
  and not exists (
    select 1
    from monster_tamer.encounter_definitions e
    where e.rules_version = p_progress.rules_version
      and e.region_id = p_progress.current_region
      and e.x = p_x
      and e.y = p_y
      and monster_tamer.encounter_available(p_progress, e)
  )
$$;

create or replace function monster_tamer.encounter_reachable(
  p_progress monster_tamer.player_progress,
  p_encounter monster_tamer.encounter_definitions
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive reachable(x, y) as (
    select p_progress.resume_x, p_progress.resume_y
    union
    select c.x, c.y
    from reachable current_cell
    join monster_tamer.world_cells c
      on c.rules_version = p_progress.rules_version
     and c.region_id = p_progress.current_region
     and c.walkable
     and abs(c.x - current_cell.x) + abs(c.y - current_cell.y) = 1
    where not exists (
      select 1
      from monster_tamer.world_nodes n
      where n.rules_version = p_progress.rules_version
        and n.region_id = p_progress.current_region
        and n.x = c.x
        and n.y = c.y
        and n.kind in ('gate', 'shortcut')
        and not n.id = any(p_progress.completed_node_ids)
    )
      and not exists (
        select 1
        from monster_tamer.encounter_definitions obstacle
        where obstacle.rules_version = p_progress.rules_version
          and obstacle.region_id = p_progress.current_region
          and obstacle.x = c.x
          and obstacle.y = c.y
          and obstacle.id <> p_encounter.id
          and monster_tamer.encounter_available(p_progress, obstacle)
      )
  )
  select exists (
    select 1
    from reachable
    where x = p_encounter.x and y = p_encounter.y
  )
$$;

create or replace function monster_tamer.world_json(
  p_progress monster_tamer.player_progress,
  p_force_reselection boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'regions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'element', r.element,
          'width_tiles', r.width_tiles,
          'height_tiles', r.height_tiles,
          'spawn', jsonb_build_object('x', r.spawn_x, 'y', r.spawn_y),
          'walkable_cell_ids', coalesce((
            select jsonb_agg(c.cell_id order by c.y, c.x)
            from monster_tamer.world_cells c
            where c.rules_version = r.rules_version
              and c.region_id = r.id
              and c.walkable
          ), '[]'::jsonb),
          'environment', jsonb_build_object(
            'element', r.element,
            'effect_code', r.environment_effect_code
          ),
          'unlocked', r.id = 'camp' or r.id = any(p_progress.unlocked_regions)
        )
        order by r.sort_order
      )
      from monster_tamer.regions r
      where r.rules_version = p_progress.rules_version
    ), '[]'::jsonb),
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'region_id', n.region_id,
          'kind', n.kind,
          'name', n.name,
          'position', jsonb_build_object('x', n.x, 'y', n.y),
          'required_ability', n.required_ability,
          'target_region', n.target_region,
          'encounter_id', rematch.encounter_id,
          'refreshable', n.refreshable,
          'available', (
            not p_force_reselection
            and (
              n.kind <> 'rematch'
              or (
                rematch_encounter.kind = 'boss'
                and rematch_encounter.id = any(p_progress.defeated_boss_ids)
              )
              or (
                rematch_encounter.kind = 'guardian'
                and p_progress.guardian_completed_at is not null
              )
            )
          ),
          'completed', n.kind <> 'rematch'
            and n.id = any(p_progress.completed_node_ids),
          'claimed', n.kind <> 'rematch'
            and n.refreshable
            and not p_force_reselection
            and exists (
            select 1
            from monster_tamer.refreshable_claims c
            where c.user_id = p_progress.user_id
              and c.region_entry_serial = p_progress.region_entry_serial
              and c.claim_id = n.id
          )
        )
        order by r.sort_order, n.id
      )
      from monster_tamer.world_nodes n
      join monster_tamer.regions r on r.id = n.region_id
      left join monster_tamer.rematch_nodes rematch on rematch.node_id = n.id
      left join monster_tamer.encounter_definitions rematch_encounter
        on rematch_encounter.id = rematch.encounter_id
      where n.rules_version = p_progress.rules_version
    ), '[]'::jsonb),
    'encounters', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'region_id', e.region_id,
          'kind', e.kind,
          'template_id', e.template_id,
          'name', t.name,
          'image_thumbnail_path', t.image_thumbnail_path,
          'mechanic_code', e.mechanic_code,
          'position', jsonb_build_object('x', e.x, 'y', e.y),
          'engage_radius', e.engage_radius,
          'available', (
            not p_force_reselection
            and monster_tamer.encounter_available(p_progress, e)
          ),
          'claimed', (
            (e.kind = 'elite' and e.id = any(p_progress.defeated_elite_ids))
            or (e.kind = 'boss' and e.id = any(p_progress.defeated_boss_ids))
            or (e.kind = 'guardian' and p_progress.guardian_completed_at is not null)
            or (
              e.kind = 'normal'
              and exists (
                select 1
                from monster_tamer.refreshable_claims c
                where c.user_id = p_progress.user_id
                  and c.region_entry_serial = p_progress.region_entry_serial
                  and c.claim_kind = 'encounter'
                  and c.claim_id = e.id
              )
            )
          )
        )
        order by r.sort_order, e.kind, e.id
      )
      from monster_tamer.encounter_definitions e
      join monster_tamer.regions r on r.id = e.region_id
      join catalog.templates t on t.id = e.template_id
      where e.rules_version = p_progress.rules_version
    ), '[]'::jsonb)
  )
$$;

create or replace function api.monster_tamer_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_progress monster_tamer.player_progress%rowtype;
  v_active_battle monster_tamer.battles%rowtype;
  v_inventory jsonb;
  v_combat_catalog jsonb;
  v_inventory_count integer;
  v_invalid_team boolean := false;
  v_force_reselection boolean := false;
  v_rules monster_tamer.rulesets%rowtype;
begin
  v_progress := monster_tamer.ensure_progress(v_user_id);
  select * into v_progress
  from monster_tamer.player_progress
  where user_id = v_user_id
  for update;
  select * into v_rules
  from monster_tamer.rulesets
  where id = v_progress.rules_version and active;
  if v_rules.id is null then
    perform api.raise_business_error('INTERNAL_ERROR', 'Monster Tamer 规则版本不可用');
  end if;
  select * into v_active_battle
  from monster_tamer.battles
  where user_id = v_user_id
    and result_acknowledged_at is null
  order by created_at desc
  limit 1;
  select coalesce(jsonb_agg(
    monster_tamer.template_profile_json(h.template_id)
      || jsonb_build_object(
        'available_quantity',
        inventory.available_quantity(v_user_id, h.template_id)
      )
    order by t.sort_order
  ), '[]'::jsonb), count(*)
  into v_inventory, v_inventory_count
  from inventory.holdings h
  join catalog.templates t on t.id = h.template_id
  join monster_tamer.chain_profiles cp on cp.chain_id = t.chain_id
  where h.user_id = v_user_id
    and inventory.available_quantity(v_user_id, h.template_id) > 0;
  select coalesce(
    jsonb_agg(
      monster_tamer.template_profile_json(t.id)
      order by t.sort_order
    ),
    '[]'::jsonb
  )
  into v_combat_catalog
  from catalog.templates t
  join monster_tamer.chain_profiles cp
    on cp.chain_id = t.chain_id
   and cp.rules_version = v_progress.rules_version;
  if v_active_battle.id is null and cardinality(v_progress.party_template_ids) > 0 then
    select exists (
      select 1
      from unnest(v_progress.party_template_ids) template_id
      where inventory.available_quantity(v_user_id, template_id) <= 0
    ) into v_invalid_team;
  end if;
  v_force_reselection := v_invalid_team and v_active_battle.id is null;
  if v_force_reselection then
    update monster_tamer.player_progress
    set current_region = 'camp',
        resume_x = (
          select r.spawn_x
          from monster_tamer.regions r
          where r.id = 'camp' and r.rules_version = v_progress.rules_version
        ),
        resume_y = (
          select r.spawn_y
          from monster_tamer.regions r
          where r.id = 'camp' and r.rules_version = v_progress.rules_version
        ),
        party_template_ids = '{}'::text[],
        party_state = '[]'::jsonb,
        state_version = state_version + 1,
        last_checkpoint = 'team_reselection_required',
        updated_at = now()
    where user_id = v_user_id
    returning * into v_progress;
  end if;
  return jsonb_build_object(
    'rules_version', v_rules.id,
    'map_checksum', v_rules.map_checksum,
    'entry_state', case
      when v_active_battle.id is not null then 'ready'
      when v_inventory_count = 0 then 'no_available_collections'
      when v_force_reselection then 'team_reselection_required'
      else 'ready'
    end,
    'inventory', v_inventory,
    'combat_catalog', v_combat_catalog,
    'progress', monster_tamer.progress_json(v_progress),
    'active_battle', case
      when v_active_battle.id is null then null
      else monster_tamer.battle_json(v_active_battle)
    end,
    'world', monster_tamer.world_json(v_progress)
  );
end;
$$;

create or replace function api.monster_tamer_checkpoint(
  p_session_id uuid,
  p_operation_id uuid,
  p_expected_progress_version bigint,
  p_command jsonb,
  p_revealed_cell_ids jsonb,
  p_traversed_cell_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_progress monster_tamer.player_progress%rowtype;
  v_type text := p_command->>'type';
  v_template_ids text[];
  v_target_region text;
  v_target_template text;
  v_source_node_id text;
  v_node monster_tamer.world_nodes%rowtype;
  v_target_region_row monster_tamer.regions%rowtype;
  v_party jsonb;
  v_existing_cells jsonb;
  v_merged_cells jsonb;
  v_step record;
  v_origin_x smallint;
  v_origin_y smallint;
  v_previous_x smallint;
  v_previous_y smallint;
  v_revealed_count integer := coalesce(jsonb_array_length(p_revealed_cell_ids), 0);
  v_traversed_count integer := coalesce(jsonb_array_length(p_traversed_cell_ids), 0);
  v_claimed integer;
  v_detail text;
begin
  v_operation := operations.begin_command(
    p_session_id,
    'monster_tamer.checkpoint',
    p_operation_id,
    jsonb_build_object(
      'expected_progress_version', p_expected_progress_version,
      'command', p_command,
      'revealed_cell_ids', coalesce(p_revealed_cell_ids, '[]'::jsonb),
      'traversed_cell_ids', coalesce(p_traversed_cell_ids, '[]'::jsonb)
    )
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform monster_tamer.ensure_progress(v_user_id);
    select * into v_progress
    from monster_tamer.player_progress
    where user_id = v_user_id
    for update;
    if v_progress.state_version <> p_expected_progress_version then
      perform api.raise_business_error(
        'MONSTER_TAMER_STATE_CONFLICT',
        '游戏进度版本已经更新'
      );
    end if;
    if exists (
      select 1
      from monster_tamer.battles
      where user_id = v_user_id
        and result_acknowledged_at is null
    ) then
      perform api.raise_business_error(
        'MONSTER_TAMER_BATTLE_ALREADY_ACTIVE',
        '战斗进行中或终局待确认时不能写入探索进度'
      );
    end if;
    if v_revealed_count > 256 or v_traversed_count > 256 then
      perform api.raise_business_error(
        'REQUEST_INVALID',
        '单次数组最多包含 256 个地图格'
      );
    end if;
    if v_type = 'sync_revealed_cells' and v_revealed_count + v_traversed_count = 0 then
      perform api.raise_business_error(
        'REQUEST_INVALID',
        '同步地图必须提交经过格或揭示格'
      );
    end if;
    if v_type <> 'sync_revealed_cells'
      and (v_revealed_count > 0 or v_traversed_count > 0)
    then
      perform api.raise_business_error(
        'REQUEST_INVALID',
        '只有地图同步命令可以提交经过格和揭示格'
      );
    end if;
    if v_type = 'sync_revealed_cells' then
      v_origin_x := v_progress.resume_x;
      v_origin_y := v_progress.resume_y;
      v_previous_x := v_origin_x;
      v_previous_y := v_origin_y;
      for v_step in
        select submitted.ordinality, cell.*
        from jsonb_array_elements_text(p_traversed_cell_ids)
          with ordinality submitted(cell_id, ordinality)
        left join monster_tamer.world_cells cell
          on cell.rules_version = v_progress.rules_version
         and cell.region_id = v_progress.current_region
         and cell.cell_id = submitted.cell_id
        order by submitted.ordinality
      loop
        if v_step.cell_id is null
          or abs(v_step.x - v_previous_x) + abs(v_step.y - v_previous_y) <> 1
          or not monster_tamer.cell_traversable(
            v_progress,
            v_step.x::smallint,
            v_step.y::smallint
          )
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '经过路径不连续或包含不可通行格'
          );
        end if;
        v_previous_x := v_step.x;
        v_previous_y := v_step.y;
      end loop;
      v_progress.resume_x := v_previous_x;
      v_progress.resume_y := v_previous_y;

      if exists (
        select 1
        from jsonb_array_elements_text(p_revealed_cell_ids) submitted(cell_id)
        left join monster_tamer.world_cells cell
          on cell.rules_version = v_progress.rules_version
         and cell.region_id = v_progress.current_region
         and cell.cell_id = submitted.cell_id
        where cell.cell_id is null
          or not exists (
            select 1
            from (
              select v_origin_x x, v_origin_y y
              union all
              select path_cell.x, path_cell.y
              from jsonb_array_elements_text(p_traversed_cell_ids)
                with ordinality traversed(cell_id, ordinality)
              join monster_tamer.world_cells path_cell
                on path_cell.rules_version = v_progress.rules_version
               and path_cell.region_id = v_progress.current_region
               and path_cell.cell_id = traversed.cell_id
            ) verified_path
            where abs(verified_path.x - cell.x)
                + abs(verified_path.y - cell.y) <= 2
          )
      ) then
        perform api.raise_business_error(
          'MONSTER_TAMER_NODE_UNAVAILABLE',
          '揭示格不属于已验证路径两格范围'
        );
      end if;
      if v_revealed_count > 0 then
        v_existing_cells := coalesce(
          v_progress.revealed_cells->v_progress.current_region,
          '[]'::jsonb
        );
        select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
        into v_merged_cells
        from (
          select distinct value
          from (
            select jsonb_array_elements_text(v_existing_cells) value
            union all
            select jsonb_array_elements_text(p_revealed_cell_ids) value
          ) cells
        ) unique_cells;
        v_progress.revealed_cells := jsonb_set(
          v_progress.revealed_cells,
          array[v_progress.current_region],
          v_merged_cells,
          true
        );
      end if;
    end if;

    case v_type
      when 'confirm_team' then
        if v_progress.current_region <> 'camp' then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '只能在中心营地更换队伍'
          );
        end if;
        select array_agg(value order by ordinality)
        into v_template_ids
        from jsonb_array_elements_text(p_command->'template_ids')
        with ordinality selected(value, ordinality);
        if not monster_tamer.lock_and_validate_team(v_user_id, v_template_ids) then
          perform api.raise_business_error(
            'MONSTER_TAMER_TEAM_INVALID',
            '队伍包含不可用藏品'
          );
        end if;
        v_progress.party_template_ids := v_template_ids;
        v_progress.party_state := monster_tamer.full_party_state(v_template_ids);
        v_progress.last_checkpoint := 'confirm_team';

      when 'enter_region' then
        v_target_region := p_command->>'region_id';
        v_source_node_id := p_command->>'source_node_id';
        if v_target_region = v_progress.current_region then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '已经位于目标区域'
          );
        end if;
        select * into v_target_region_row
        from monster_tamer.regions
        where id = v_target_region
          and rules_version = v_progress.rules_version;
        if v_target_region_row.id is null
          or (
            v_target_region <> 'camp'
            and not v_target_region = any(v_progress.unlocked_regions)
          )
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_REGION_LOCKED',
            '目标区域尚未开放'
          );
        end if;
        if v_target_region = 'guardian_lair'
          and not array[
            'vine_bridge', 'tidal_walk', 'wind_glide',
            'lightning_charge', 'heat_shield'
          ]::text[] <@ v_progress.abilities
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_REGION_LOCKED',
            '获得全部五种探索能力后才能进入最终巢穴'
          );
        end if;
        if v_progress.current_region = 'camp' then
          if v_source_node_id is not null then
            perform api.raise_business_error(
              'MONSTER_TAMER_NODE_UNAVAILABLE',
              '从中心营地出发不能指定区域节点'
            );
          end if;
        else
          select * into v_node
          from monster_tamer.world_nodes
          where id = v_source_node_id
            and rules_version = v_progress.rules_version
            and region_id = v_progress.current_region
            and target_region = v_target_region
            and kind in ('exit', 'gate');
          if v_node.id is null
            or abs(v_progress.resume_x - v_node.x)
              + abs(v_progress.resume_y - v_node.y) > 1
            or (
              v_node.required_ability is not null
              and not v_node.required_ability = any(v_progress.abilities)
            )
            or (
              v_node.kind = 'gate'
              and not v_node.id = any(v_progress.completed_node_ids)
            )
          then
            perform api.raise_business_error(
              'MONSTER_TAMER_NODE_UNAVAILABLE',
              '必须在已完成的区域出口或传送门旁进入目标区域'
            );
          end if;
        end if;
        if v_target_region <> 'camp' then
          if not monster_tamer.lock_and_validate_team(
            v_user_id,
            v_progress.party_template_ids
          ) then
            update monster_tamer.player_progress
            set current_region = 'camp',
                resume_x = (
                  select r.spawn_x
                  from monster_tamer.regions r
                  where r.id = 'camp'
                    and r.rules_version = v_progress.rules_version
                ),
                resume_y = (
                  select r.spawn_y
                  from monster_tamer.regions r
                  where r.id = 'camp'
                    and r.rules_version = v_progress.rules_version
                ),
                party_template_ids = '{}'::text[],
                party_state = '[]'::jsonb,
                state_version = state_version + 1,
                last_checkpoint = 'team_reselection_required',
                updated_at = now()
            where user_id = v_user_id
            returning * into v_progress;
            return operations.fail_command(
              p_operation_id,
              'MONSTER_TAMER_TEAM_INVALID',
              jsonb_build_object(
                'message', '进入区域前队伍已失效，已返回中心营地',
                'progress', monster_tamer.progress_json(v_progress)
              )
            );
          end if;
          v_progress.region_entry_serial := v_progress.region_entry_serial + 1;
        else
          v_progress.party_state := monster_tamer.full_party_state(
            v_progress.party_template_ids
          );
        end if;
        v_progress.current_region := v_target_region;
        v_progress.resume_x := v_target_region_row.spawn_x;
        v_progress.resume_y := v_target_region_row.spawn_y;
        v_progress.last_checkpoint := 'enter_region:' || v_target_region;

      when 'complete_world_node' then
        select * into v_node
        from monster_tamer.world_nodes
        where id = p_command->>'node_id'
          and rules_version = v_progress.rules_version
          and region_id = v_progress.current_region;
        if v_node.id is null
          or v_node.kind in ('exit', 'rematch')
          or abs(v_progress.resume_x - v_node.x)
            + abs(v_progress.resume_y - v_node.y) > 1
          or (
            v_node.required_ability is not null
            and not v_node.required_ability = any(v_progress.abilities)
          )
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '探索节点当前不可用'
          );
        end if;
        if v_node.refreshable then
          insert into monster_tamer.refreshable_claims (
            user_id, region_entry_serial, claim_id, claim_kind
          )
          values (
            v_user_id,
            v_progress.region_entry_serial,
            v_node.id,
            v_node.kind
          )
          on conflict do nothing;
          get diagnostics v_claimed = row_count;
          if v_claimed = 0 then
            perform api.raise_business_error(
              'MONSTER_TAMER_NODE_UNAVAILABLE',
              '本次区域探索已经使用该节点'
            );
          end if;
        else
          if v_node.id = any(v_progress.completed_node_ids) then
            perform api.raise_business_error(
              'MONSTER_TAMER_NODE_UNAVAILABLE',
              '探索节点已经完成'
            );
          end if;
          v_progress.completed_node_ids := array_append(
            v_progress.completed_node_ids,
            v_node.id
          );
        end if;
        v_progress.supply_count := least(
          999,
          v_progress.supply_count + v_node.supply_reward
        );
        if v_node.heal_bp > 0 then
          select jsonb_agg(
            jsonb_set(
              member,
              '{current_hp}',
              to_jsonb(least(
                (member->>'max_hp')::integer,
                (member->>'current_hp')::integer
                  + greatest(
                    1,
                    floor((member->>'max_hp')::numeric * v_node.heal_bp / 10000)::integer
                  )
              )),
              false
            )
            order by ordinality
          )
          into v_progress.party_state
          from jsonb_array_elements(v_progress.party_state)
          with ordinality party(member, ordinality);
        end if;
        if v_node.target_region is not null
          and not v_node.target_region = any(v_progress.unlocked_regions)
        then
          v_progress.unlocked_regions := array_append(
            v_progress.unlocked_regions,
            v_node.target_region
          );
        end if;
        if v_node.kind = 'gather' then
          v_progress.regional_boost_region := v_progress.current_region;
        end if;
        v_progress.resume_x := v_node.x;
        v_progress.resume_y := v_node.y;
        v_progress.last_checkpoint := 'world_node:' || v_node.id;

      when 'use_supply' then
        v_target_template := p_command->>'target_template_id';
        if v_progress.supply_count <= 0
          or not v_target_template = any(v_progress.party_template_ids)
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '治疗补给当前不可用'
          );
        end if;
        select jsonb_agg(
          case
            when member->>'template_id' = v_target_template then
              jsonb_set(
                member,
                '{current_hp}',
                to_jsonb(least(
                  (member->>'max_hp')::integer,
                  (member->>'current_hp')::integer
                    + greatest(
                      1,
                      floor((member->>'max_hp')::numeric * 3500 / 10000)::integer
                    )
                )),
                false
              )
            else member
          end
          order by ordinality
        )
        into v_party
        from jsonb_array_elements(v_progress.party_state)
        with ordinality party(member, ordinality);
        if (
          select (member->>'current_hp')::integer >= (member->>'max_hp')::integer
          from jsonb_array_elements(v_progress.party_state) member
          where member->>'template_id' = v_target_template
        ) then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '目标队员不需要恢复'
          );
        end if;
        v_progress.party_state := v_party;
        v_progress.supply_count := v_progress.supply_count - 1;
        v_progress.last_checkpoint := 'use_supply:' || v_target_template;

      when 'sync_revealed_cells' then
        v_progress.last_checkpoint := 'sync_revealed_cells';

      else
        perform api.raise_business_error(
          'REQUEST_INVALID',
          '未知的 Monster Tamer 检查点命令'
        );
    end case;

    v_progress.state_version := v_progress.state_version + 1;
    update monster_tamer.player_progress
    set state_version = v_progress.state_version,
        current_region = v_progress.current_region,
        resume_x = v_progress.resume_x,
        resume_y = v_progress.resume_y,
        region_entry_serial = v_progress.region_entry_serial,
        party_template_ids = v_progress.party_template_ids,
        party_state = v_progress.party_state,
        unlocked_regions = v_progress.unlocked_regions,
        abilities = v_progress.abilities,
        revealed_cells = v_progress.revealed_cells,
        completed_node_ids = v_progress.completed_node_ids,
        defeated_elite_ids = v_progress.defeated_elite_ids,
        defeated_boss_ids = v_progress.defeated_boss_ids,
        guardian_completed_at = v_progress.guardian_completed_at,
        supply_count = v_progress.supply_count,
        regional_boost_region = v_progress.regional_boost_region,
        last_checkpoint = v_progress.last_checkpoint,
        updated_at = now()
    where user_id = v_user_id
    returning * into v_progress;
    return operations.complete_command(
      p_operation_id,
      jsonb_build_object('progress', monster_tamer.progress_json(v_progress))
    );
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(
      p_operation_id,
      case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end,
      jsonb_build_object('detail', coalesce(v_detail, '{}'))
    );
  end;
end;
$$;

create or replace function monster_tamer.skill_json(
  p_template_id text,
  p_slot smallint
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'slot', sp.slot,
    'code', sp.code,
    'name', sp.name,
    'element', sp.element,
    'power_bp', sp.power_bp,
    'effect_kind', sp.effect_kind,
    'effect_value_bp', sp.effect_value_bp,
    'duration_turns', sp.duration_turns
  )
  from catalog.templates t
  join monster_tamer.chain_profiles cp on cp.chain_id = t.chain_id
  join monster_tamer.skill_profiles sp
    on sp.rules_version = cp.rules_version
   and sp.element = cp.element
   and sp.stage = t.stage
   and sp.slot = p_slot
  where t.id = p_template_id
$$;

create or replace function monster_tamer.apply_environment(
  p_combatant jsonb,
  p_environment_element text,
  p_effect_code text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_statuses jsonb := p_combatant->'statuses';
  v_max_hp integer := (p_combatant->>'max_hp')::integer;
  v_attack integer := (p_combatant->>'attack')::integer;
begin
  if p_environment_element is null
    or p_combatant->>'element' <> p_environment_element
  then
    return p_combatant;
  end if;
  case p_effect_code
    when 'forest_regen' then
      v_statuses := jsonb_set(v_statuses, '{regen_turns}', '2'::jsonb);
      v_statuses := jsonb_set(
        v_statuses,
        '{regen_amount}',
        to_jsonb(greatest(1, floor(v_max_hp::numeric * 500 / 10000)::integer))
      );
    when 'wetland_shield' then
      v_statuses := jsonb_set(
        v_statuses,
        '{shield_hp}',
        to_jsonb(greatest(1, floor(v_max_hp::numeric * 800 / 10000)::integer))
      );
    when 'highland_tailwind' then
      v_statuses := jsonb_set(v_statuses, '{attack_up_bp}', '1000'::jsonb);
    when 'cavern_charge' then
      v_statuses := jsonb_set(
        v_statuses,
        '{charge_damage}',
        to_jsonb(greatest(1, floor(v_attack::numeric * 1000 / 10000)::integer))
      );
    when 'basin_heat_guard' then
      v_statuses := jsonb_set(
        v_statuses,
        '{shield_hp}',
        to_jsonb(greatest(1, floor(v_max_hp::numeric * 500 / 10000)::integer))
      );
    else
      null;
  end case;
  return jsonb_set(p_combatant, '{statuses}', v_statuses, false);
end;
$$;

create or replace function monster_tamer.apply_skill(
  p_attacker jsonb,
  p_defender jsonb,
  p_skill jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_attacker jsonb := p_attacker;
  v_defender jsonb := p_defender;
  v_attacker_statuses jsonb := p_attacker->'statuses';
  v_defender_statuses jsonb := p_defender->'statuses';
  v_attacker_hp integer := (p_attacker->>'current_hp')::integer;
  v_attacker_max_hp integer := (p_attacker->>'max_hp')::integer;
  v_defender_hp integer := (p_defender->>'current_hp')::integer;
  v_defender_max_hp integer := (p_defender->>'max_hp')::integer;
  v_attack integer := (p_attacker->>'attack')::integer;
  v_regen_turns integer := (v_attacker_statuses->>'regen_turns')::integer;
  v_burn_turns integer := (v_attacker_statuses->>'burn_turns')::integer;
  v_weakened_bp integer := (v_attacker_statuses->>'weakened_bp')::integer;
  v_attack_up_bp integer := (v_attacker_statuses->>'attack_up_bp')::integer;
  v_charge_damage integer := (v_attacker_statuses->>'charge_damage')::integer;
  v_shield integer := (v_defender_statuses->>'shield_hp')::integer;
  v_damage integer := 0;
  v_hp_damage integer := 0;
  v_effect_kind text := p_skill->>'effect_kind';
  v_effect_value_bp integer := (p_skill->>'effect_value_bp')::integer;
  v_duration integer := (p_skill->>'duration_turns')::integer;
begin
  if v_regen_turns > 0 then
    v_attacker_hp := least(
      v_attacker_max_hp,
      v_attacker_hp + (v_attacker_statuses->>'regen_amount')::integer
    );
    v_attacker_statuses := jsonb_set(
      v_attacker_statuses,
      '{regen_turns}',
      to_jsonb(v_regen_turns - 1)
    );
  end if;
  if v_burn_turns > 0 then
    v_attacker_hp := greatest(
      0,
      v_attacker_hp - (v_attacker_statuses->>'burn_damage')::integer
    );
    v_attacker_statuses := jsonb_set(
      v_attacker_statuses,
      '{burn_turns}',
      to_jsonb(v_burn_turns - 1)
    );
  end if;
  v_attacker := jsonb_set(v_attacker, '{current_hp}', to_jsonb(v_attacker_hp));
  v_attacker := jsonb_set(
    v_attacker,
    '{down}',
    to_jsonb(v_attacker_hp <= 0)
  );
  v_attacker := jsonb_set(v_attacker, '{statuses}', v_attacker_statuses);
  if v_attacker_hp <= 0 then
    return jsonb_build_object(
      'attacker', v_attacker,
      'defender', v_defender,
      'damage', 0
    );
  end if;

  v_attack := greatest(
    1,
    floor(
      v_attack::numeric
        * (10000 + v_attack_up_bp)
        * (10000 - least(v_weakened_bp, 9000))
        / 100000000
    )::integer
  );
  v_attacker_statuses := jsonb_set(v_attacker_statuses, '{attack_up_bp}', '0'::jsonb);
  v_attacker_statuses := jsonb_set(v_attacker_statuses, '{weakened_bp}', '0'::jsonb);
  v_attacker_statuses := jsonb_set(v_attacker_statuses, '{charge_damage}', '0'::jsonb);
  if (p_skill->>'power_bp')::integer > 0 then
    v_damage := greatest(
      1,
      floor(v_attack::numeric * (p_skill->>'power_bp')::integer / 10000)::integer
        + v_charge_damage
    );
  end if;
  if v_damage > 0 and v_shield > 0 then
    v_defender_statuses := jsonb_set(
      v_defender_statuses,
      '{shield_hp}',
      to_jsonb(greatest(0, v_shield - v_damage))
    );
    v_damage := greatest(0, v_damage - v_shield);
  end if;
  v_hp_damage := least(v_defender_hp, v_damage);
  v_defender_hp := greatest(0, v_defender_hp - v_damage);

  case v_effect_kind
    when 'heal_self' then
      v_attacker_hp := least(
        v_attacker_max_hp,
        v_attacker_hp
          + greatest(
            1,
            floor(v_attacker_max_hp::numeric * v_effect_value_bp / 10000)::integer
          )
      );
    when 'shield_self' then
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{shield_hp}',
        to_jsonb(
          (v_attacker_statuses->>'shield_hp')::integer
            + greatest(
              1,
              floor(v_attacker_max_hp::numeric * v_effect_value_bp / 10000)::integer
            )
        )
      );
    when 'burn_enemy' then
      v_defender_statuses := jsonb_set(
        v_defender_statuses,
        '{burn_turns}',
        to_jsonb(greatest((v_defender_statuses->>'burn_turns')::integer, v_duration))
      );
      v_defender_statuses := jsonb_set(
        v_defender_statuses,
        '{burn_damage}',
        to_jsonb(greatest(1, floor(v_attack::numeric * v_effect_value_bp / 10000)::integer))
      );
    when 'attack_up_self' then
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{attack_up_bp}',
        to_jsonb(greatest((v_attacker_statuses->>'attack_up_bp')::integer, v_effect_value_bp))
      );
    when 'drain_self' then
      v_attacker_hp := least(
        v_attacker_max_hp,
        v_attacker_hp
          + greatest(1, floor(v_hp_damage::numeric * v_effect_value_bp / 10000)::integer)
      );
    when 'regen_self' then
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{regen_turns}',
        to_jsonb(v_duration)
      );
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{regen_amount}',
        to_jsonb(
          greatest(
            1,
            floor(v_attacker_max_hp::numeric * v_effect_value_bp / 10000)::integer
          )
        )
      );
    when 'weaken_enemy' then
      v_defender_statuses := jsonb_set(
        v_defender_statuses,
        '{weakened_bp}',
        to_jsonb(greatest((v_defender_statuses->>'weakened_bp')::integer, v_effect_value_bp))
      );
    when 'charge_self' then
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{charge_damage}',
        to_jsonb(
          (v_attacker_statuses->>'charge_damage')::integer
            + greatest(1, floor(v_attack::numeric * v_effect_value_bp / 10000)::integer)
        )
      );
    else
      null;
  end case;

  v_attacker := jsonb_set(v_attacker, '{current_hp}', to_jsonb(v_attacker_hp));
  v_attacker := jsonb_set(v_attacker, '{down}', to_jsonb(v_attacker_hp <= 0));
  v_attacker := jsonb_set(v_attacker, '{statuses}', v_attacker_statuses);
  v_defender := jsonb_set(v_defender, '{current_hp}', to_jsonb(v_defender_hp));
  v_defender := jsonb_set(v_defender, '{down}', to_jsonb(v_defender_hp <= 0));
  v_defender := jsonb_set(v_defender, '{statuses}', v_defender_statuses);
  return jsonb_build_object(
    'attacker', v_attacker,
    'defender', v_defender,
    'damage', v_hp_damage
  );
end;
$$;

create or replace function api.monster_tamer_battle(
  p_session_id uuid,
  p_operation_id uuid,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_progress monster_tamer.player_progress%rowtype;
  v_battle monster_tamer.battles%rowtype;
  v_encounter monster_tamer.encounter_definitions%rowtype;
  v_region monster_tamer.regions%rowtype;
  v_source_node monster_tamer.world_nodes%rowtype;
  v_command text := p_command->>'command';
  v_source_node_id text;
  v_party jsonb;
  v_enemy jsonb;
  v_state jsonb;
  v_actor jsonb;
  v_active_template text;
  v_skill jsonb;
  v_enemy_skill jsonb;
  v_resolution jsonb;
  v_scale_bp integer;
  v_average_power numeric;
  v_enemy_power integer;
  v_enemy_slot smallint;
  v_completed_turn integer;
  v_mechanic_state jsonb := '{}'::jsonb;
  v_mechanic_notice text;
  v_environment_element text;
  v_environment_effect_code text;
  v_regional_boost boolean := false;
  v_extra_damage integer;
  v_statuses jsonb;
  v_guardian_index integer;
  v_guardian_elements text[] := array['water', 'fire', 'wood', 'wind', 'lightning'];
  v_guardian_effects text[] := array[
    'wetland_shield', 'basin_heat_guard', 'forest_regen',
    'highland_tailwind', 'cavern_charge'
  ];
  v_terminal text := 'ongoing';
  v_new_status text := 'active';
  v_first_boss boolean := false;
  v_is_rematch boolean := false;
  v_return_x smallint;
  v_return_y smallint;
  v_detail text;
begin
  v_operation := operations.begin_command(
    p_session_id,
    'monster_tamer.battle',
    p_operation_id,
    p_command
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform monster_tamer.ensure_progress(v_user_id);
    select * into v_progress
    from monster_tamer.player_progress
    where user_id = v_user_id
    for update;

    if v_command = 'start' then
      if v_progress.state_version <> (p_command->>'expected_progress_version')::bigint then
        perform api.raise_business_error(
          'MONSTER_TAMER_STATE_CONFLICT',
          '游戏进度版本已经更新'
        );
      end if;
      if exists (
        select 1
        from monster_tamer.battles
        where user_id = v_user_id
          and result_acknowledged_at is null
      ) then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_ALREADY_ACTIVE',
          '已有进行中或待确认的战斗'
        );
      end if;
      select * into v_encounter
      from monster_tamer.encounter_definitions
      where id = p_command->>'encounter_id'
        and rules_version = v_progress.rules_version
        and region_id = v_progress.current_region;
      v_source_node_id := p_command->>'source_node_id';
      if v_encounter.id is null
        or v_progress.current_region = 'camp'
        or not v_encounter.region_id = any(v_progress.unlocked_regions)
        or (
          v_encounter.kind = 'guardian'
          and not array[
            'vine_bridge', 'tidal_walk', 'wind_glide',
            'lightning_charge', 'heat_shield'
          ]::text[] <@ v_progress.abilities
        )
      then
        perform api.raise_business_error(
          'MONSTER_TAMER_ENCOUNTER_UNAVAILABLE',
          '遭遇当前不可用'
        );
      end if;
      v_is_rematch := (
        v_encounter.kind = 'boss'
        and v_encounter.id = any(v_progress.defeated_boss_ids)
      ) or (
        v_encounter.kind = 'guardian'
        and v_progress.guardian_completed_at is not null
      );
      if v_is_rematch then
        select n.* into v_source_node
        from monster_tamer.world_nodes n
        join monster_tamer.rematch_nodes rematch on rematch.node_id = n.id
        where n.id = v_source_node_id
          and n.rules_version = v_progress.rules_version
          and n.region_id = v_progress.current_region
          and n.kind = 'rematch'
          and rematch.encounter_id = v_encounter.id;
        if v_source_node.id is null
          or abs(v_progress.resume_x - v_source_node.x)
            + abs(v_progress.resume_y - v_source_node.y) > 1
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_ENCOUNTER_UNAVAILABLE',
            '必须在已解锁的再战祭坛旁开始首领再战'
          );
        end if;
        v_return_x := v_source_node.x;
        v_return_y := v_source_node.y;
      else
        if v_source_node_id is not null
          or not monster_tamer.encounter_available(v_progress, v_encounter)
          or abs(v_progress.resume_x - v_encounter.x)
            + abs(v_progress.resume_y - v_encounter.y) > v_encounter.engage_radius
          or not monster_tamer.encounter_reachable(v_progress, v_encounter)
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_ENCOUNTER_UNAVAILABLE',
            '必须从服务器记录的可通行位置接近该遭遇'
          );
        end if;
        v_return_x := v_encounter.x;
        v_return_y := v_encounter.y;
      end if;
      if not monster_tamer.lock_and_validate_team(
        v_user_id,
        v_progress.party_template_ids
      ) then
        update monster_tamer.player_progress
        set current_region = 'camp',
            resume_x = (
              select r.spawn_x
              from monster_tamer.regions r
              where r.id = 'camp'
                and r.rules_version = v_progress.rules_version
            ),
            resume_y = (
              select r.spawn_y
              from monster_tamer.regions r
              where r.id = 'camp'
                and r.rules_version = v_progress.rules_version
            ),
            party_template_ids = '{}'::text[],
            party_state = '[]'::jsonb,
            state_version = state_version + 1,
            last_checkpoint = 'team_reselection_required',
            updated_at = now()
        where user_id = v_user_id
        returning * into v_progress;
        return operations.fail_command(
          p_operation_id,
          'MONSTER_TAMER_TEAM_INVALID',
          jsonb_build_object(
            'message', '开始战斗前队伍已失效，已返回中心营地',
            'progress', monster_tamer.progress_json(v_progress)
          )
        );
      end if;
      if not exists (
        select 1
        from jsonb_array_elements(v_progress.party_state) member
        where (member->>'current_hp')::integer > 0
      ) then
        perform api.raise_business_error(
          'MONSTER_TAMER_TEAM_INVALID',
          '队伍没有可战斗成员'
        );
      end if;
      select * into v_region
      from monster_tamer.regions
      where id = v_progress.current_region;
      v_regional_boost := v_progress.regional_boost_region = v_progress.current_region;
      if v_encounter.mechanic_code = 'guardian_element_cycle' then
        v_environment_element := v_guardian_elements[1];
        v_environment_effect_code := v_guardian_effects[1];
        v_mechanic_state := jsonb_build_object('guardian_index', 0);
      else
        v_environment_element := v_region.element;
        v_environment_effect_code := v_region.environment_effect_code;
        v_mechanic_state := case
          when v_encounter.mechanic_code = 'wetland_tide_shield'
            then jsonb_build_object('tide_shield_triggered', false)
          when v_encounter.mechanic_code = 'cavern_thunder_cycle'
            then jsonb_build_object('thunder_charged', false)
          else '{}'::jsonb
        end;
      end if;
      v_mechanic_notice := case v_encounter.mechanic_code
        when 'forest_regrowth' then '森之守护者每 3 回合恢复生命'
        when 'wetland_tide_shield' then '潮汐守护者首次降至半血时获得潮盾'
        when 'highland_gust_followup' then '高原守护者每 3 回合追加风击'
        when 'cavern_thunder_cycle' then '洞窟守护者每 3 回合蓄雷并在下一回合释放'
        when 'basin_scorch' then '熔火守护者每 2 回合施加灼烧'
        when 'guardian_element_cycle' then '最终守护者从水环境开始逐回合轮换五种属性'
        else null
      end;
      select avg(t.combat_power), enemy.combat_power
      into v_average_power, v_enemy_power
      from unnest(v_progress.party_template_ids) selected(template_id)
      join catalog.templates t on t.id = selected.template_id
      cross join catalog.templates enemy
      where enemy.id = v_encounter.template_id
      group by enemy.combat_power;
      v_scale_bp := greatest(
        v_region.difficulty_min_bp,
        least(
          v_region.difficulty_max_bp,
          10000
            + floor(
              (v_average_power - v_enemy_power)::numeric
                * 1000
                / greatest(v_enemy_power, 1)
            )::integer
        )
      );
      select jsonb_agg(
        monster_tamer.apply_environment(
          monster_tamer.apply_attack_boost(
            monster_tamer.combatant_json(
              member->>'template_id',
              (member->>'current_hp')::integer
            ),
            case when v_regional_boost then 1000 else 0 end
          ),
          v_environment_element,
          v_environment_effect_code
        )
        order by ordinality
      )
      into v_party
      from jsonb_array_elements(v_progress.party_state)
      with ordinality party(member, ordinality);
      v_enemy := monster_tamer.apply_environment(
        monster_tamer.combatant_json(v_encounter.template_id, null, v_scale_bp),
        v_environment_element,
        v_environment_effect_code
      );
      select member->>'template_id' into v_active_template
      from jsonb_array_elements(v_party) with ordinality party(member, ordinality)
      where (member->>'current_hp')::integer > 0
      order by ordinality
      limit 1;
      v_state := jsonb_build_object(
        'turn', 0,
        'active_template_id', v_active_template,
        'party', v_party,
        'enemy', v_enemy,
        'environment', jsonb_build_object(
          'element', v_environment_element,
          'effect_code', v_environment_effect_code
        ),
        'mechanic_state', v_mechanic_state,
        'mechanic_notice', v_mechanic_notice,
        'return_position', jsonb_build_object(
          'x', v_return_x,
          'y', v_return_y
        ),
        'rematch', v_is_rematch
      );
      insert into monster_tamer.battles (
        id, user_id, encounter_id, region_entry_serial, state
      )
      values (
        p_operation_id,
        v_user_id,
        v_encounter.id,
        v_progress.region_entry_serial,
        v_state
      )
      returning * into v_battle;
      if v_regional_boost then
        update monster_tamer.player_progress
        set regional_boost_region = null,
            state_version = state_version + 1,
            last_checkpoint = 'regional_boost_consumed:' || v_progress.current_region,
            updated_at = now()
        where user_id = v_user_id
        returning * into v_progress;
      end if;

    elsif v_command = 'acknowledge' then
      select * into v_battle
      from monster_tamer.battles
      where id = (p_command->>'battle_id')::uuid
        and user_id = v_user_id
      for update;
      if v_battle.id is null
        or v_battle.status = 'active'
        or v_battle.result_acknowledged_at is not null
      then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_NOT_FOUND',
          '待确认的战斗结果不存在'
        );
      end if;
      if v_battle.state_version
        <> (p_command->>'expected_battle_version')::bigint
      then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_STATE_CONFLICT',
          '战斗版本已经更新'
        );
      end if;
      update monster_tamer.battles
      set result_acknowledged_at = now(),
          updated_at = now()
      where id = v_battle.id
      returning * into v_battle;
      v_terminal := v_battle.status;

    elsif v_command = 'use_skill' then
      select * into v_battle
      from monster_tamer.battles
      where id = (p_command->>'battle_id')::uuid
        and user_id = v_user_id
      for update;
      if v_battle.id is null or v_battle.status <> 'active' then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_NOT_FOUND',
          '进行中的战斗不存在'
        );
      end if;
      if v_battle.state_version <> (p_command->>'expected_battle_version')::bigint then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_STATE_CONFLICT',
          '战斗版本已经更新'
        );
      end if;
      if v_battle.state->>'active_template_id' <> p_command->>'actor_template_id' then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_STATE_CONFLICT',
          '当前出战队员已经变化'
        );
      end if;
      select * into v_encounter
      from monster_tamer.encounter_definitions
      where id = v_battle.encounter_id;
      v_party := v_battle.state->'party';
      v_enemy := v_battle.state->'enemy';
      v_mechanic_state := coalesce(v_battle.state->'mechanic_state', '{}'::jsonb);
      v_mechanic_notice := v_battle.state->>'mechanic_notice';
      v_environment_element := v_battle.state->'environment'->>'element';
      v_environment_effect_code := v_battle.state->'environment'->>'effect_code';
      v_completed_turn := (v_battle.state->>'turn')::integer + 1;
      v_active_template := v_battle.state->>'active_template_id';
      select member into v_actor
      from jsonb_array_elements(v_party) member
      where member->>'template_id' = v_active_template;
      v_skill := monster_tamer.skill_json(
        v_active_template,
        (p_command->>'skill_slot')::smallint
      );
      if v_actor is null or v_skill is null then
        perform api.raise_business_error('REQUEST_INVALID', '战斗技能无效');
      end if;

      v_resolution := monster_tamer.apply_skill(v_actor, v_enemy, v_skill);
      v_actor := v_resolution->'attacker';
      v_enemy := v_resolution->'defender';
      select jsonb_agg(
        case
          when member->>'template_id' = v_active_template then v_actor
          else member
        end
        order by ordinality
      )
      into v_party
      from jsonb_array_elements(v_party)
      with ordinality party(member, ordinality);
      if v_encounter.mechanic_code = 'wetland_tide_shield'
        and (v_enemy->>'current_hp')::integer > 0
        and (v_enemy->>'current_hp')::integer * 2 <= (v_enemy->>'max_hp')::integer
        and not coalesce(
          (v_mechanic_state->>'tide_shield_triggered')::boolean,
          false
        )
      then
        v_statuses := v_enemy->'statuses';
        v_statuses := jsonb_set(
          v_statuses,
          '{shield_hp}',
          to_jsonb(
            (v_statuses->>'shield_hp')::integer
              + greatest(
                1,
                floor((v_enemy->>'max_hp')::numeric * 2000 / 10000)::integer
              )
          )
        );
        v_enemy := jsonb_set(v_enemy, '{statuses}', v_statuses);
        v_mechanic_state := jsonb_set(
          v_mechanic_state,
          '{tide_shield_triggered}',
          'true'::jsonb
        );
        v_mechanic_notice := '潮汐守护者生命首次降至一半，获得 20% 最大生命潮盾';
      end if;
      if (v_actor->>'current_hp')::integer <= 0 then
        select member->>'template_id' into v_active_template
        from jsonb_array_elements(v_party) with ordinality party(member, ordinality)
        where (member->>'current_hp')::integer > 0
        order by ordinality
        limit 1;
      end if;
      if (v_enemy->>'current_hp')::integer <= 0 then
        v_terminal := 'won';
        v_new_status := 'won';
      elsif v_active_template is null then
        v_terminal := 'lost';
        v_new_status := 'lost';
      else
        select member into v_actor
        from jsonb_array_elements(v_party) member
        where member->>'template_id' = v_active_template;
        v_enemy_slot := (((v_battle.state->>'turn')::integer % 3) + 1)::smallint;
        v_enemy_skill := monster_tamer.skill_json(
          v_encounter.template_id,
          v_enemy_slot
        );
        v_resolution := monster_tamer.apply_skill(
          v_enemy,
          v_actor,
          v_enemy_skill
        );
        v_enemy := v_resolution->'attacker';
        v_actor := v_resolution->'defender';
        select jsonb_agg(
          case
            when member->>'template_id' = v_active_template then v_actor
            else member
          end
          order by ordinality
        )
        into v_party
        from jsonb_array_elements(v_party)
        with ordinality party(member, ordinality);
        if (v_enemy->>'current_hp')::integer <= 0 then
          v_terminal := 'won';
          v_new_status := 'won';
        elsif (v_actor->>'current_hp')::integer <= 0 then
          select member->>'template_id' into v_active_template
          from jsonb_array_elements(v_party) with ordinality party(member, ordinality)
          where (member->>'current_hp')::integer > 0
          order by ordinality
          limit 1;
          if v_active_template is null then
            v_terminal := 'lost';
            v_new_status := 'lost';
          end if;
        end if;
      end if;

      if v_terminal = 'ongoing' then
        case v_encounter.mechanic_code
          when 'forest_regrowth' then
            if v_completed_turn % 3 = 0 then
              v_enemy := jsonb_set(
                v_enemy,
                '{current_hp}',
                to_jsonb(
                  least(
                    (v_enemy->>'max_hp')::integer,
                    (v_enemy->>'current_hp')::integer
                      + greatest(
                        1,
                        floor((v_enemy->>'max_hp')::numeric * 800 / 10000)::integer
                      )
                  )
                )
              );
              v_mechanic_notice := '森之守护者触发再生，恢复 8% 最大生命';
            end if;

          when 'highland_gust_followup' then
            if v_completed_turn % 3 = 0 then
              select member into v_actor
              from jsonb_array_elements(v_party) member
              where member->>'template_id' = v_active_template;
              v_extra_damage := greatest(
                1,
                floor((v_enemy->>'attack')::numeric * 3500 / 10000)::integer
              );
              v_actor := monster_tamer.apply_raw_damage(v_actor, v_extra_damage);
              select jsonb_agg(
                case
                  when member->>'template_id' = v_active_template then v_actor
                  else member
                end
                order by ordinality
              )
              into v_party
              from jsonb_array_elements(v_party)
              with ordinality party(member, ordinality);
              v_mechanic_notice := '高原守护者追加一次 35% 攻击力的风击';
              if (v_actor->>'current_hp')::integer <= 0 then
                select member->>'template_id' into v_active_template
                from jsonb_array_elements(v_party)
                with ordinality party(member, ordinality)
                where (member->>'current_hp')::integer > 0
                order by ordinality
                limit 1;
                if v_active_template is null then
                  v_terminal := 'lost';
                  v_new_status := 'lost';
                end if;
              end if;
            end if;

          when 'cavern_thunder_cycle' then
            if coalesce((v_mechanic_state->>'thunder_charged')::boolean, false) then
              select member into v_actor
              from jsonb_array_elements(v_party) member
              where member->>'template_id' = v_active_template;
              v_extra_damage := greatest(
                1,
                floor((v_enemy->>'attack')::numeric * 7000 / 10000)::integer
              );
              v_actor := monster_tamer.apply_raw_damage(v_actor, v_extra_damage);
              select jsonb_agg(
                case
                  when member->>'template_id' = v_active_template then v_actor
                  else member
                end
                order by ordinality
              )
              into v_party
              from jsonb_array_elements(v_party)
              with ordinality party(member, ordinality);
              v_mechanic_state := jsonb_set(
                v_mechanic_state,
                '{thunder_charged}',
                'false'::jsonb
              );
              v_mechanic_notice := '洞窟守护者释放蓄雷，造成 70% 攻击力伤害';
              if (v_actor->>'current_hp')::integer <= 0 then
                select member->>'template_id' into v_active_template
                from jsonb_array_elements(v_party)
                with ordinality party(member, ordinality)
                where (member->>'current_hp')::integer > 0
                order by ordinality
                limit 1;
                if v_active_template is null then
                  v_terminal := 'lost';
                  v_new_status := 'lost';
                end if;
              end if;
            elsif v_completed_turn % 3 = 0 then
              v_mechanic_state := jsonb_set(
                v_mechanic_state,
                '{thunder_charged}',
                'true'::jsonb
              );
              v_mechanic_notice := '洞窟守护者开始蓄雷，将在下一回合释放';
            end if;

          when 'basin_scorch' then
            if v_completed_turn % 2 = 0 then
              select member into v_actor
              from jsonb_array_elements(v_party) member
              where member->>'template_id' = v_active_template;
              v_statuses := v_actor->'statuses';
              v_statuses := jsonb_set(
                v_statuses,
                '{burn_turns}',
                to_jsonb(greatest((v_statuses->>'burn_turns')::integer, 2))
              );
              v_statuses := jsonb_set(
                v_statuses,
                '{burn_damage}',
                to_jsonb(
                  greatest(
                    (v_statuses->>'burn_damage')::integer,
                    greatest(
                      1,
                      floor((v_enemy->>'attack')::numeric * 700 / 10000)::integer
                    )
                  )
                )
              );
              v_actor := jsonb_set(v_actor, '{statuses}', v_statuses);
              select jsonb_agg(
                case
                  when member->>'template_id' = v_active_template then v_actor
                  else member
                end
                order by ordinality
              )
              into v_party
              from jsonb_array_elements(v_party)
              with ordinality party(member, ordinality);
              v_mechanic_notice := '熔火守护者施加持续 2 次行动的灼烧';
            end if;

          when 'guardian_element_cycle' then
            v_guardian_index := (
              coalesce((v_mechanic_state->>'guardian_index')::integer, 0) + 1
            ) % 5;
            v_environment_element := v_guardian_elements[v_guardian_index + 1];
            v_environment_effect_code := v_guardian_effects[v_guardian_index + 1];
            v_mechanic_state := jsonb_set(
              v_mechanic_state,
              '{guardian_index}',
              to_jsonb(v_guardian_index)
            );
            select jsonb_agg(
              monster_tamer.apply_environment(
                member,
                v_environment_element,
                v_environment_effect_code
              )
              order by ordinality
            )
            into v_party
            from jsonb_array_elements(v_party)
            with ordinality party(member, ordinality);
            v_enemy := monster_tamer.apply_environment(
              v_enemy,
              v_environment_element,
              v_environment_effect_code
            );
            v_mechanic_notice := '最终守护者将环境切换为'
              || case v_environment_element
                when 'water' then '水'
                when 'fire' then '火'
                when 'wood' then '木'
                when 'wind' then '风'
                else '雷'
              end
              || '属性';

          else
            null;
        end case;
      end if;

      v_state := jsonb_build_object(
        'turn', v_completed_turn,
        'active_template_id', v_active_template,
        'party', v_party,
        'enemy', v_enemy,
        'environment', jsonb_build_object(
          'element', v_environment_element,
          'effect_code', v_environment_effect_code
        ),
        'mechanic_state', v_mechanic_state,
        'mechanic_notice', v_mechanic_notice,
        'return_position', v_battle.state->'return_position',
        'rematch', v_battle.state->'rematch'
      );
      update monster_tamer.battles
      set state = v_state,
          state_version = state_version + 1,
          status = v_new_status,
          updated_at = now(),
          completed_at = case when v_new_status = 'active' then null else now() end
      where id = v_battle.id
      returning * into v_battle;

      if v_terminal = 'won' then
        v_progress.resume_x := (
          v_battle.state->'return_position'->>'x'
        )::smallint;
        v_progress.resume_y := (
          v_battle.state->'return_position'->>'y'
        )::smallint;
        select jsonb_agg(
          jsonb_build_object(
            'template_id', member->>'template_id',
            'current_hp', (member->>'current_hp')::integer,
            'max_hp', (member->>'max_hp')::integer
          )
          order by ordinality
        )
        into v_progress.party_state
        from jsonb_array_elements(v_party)
        with ordinality party(member, ordinality);
        v_progress.supply_count := least(
          999,
          v_progress.supply_count + v_encounter.supply_reward
        );
        if v_encounter.kind = 'normal' then
          insert into monster_tamer.refreshable_claims (
            user_id, region_entry_serial, claim_id, claim_kind
          )
          values (
            v_user_id,
            v_battle.region_entry_serial,
            v_encounter.id,
            'encounter'
          )
          on conflict do nothing;
        elsif v_encounter.kind = 'elite'
          and not v_encounter.id = any(v_progress.defeated_elite_ids)
        then
          v_progress.defeated_elite_ids := array_append(
            v_progress.defeated_elite_ids,
            v_encounter.id
          );
        elsif v_encounter.kind = 'boss' then
          v_first_boss := not v_encounter.id = any(v_progress.defeated_boss_ids);
          if v_first_boss then
            v_progress.defeated_boss_ids := array_append(
              v_progress.defeated_boss_ids,
              v_encounter.id
            );
            if v_encounter.reward_ability is not null
              and not v_encounter.reward_ability = any(v_progress.abilities)
            then
              v_progress.abilities := array_append(
                v_progress.abilities,
                v_encounter.reward_ability
              );
            end if;
            if v_encounter.id = 'boss_luminous_forest'
              and not 'windswept_highlands' = any(v_progress.unlocked_regions)
            then
              v_progress.unlocked_regions := array_append(
                v_progress.unlocked_regions,
                'windswept_highlands'
              );
            elsif v_encounter.id = 'boss_tidal_wetland'
              and not 'crystal_cavern' = any(v_progress.unlocked_regions)
            then
              v_progress.unlocked_regions := array_append(
                v_progress.unlocked_regions,
                'crystal_cavern'
              );
            elsif v_encounter.id = 'boss_molten_basin'
              and not 'guardian_lair' = any(v_progress.unlocked_regions)
            then
              v_progress.unlocked_regions := array_append(
                v_progress.unlocked_regions,
                'guardian_lair'
              );
            end if;
            if 'boss_windswept_highlands' = any(v_progress.defeated_boss_ids)
              and 'boss_crystal_cavern' = any(v_progress.defeated_boss_ids)
              and not 'molten_basin' = any(v_progress.unlocked_regions)
            then
              v_progress.unlocked_regions := array_append(
                v_progress.unlocked_regions,
                'molten_basin'
              );
            end if;
          end if;
        elsif v_encounter.kind = 'guardian'
          and v_progress.guardian_completed_at is null
        then
          v_progress.guardian_completed_at := now();
        end if;
        if v_encounter.kind in ('normal', 'elite') then
          v_progress.regional_boost_region := v_progress.current_region;
        end if;
        v_progress.last_checkpoint := 'battle_won:' || v_encounter.id;
        v_progress.state_version := v_progress.state_version + 1;
      elsif v_terminal = 'lost' then
        v_progress.current_region := 'camp';
        select r.spawn_x, r.spawn_y
        into v_progress.resume_x, v_progress.resume_y
        from monster_tamer.regions r
        where r.id = 'camp'
          and r.rules_version = v_progress.rules_version;
        v_progress.party_state := monster_tamer.full_party_state(
          v_progress.party_template_ids
        );
        v_progress.last_checkpoint := 'battle_lost:' || v_encounter.id;
        v_progress.state_version := v_progress.state_version + 1;
      end if;

      if v_terminal <> 'ongoing' then
        update monster_tamer.player_progress
        set state_version = v_progress.state_version,
            current_region = v_progress.current_region,
            resume_x = v_progress.resume_x,
            resume_y = v_progress.resume_y,
            region_entry_serial = v_progress.region_entry_serial,
            party_template_ids = v_progress.party_template_ids,
            party_state = v_progress.party_state,
            unlocked_regions = v_progress.unlocked_regions,
            abilities = v_progress.abilities,
            revealed_cells = v_progress.revealed_cells,
            completed_node_ids = v_progress.completed_node_ids,
            defeated_elite_ids = v_progress.defeated_elite_ids,
            defeated_boss_ids = v_progress.defeated_boss_ids,
            guardian_completed_at = v_progress.guardian_completed_at,
            supply_count = v_progress.supply_count,
            regional_boost_region = v_progress.regional_boost_region,
            last_checkpoint = v_progress.last_checkpoint,
            updated_at = now()
        where user_id = v_user_id
        returning * into v_progress;
      end if;
    else
      perform api.raise_business_error(
        'REQUEST_INVALID',
        '未知的 Monster Tamer 战斗命令'
      );
    end if;

    return operations.complete_command(
      p_operation_id,
      jsonb_build_object(
        'battle', monster_tamer.battle_json(v_battle),
        'progress', monster_tamer.progress_json(v_progress),
        'terminal', v_terminal
      )
    );
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(
      p_operation_id,
      case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end,
      jsonb_build_object('detail', coalesce(v_detail, '{}'))
    );
  end;
end;
$$;
