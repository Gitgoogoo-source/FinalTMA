begin;

with rules (rarity_code, form_index, from_level, to_level, cost_fgems, power_gain) as (
  values
    ('COMMON', 1, 1, 2, 10::numeric(38,0), 5),
    ('COMMON', 1, 2, 3, 15::numeric(38,0), 6),
    ('COMMON', 1, 3, 4, 20::numeric(38,0), 7),
    ('RARE', 1, 1, 2, 20::numeric(38,0), 8),
    ('RARE', 1, 2, 3, 30::numeric(38,0), 10),
    ('RARE', 1, 3, 4, 40::numeric(38,0), 12),
    ('EPIC', 1, 1, 2, 40::numeric(38,0), 14),
    ('EPIC', 1, 2, 3, 60::numeric(38,0), 18),
    ('EPIC', 1, 3, 4, 80::numeric(38,0), 22),
    ('LEGENDARY', 1, 1, 2, 80::numeric(38,0), 25),
    ('LEGENDARY', 1, 2, 3, 120::numeric(38,0), 32),
    ('LEGENDARY', 1, 3, 4, 160::numeric(38,0), 40)
)
insert into inventory.upgrade_rules (
  rarity_code,
  form_index,
  from_level,
  to_level,
  cost_fgems,
  power_gain,
  active,
  metadata
)
select
  rarity_code,
  form_index,
  from_level,
  to_level,
  cost_fgems,
  power_gain,
  true,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '4.1_upgrade_rules'
  )
from rules
on conflict (rarity_code, form_index, from_level, to_level, active)
do update
set cost_fgems = excluded.cost_fgems,
    power_gain = excluded.power_gain,
    metadata = inventory.upgrade_rules.metadata || excluded.metadata,
    updated_at = now();

commit;
