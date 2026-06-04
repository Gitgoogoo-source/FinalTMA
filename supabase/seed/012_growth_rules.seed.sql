-- 012_growth_rules.seed.sql
-- Local reset companion for stage 3 growth rules.
--
-- The remote project receives these rules through versioned migrations. Local
-- `supabase db reset` runs migrations before catalog seeds, so this idempotent
-- seed mirrors the growth-rule data after collectibles have been seeded.

do $$
begin
update inventory.evolution_rules er
set active = false,
    metadata = er.metadata || jsonb_build_object(
      'deactivated_reason', 'same_template_replaced_by_pokemon_style_seed',
      'deactivated_at', now(),
      'seed', '012_growth_rules'
    ),
    updated_at = now()
where er.active = true
  and er.from_template_id = er.to_template_id;

create temp table _seed_evolution_chain_definitions (
  code text primary key,
  display_name text not null,
  description text not null,
  series_slug text not null,
  sort_order integer not null
) on commit drop;

insert into _seed_evolution_chain_definitions (
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
    'series_slug', chain_def.series_slug,
    'seed', '012_growth_rules'
  )
from _seed_evolution_chain_definitions chain_def
join catalog.series series on series.slug = chain_def.series_slug
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    series_id = excluded.series_id,
    status = 'active',
    sort_order = excluded.sort_order,
    metadata = inventory.evolution_chains.metadata || excluded.metadata,
    updated_at = now();

create temp table _seed_evolution_steps on commit drop as
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

update inventory.evolution_chain_steps steps
set active = false,
    metadata = steps.metadata || jsonb_build_object(
      'deactivated_reason', 'default_pokemon_style_source_replaced',
      'deactivated_at', now(),
      'seed', '012_growth_rules'
    ),
    updated_at = now()
from _seed_evolution_steps seed_steps
where steps.active = true
  and steps.from_template_id = seed_steps.from_template_id
  and steps.from_form_id = seed_steps.from_form_id
  and steps.chain_id <> seed_steps.chain_id;

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
    'seed', '012_growth_rules',
    'chain_code', chain_code,
    'from_template_slug', from_template_slug,
    'to_template_slug', to_template_slug
  )
from _seed_evolution_steps
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
      'seed', '012_growth_rules'
    ),
    updated_at = now()
from inventory.evolution_chains chains
where steps.chain_id = chains.id
  and chains.code in (select code from _seed_evolution_chain_definitions)
  and not exists (
    select 1
    from _seed_evolution_steps seed_steps
    where seed_steps.chain_id = steps.chain_id
      and seed_steps.step_index = steps.step_index
  );

update inventory.evolution_rules rules
set active = false,
    metadata = rules.metadata || jsonb_build_object(
      'deactivated_reason', 'source_replaced_by_default_pokemon_style_chain',
      'deactivated_at', now(),
      'seed', '012_growth_rules'
    ),
    updated_at = now()
from inventory.evolution_chain_steps steps
join _seed_evolution_steps seed_steps
  on seed_steps.chain_id = steps.chain_id
 and seed_steps.step_index = steps.step_index
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
      'seed', '012_growth_rules',
      'published_at', now()
    ),
    updated_at = now()
from inventory.evolution_chain_steps steps
join _seed_evolution_steps seed_steps
  on seed_steps.chain_id = steps.chain_id
 and seed_steps.step_index = steps.step_index
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
    'seed', '012_growth_rules',
    'published_at', now()
  )
from inventory.evolution_chain_steps steps
join _seed_evolution_steps seed_steps
  on seed_steps.chain_id = steps.chain_id
 and seed_steps.step_index = steps.step_index
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
join _seed_evolution_steps seed_steps
  on seed_steps.from_template_id = rules.from_template_id
 and seed_steps.from_form_id = rules.from_form_id
 and seed_steps.to_template_id = rules.to_template_id
 and seed_steps.to_form_id = rules.to_form_id
where steps.chain_id = seed_steps.chain_id
  and steps.step_index = seed_steps.step_index
  and rules.active = true
  and rules.evolution_chain_step_id = steps.id;

with rules (rarity_code, form_index, min_level, reward_fgems) as (
  values
    ('COMMON', 1, 1, 5::numeric(38,0)),
    ('COMMON', 2, 1, 15::numeric(38,0)),
    ('COMMON', 3, 1, 40::numeric(38,0)),
    ('RARE', 1, 1, 15::numeric(38,0)),
    ('RARE', 2, 1, 45::numeric(38,0)),
    ('RARE', 3, 1, 120::numeric(38,0)),
    ('EPIC', 1, 1, 50::numeric(38,0)),
    ('EPIC', 2, 1, 150::numeric(38,0)),
    ('EPIC', 3, 1, 400::numeric(38,0)),
    ('LEGENDARY', 1, 1, 150::numeric(38,0)),
    ('LEGENDARY', 2, 1, 450::numeric(38,0)),
    ('LEGENDARY', 3, 1, 1200::numeric(38,0))
)
insert into inventory.decompose_rules (
  rarity_code,
  form_index,
  min_level,
  reward_fgems,
  active,
  metadata
)
select
  rarity_code,
  form_index,
  min_level,
  reward_fgems,
  true,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '4.3_decompose_rules',
    'seed', '012_growth_rules'
  )
from rules
on conflict (rarity_code, form_index, min_level, active)
do update
set reward_fgems = excluded.reward_fgems,
    metadata = inventory.decompose_rules.metadata || excluded.metadata,
    updated_at = now();

drop table if exists _seed_evolution_steps;
drop table if exists _seed_evolution_chain_definitions;
end;
$$;
