-- Phase 6: replace collectible upgrade economy numbers with the 1-100 table.
--
-- Scope:
-- - Backend upgrade flow stays unchanged: api.inventory_upgrade_item still reads
--   inventory.upgrade_rules, debits FGEMS, writes ledger and logs.
-- - Existing inventory.item_instances rows are intentionally not rewritten.
-- - form_index is a fixed star form. Runtime upgrades do not mutate it, but the
--   current RPC still looks up rules by form_index, so the same rule set is
--   copied to each known star form.

begin;

insert into catalog.rarities (
  code,
  display_name,
  sort_order,
  color_token,
  label_bg_token,
  min_power,
  pity_eligible,
  default_decompose_fgems,
  metadata
)
select
  'MYTHIC',
  'Mythic',
  50,
  'rarity-mythic',
  'rarity-mythic-bg',
  legendary.min_power,
  legendary.pity_eligible,
  legendary.default_decompose_fgems,
  legendary.metadata || jsonb_build_object(
    'phase', 'phase6_inventory_upgrade_rules_1_to_100',
    'copied_from_rarity', 'LEGENDARY'
  )
from catalog.rarities legendary
where legendary.code = 'LEGENDARY'
on conflict (code) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order,
    color_token = excluded.color_token,
    label_bg_token = excluded.label_bg_token,
    min_power = excluded.min_power,
    pity_eligible = excluded.pity_eligible,
    default_decompose_fgems = excluded.default_decompose_fgems,
    metadata = catalog.rarities.metadata || excluded.metadata;

create temp table _phase6_upgrade_rarity_numbers (
  rarity_code text primary key,
  base_power integer not null,
  cost_multiplier numeric(10,4) not null,
  growth_multiplier numeric(10,4) not null
) on commit drop;

insert into _phase6_upgrade_rarity_numbers (
  rarity_code,
  base_power,
  cost_multiplier,
  growth_multiplier
) values
  ('COMMON', 100, 1.00, 1.00),
  ('RARE', 140, 1.20, 1.16),
  ('EPIC', 210, 1.55, 1.38),
  ('LEGENDARY', 330, 2.10, 1.75),
  ('MYTHIC', 330, 2.10, 1.75);

update catalog.collectible_templates template
set base_power = numbers.base_power,
    updated_at = now()
from _phase6_upgrade_rarity_numbers numbers
where template.rarity_code = numbers.rarity_code
  and template.base_power is distinct from numbers.base_power;

create temp table _phase6_base_upgrade_rules (
  from_level integer primary key,
  cost_fgems numeric(38,0) not null,
  power_gain integer not null
) on commit drop;

insert into _phase6_base_upgrade_rules (
  from_level,
  cost_fgems,
  power_gain
) values
  (1, 70, 5),
  (2, 80, 5),
  (3, 90, 5),
  (4, 100, 5),
  (5, 110, 5),
  (6, 130, 5),
  (7, 140, 5),
  (8, 160, 6),
  (9, 180, 6),
  (10, 200, 6),
  (11, 210, 6),
  (12, 240, 6),
  (13, 260, 6),
  (14, 280, 6),
  (15, 300, 7),
  (16, 330, 7),
  (17, 360, 7),
  (18, 390, 7),
  (19, 410, 8),
  (20, 440, 8),
  (21, 480, 8),
  (22, 510, 8),
  (23, 540, 8),
  (24, 580, 8),
  (25, 610, 9),
  (26, 650, 9),
  (27, 690, 9),
  (28, 730, 9),
  (29, 760, 10),
  (30, 800, 10),
  (31, 850, 10),
  (32, 890, 10),
  (33, 930, 11),
  (34, 980, 11),
  (35, 1020, 11),
  (36, 1070, 12),
  (37, 1120, 12),
  (38, 1160, 12),
  (39, 1210, 13),
  (40, 1260, 13),
  (41, 1310, 13),
  (42, 1370, 14),
  (43, 1420, 14),
  (44, 1470, 14),
  (45, 1530, 15),
  (46, 1580, 15),
  (47, 1640, 16),
  (48, 1700, 16),
  (49, 1760, 16),
  (50, 1840, 17),
  (51, 1890, 17),
  (52, 1960, 18),
  (53, 2020, 18),
  (54, 2090, 19),
  (55, 2160, 19),
  (56, 2230, 20),
  (57, 2300, 20),
  (58, 2370, 20),
  (59, 2440, 21),
  (60, 2520, 21),
  (61, 2590, 22),
  (62, 2670, 22),
  (63, 2750, 23),
  (64, 2830, 23),
  (65, 2910, 24),
  (66, 2990, 24),
  (67, 3070, 25),
  (68, 3150, 25),
  (69, 3240, 26),
  (70, 3320, 26),
  (71, 3410, 27),
  (72, 3500, 27),
  (73, 3590, 28),
  (74, 3680, 28),
  (75, 3770, 29),
  (76, 3860, 29),
  (77, 3960, 30),
  (78, 4050, 30),
  (79, 4150, 31),
  (80, 4220, 31),
  (81, 4350, 32),
  (82, 4450, 32),
  (83, 4550, 33),
  (84, 4650, 34),
  (85, 4760, 34),
  (86, 4860, 35),
  (87, 4970, 35),
  (88, 5080, 36),
  (89, 5190, 36),
  (90, 5240, 37),
  (91, 5410, 37),
  (92, 5520, 38),
  (93, 5640, 38),
  (94, 5750, 39),
  (95, 5780, 39),
  (96, 5900, 40),
  (97, 6010, 40),
  (98, 6130, 41),
  (99, 6240, 41);

create temp table _phase6_upgrade_form_indexes (
  form_index integer primary key
) on commit drop;

insert into _phase6_upgrade_form_indexes (form_index)
select distinct form_index
from (
  values (1), (2), (3)
  union all
  select cf.form_index
  from catalog.collectible_forms cf
  union all
  select ur.form_index
  from inventory.upgrade_rules ur
) form_indexes(form_index)
where form_index is not null
  and form_index > 0;

with generated_rules as (
  select
    numbers.rarity_code,
    form_indexes.form_index,
    base_rules.from_level,
    base_rules.from_level + 1 as to_level,
    (ceil((base_rules.cost_fgems * numbers.cost_multiplier) / 10) * 10)::numeric(38,0) as cost_fgems,
    round(base_rules.power_gain * numbers.growth_multiplier)::integer as power_gain
  from _phase6_base_upgrade_rules base_rules
  cross join _phase6_upgrade_form_indexes form_indexes
  join _phase6_upgrade_rarity_numbers numbers on true
  join catalog.rarities rarities on rarities.code = numbers.rarity_code
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
  generated_rules.rarity_code,
  generated_rules.form_index,
  generated_rules.from_level,
  generated_rules.to_level,
  generated_rules.cost_fgems,
  generated_rules.power_gain,
  true,
  jsonb_build_object(
    'phase', 'phase6_inventory_upgrade_rules_1_to_100',
    'source', 'rarity_multiplier_table',
    'base_rule', 'common_1_to_100',
    'form_index_semantics', 'fixed_star_form'
  )
from generated_rules
on conflict (rarity_code, form_index, from_level, to_level, active)
do update
set cost_fgems = excluded.cost_fgems,
    power_gain = excluded.power_gain,
    metadata = inventory.upgrade_rules.metadata || excluded.metadata,
    updated_at = now();

commit;
