begin;

comment on table inventory.evolution_rules is
  'Pokemon-style evolution rules. Consumes three copies of the same source collectible plus K-coin; success creates the configured target collectible template, failure returns only the highest-level main item.';

update inventory.evolution_rules er
set active = false,
    metadata = er.metadata || jsonb_build_object(
      'deactivated_reason', 'same_template_replaced_by_pokemon_style_defaults',
      'deactivated_at', now(),
      'migration', 'phase6_pokemon_style_evolution_defaults'
    ),
    updated_at = now()
where er.active = true
  and er.from_template_id = er.to_template_id;

create temp table _default_evolution_chain_definitions (
  code text primary key,
  display_name text not null,
  description text not null,
  series_slug text not null,
  sort_order integer not null
) on commit drop;

insert into _default_evolution_chain_definitions (
  code,
  display_name,
  description,
  series_slug,
  sort_order
) values
  ('forest_guardians_default', 'Forest Guardians Evolution', 'Default Forest Guardians A to B to C evolution chain.', 'forest_guardians', 10),
  ('moon_crown_default', 'Moon Crown Evolution', 'Default Moon Crown A to B to C evolution chain.', 'moon_crown', 20),
  ('crystal_cove_default', 'Crystal Cove Evolution', 'Default Crystal Cove A to B to C evolution chain.', 'crystal_cove', 30),
  ('dragon_fire_default', 'Dragon Fire Evolution', 'Default Dragon Fire A to B to C evolution chain.', 'dragon_fire', 40);

insert into inventory.evolution_chains (
  code,
  display_name,
  description,
  series_id,
  status,
  sort_order,
  metadata
)
select
  chain_def.code,
  chain_def.display_name,
  chain_def.description,
  series.id,
  'active',
  chain_def.sort_order,
  jsonb_build_object(
    'source_type', 'default_seed',
    'migration', 'phase6_pokemon_style_evolution_defaults',
    'series_slug', chain_def.series_slug
  )
from _default_evolution_chain_definitions chain_def
join catalog.series series on series.slug = chain_def.series_slug
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    series_id = excluded.series_id,
    status = 'active',
    sort_order = excluded.sort_order,
    metadata = inventory.evolution_chains.metadata || excluded.metadata,
    updated_at = now();

create temp table _default_evolution_steps on commit drop as
with step_definitions (
  chain_code,
  step_index,
  from_template_slug,
  to_template_slug,
  cost_kcoin,
  success_rate_bps
) as (
  values
    ('forest_guardians_default', 1, 'forest_sproutling', 'forest_ranger', 100::numeric(38,0), 8000),
    ('forest_guardians_default', 2, 'forest_ranger', 'ancient_leaf_sentinel', 300::numeric(38,0), 7000),
    ('moon_crown_default', 1, 'mooncap_bard', 'moonlit_minstrel', 100::numeric(38,0), 8000),
    ('moon_crown_default', 2, 'moonlit_minstrel', 'moon_crown_guardian', 300::numeric(38,0), 7000),
    ('crystal_cove_default', 1, 'crystal_otter', 'tideglass_otter', 100::numeric(38,0), 8000),
    ('crystal_cove_default', 2, 'tideglass_otter', 'prism_tide_oracle', 300::numeric(38,0), 7000),
    ('dragon_fire_default', 1, 'ember_whelp', 'blazewing_drake', 300::numeric(38,0), 7000),
    ('dragon_fire_default', 2, 'blazewing_drake', 'inferno_crown_dragon', 800::numeric(38,0), 6000)
)
select
  chains.id as chain_id,
  steps.step_index,
  source_template.id as from_template_id,
  source_form.id as from_form_id,
  target_template.id as to_template_id,
  target_form.id as to_form_id,
  3::integer as required_count,
  steps.cost_kcoin,
  steps.success_rate_bps,
  steps.chain_code,
  steps.from_template_slug,
  steps.to_template_slug
from step_definitions steps
join inventory.evolution_chains chains on chains.code = steps.chain_code
join catalog.collectible_templates source_template
  on source_template.slug = steps.from_template_slug
join catalog.collectible_forms source_form
  on source_form.template_id = source_template.id
 and source_form.form_index = 1
join catalog.collectible_templates target_template
  on target_template.slug = steps.to_template_slug
join catalog.collectible_forms target_form
  on target_form.template_id = target_template.id
 and target_form.form_index = 1
where source_template.release_status = 'active'
  and target_template.release_status = 'active'
  and source_template.evolvable = true;

do $$
declare
  v_known_template_count integer;
  v_resolved_step_count integer;
begin
  select count(*)::integer
  into v_known_template_count
  from catalog.collectible_templates
  where slug in (
    'forest_sproutling',
    'forest_ranger',
    'ancient_leaf_sentinel',
    'mooncap_bard',
    'moonlit_minstrel',
    'moon_crown_guardian',
    'crystal_otter',
    'tideglass_otter',
    'prism_tide_oracle',
    'ember_whelp',
    'blazewing_drake',
    'inferno_crown_dragon'
  );

  select count(*)::integer
  into v_resolved_step_count
  from _default_evolution_steps;

  if v_known_template_count > 0 and v_resolved_step_count <> 8 then
    raise exception 'DEFAULT_EVOLUTION_CHAIN_INCOMPLETE' using errcode = 'P0001';
  end if;
end;
$$;

update inventory.evolution_chain_steps steps
set active = false,
    metadata = steps.metadata || jsonb_build_object(
      'deactivated_reason', 'default_pokemon_style_source_replaced',
      'deactivated_at', now(),
      'migration', 'phase6_pokemon_style_evolution_defaults'
    ),
    updated_at = now()
from _default_evolution_steps default_steps
where steps.active = true
  and steps.from_template_id = default_steps.from_template_id
  and steps.from_form_id = default_steps.from_form_id
  and steps.chain_id <> default_steps.chain_id;

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
select
  chain_id,
  step_index,
  from_template_id,
  from_form_id,
  to_template_id,
  to_form_id,
  required_count,
  cost_kcoin,
  success_rate_bps,
  true,
  jsonb_build_object(
    'source_type', 'default_seed',
    'migration', 'phase6_pokemon_style_evolution_defaults',
    'chain_code', chain_code,
    'from_template_slug', from_template_slug,
    'to_template_slug', to_template_slug
  )
from _default_evolution_steps
on conflict (chain_id, step_index) do update
set from_template_id = excluded.from_template_id,
    from_form_id = excluded.from_form_id,
    to_template_id = excluded.to_template_id,
    to_form_id = excluded.to_form_id,
    required_count = excluded.required_count,
    cost_kcoin = excluded.cost_kcoin,
    success_rate_bps = excluded.success_rate_bps,
    active = true,
    metadata = inventory.evolution_chain_steps.metadata || excluded.metadata,
    updated_at = now();

update inventory.evolution_chain_steps steps
set active = false,
    metadata = steps.metadata || jsonb_build_object(
      'deactivated_reason', 'default_pokemon_style_step_removed',
      'deactivated_at', now(),
      'migration', 'phase6_pokemon_style_evolution_defaults'
    ),
    updated_at = now()
from inventory.evolution_chains chains
where steps.chain_id = chains.id
  and chains.code in (select code from _default_evolution_chain_definitions)
  and not exists (
    select 1
    from _default_evolution_steps default_steps
    where default_steps.chain_id = steps.chain_id
      and default_steps.step_index = steps.step_index
  );

update inventory.evolution_rules rules
set active = false,
    metadata = rules.metadata || jsonb_build_object(
      'deactivated_reason', 'source_replaced_by_default_pokemon_style_chain',
      'deactivated_at', now(),
      'migration', 'phase6_pokemon_style_evolution_defaults'
    ),
    updated_at = now()
from inventory.evolution_chain_steps steps
join _default_evolution_steps default_steps
  on default_steps.chain_id = steps.chain_id
 and default_steps.step_index = steps.step_index
where rules.active = true
  and rules.from_template_id = steps.from_template_id
  and rules.from_form_id = steps.from_form_id
  and (
    rules.evolution_chain_step_id is null
    or rules.evolution_chain_step_id <> steps.id
  );

update inventory.evolution_rules rules
set from_template_id = steps.from_template_id,
    from_form_id = steps.from_form_id,
    to_template_id = steps.to_template_id,
    to_form_id = steps.to_form_id,
    required_count = steps.required_count,
    cost_kcoin = steps.cost_kcoin,
    success_rate_bps = steps.success_rate_bps,
    active = true,
    evolution_chain_id = steps.chain_id,
    evolution_chain_step_id = steps.id,
    metadata = rules.metadata || steps.metadata || jsonb_build_object(
      'source_type', 'default_evolution_chain',
      'migration', 'phase6_pokemon_style_evolution_defaults',
      'published_at', now()
    ),
    updated_at = now()
from inventory.evolution_chain_steps steps
join _default_evolution_steps default_steps
  on default_steps.chain_id = steps.chain_id
 and default_steps.step_index = steps.step_index
where rules.id = steps.evolution_rule_id;

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
select
  steps.from_template_id,
  steps.from_form_id,
  steps.to_template_id,
  steps.to_form_id,
  steps.required_count,
  steps.cost_kcoin,
  steps.success_rate_bps,
  true,
  steps.chain_id,
  steps.id,
  steps.metadata || jsonb_build_object(
    'source_type', 'default_evolution_chain',
    'migration', 'phase6_pokemon_style_evolution_defaults',
    'published_at', now()
  )
from inventory.evolution_chain_steps steps
join _default_evolution_steps default_steps
  on default_steps.chain_id = steps.chain_id
 and default_steps.step_index = steps.step_index
where not exists (
  select 1
  from inventory.evolution_rules rules
  where rules.evolution_chain_step_id = steps.id
    and rules.active = true
);

update inventory.evolution_chain_steps steps
set evolution_rule_id = rules.id,
    updated_at = now()
from inventory.evolution_rules rules
join _default_evolution_steps default_steps
  on default_steps.from_template_id = rules.from_template_id
 and default_steps.from_form_id = rules.from_form_id
 and default_steps.to_template_id = rules.to_template_id
 and default_steps.to_form_id = rules.to_form_id
where steps.chain_id = default_steps.chain_id
  and steps.step_index = default_steps.step_index
  and rules.active = true
  and rules.evolution_chain_step_id = steps.id;

create or replace function inventory.validate_active_evolution_rule_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active = true and new.from_template_id = new.to_template_id then
    raise exception 'EVOLUTION_RULE_TARGET_TEMPLATE_REQUIRED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists evolution_rules_validate_target on inventory.evolution_rules;
create trigger evolution_rules_validate_target
before insert or update on inventory.evolution_rules
for each row
execute function inventory.validate_active_evolution_rule_target();

revoke all on function inventory.validate_active_evolution_rule_target() from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from inventory.evolution_rules
    where active = true
      and from_template_id = to_template_id
  ) then
    raise exception 'ACTIVE_SAME_TEMPLATE_EVOLUTION_RULE_REMAINS' using errcode = 'P0001';
  end if;

  if exists (select 1 from _default_evolution_steps)
     and (
       select count(*)::integer
       from inventory.evolution_rules rules
       join _default_evolution_steps default_steps
         on default_steps.from_template_id = rules.from_template_id
        and default_steps.from_form_id = rules.from_form_id
        and default_steps.to_template_id = rules.to_template_id
        and default_steps.to_form_id = rules.to_form_id
       where rules.active = true
     ) <> (select count(*)::integer from _default_evolution_steps) then
    raise exception 'DEFAULT_EVOLUTION_RULE_SYNC_FAILED' using errcode = 'P0001';
  end if;
end;
$$;

commit;
