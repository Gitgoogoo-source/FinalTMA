begin;

with base_forms as (
  select
    ct.id as template_id,
    cf.id as base_form_id,
    cf.display_name,
    coalesce(cf.description, ct.description) as description,
    cf.image_url,
    cf.thumbnail_url,
    cf.avatar_url,
    cf.base_power_bonus
  from catalog.collectible_templates ct
  join catalog.collectible_forms cf
    on cf.template_id = ct.id
   and cf.form_index = 1
  where ct.release_status = 'active'
    and ct.evolvable = true
)
insert into catalog.collectible_forms (
  template_id,
  form_index,
  form_slug,
  display_name,
  description,
  image_url,
  thumbnail_url,
  avatar_url,
  base_power_bonus,
  is_default,
  metadata
)
select
  template_id,
  2,
  'stage_2',
  display_name || ' II',
  description,
  image_url,
  thumbnail_url,
  avatar_url,
  base_power_bonus,
  false,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '4.2_evolution_rules',
    'generated_from_form_id', base_form_id,
    'asset_source', 'base_form_reused',
    'migration', 'phase3_growth_evolution_rules'
  )
from base_forms
on conflict (template_id, form_index) do nothing;

with base_forms as (
  select
    ct.id as template_id,
    cf.id as base_form_id,
    cf.display_name,
    coalesce(cf.description, ct.description) as description,
    cf.image_url,
    cf.thumbnail_url,
    cf.avatar_url,
    cf.base_power_bonus
  from catalog.collectible_templates ct
  join catalog.collectible_forms cf
    on cf.template_id = ct.id
   and cf.form_index = 1
  where ct.release_status = 'active'
    and ct.evolvable = true
)
insert into catalog.collectible_forms (
  template_id,
  form_index,
  form_slug,
  display_name,
  description,
  image_url,
  thumbnail_url,
  avatar_url,
  base_power_bonus,
  is_default,
  metadata
)
select
  template_id,
  3,
  'stage_3',
  display_name || ' III',
  description,
  image_url,
  thumbnail_url,
  avatar_url,
  base_power_bonus,
  false,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '4.2_evolution_rules',
    'generated_from_form_id', base_form_id,
    'asset_source', 'base_form_reused',
    'migration', 'phase3_growth_evolution_rules'
  )
from base_forms
on conflict (template_id, form_index) do nothing;

update catalog.collectible_forms source_form
set next_form_id = target_form.id,
    updated_at = now(),
    metadata = source_form.metadata || jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '4.2_evolution_rules',
      'migration', 'phase3_growth_evolution_rules'
    )
from catalog.collectible_forms target_form
join catalog.collectible_templates ct
  on ct.id = target_form.template_id
where source_form.template_id = target_form.template_id
  and source_form.form_index = 1
  and target_form.form_index = 2
  and ct.release_status = 'active'
  and ct.evolvable = true
  and (source_form.next_form_id is null or source_form.next_form_id = target_form.id);

update catalog.collectible_forms source_form
set next_form_id = target_form.id,
    updated_at = now(),
    metadata = source_form.metadata || jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '4.2_evolution_rules',
      'migration', 'phase3_growth_evolution_rules'
    )
from catalog.collectible_forms target_form
join catalog.collectible_templates ct
  on ct.id = target_form.template_id
where source_form.template_id = target_form.template_id
  and source_form.form_index = 2
  and target_form.form_index = 3
  and ct.release_status = 'active'
  and ct.evolvable = true
  and (source_form.next_form_id is null or source_form.next_form_id = target_form.id);

with transitions as (
  select
    ct.id as from_template_id,
    source_form.id as from_form_id,
    ct.id as to_template_id,
    target_form.id as to_form_id,
    case ct.rarity_code
      when 'COMMON' then 100::numeric(38,0)
      when 'RARE' then 300::numeric(38,0)
      when 'EPIC' then 800::numeric(38,0)
      when 'LEGENDARY' then 2000::numeric(38,0)
    end as cost_kcoin,
    case source_form.form_index
      when 1 then
        case ct.rarity_code
          when 'COMMON' then 8000
          when 'RARE' then 7000
          when 'EPIC' then 6000
          when 'LEGENDARY' then 5000
        end
      when 2 then
        case ct.rarity_code
          when 'COMMON' then 6000
          when 'RARE' then 5000
          when 'EPIC' then 4000
          when 'LEGENDARY' then 3000
        end
    end as success_rate_bps,
    source_form.form_index as from_form_index
  from catalog.collectible_templates ct
  join catalog.collectible_forms source_form
    on source_form.template_id = ct.id
  join catalog.collectible_forms target_form
    on target_form.id = source_form.next_form_id
  where ct.release_status = 'active'
    and ct.evolvable = true
    and ct.rarity_code in ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')
    and source_form.form_index in (1, 2)
),
updated as (
  update inventory.evolution_rules er
  set required_count = 3,
      cost_kcoin = transitions.cost_kcoin,
      success_rate_bps = transitions.success_rate_bps,
      metadata = er.metadata || jsonb_build_object(
        'phase', 'stage_3_growth_system',
        'guide_section', '4.2_evolution_rules',
        'from_form_index', transitions.from_form_index,
        'migration', 'phase3_growth_evolution_rules'
      ),
      updated_at = now()
  from transitions
  where er.from_template_id = transitions.from_template_id
    and er.from_form_id = transitions.from_form_id
    and er.to_template_id = transitions.to_template_id
    and er.to_form_id = transitions.to_form_id
    and er.active = true
  returning er.id
)
insert into inventory.evolution_rules (
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
  from_template_id,
  from_form_id,
  to_template_id,
  to_form_id,
  3,
  cost_kcoin,
  success_rate_bps,
  true,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '4.2_evolution_rules',
    'from_form_index', from_form_index,
    'migration', 'phase3_growth_evolution_rules'
  )
from transitions
where not exists (
  select 1
  from inventory.evolution_rules er
  where er.from_template_id = transitions.from_template_id
    and er.from_form_id = transitions.from_form_id
    and er.to_template_id = transitions.to_template_id
    and er.to_form_id = transitions.to_form_id
    and er.active = true
);

commit;
