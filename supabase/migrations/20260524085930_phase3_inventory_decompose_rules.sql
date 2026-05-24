begin;

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
    'migration', 'phase3_inventory_decompose_rules'
  )
from rules
on conflict (rarity_code, form_index, min_level, active)
do update
set reward_fgems = excluded.reward_fgems,
    metadata = inventory.decompose_rules.metadata || excluded.metadata,
    updated_at = now();

commit;
