-- Phase 6 upgrade economy rules.
-- Verifies the backend rule table follows the detailed common 1-100 table
-- and rarity multipliers. The summary totals in the product brief are not
-- used because the detailed per-level table is the source of truth.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, inventory, api;

select plan(12);

select ok(
  exists (select 1 from catalog.rarities where code = 'MYTHIC'),
  'MYTHIC rarity exists for mythic upgrade rules'
);

select is(
  (select sort_order from catalog.rarities where code = 'MYTHIC'),
  50,
  'MYTHIC rarity sort order follows frontend rarity order'
);

select is(
  (
    select count(*)::integer
    from inventory.upgrade_rules
    where active = true
      and rarity_code in ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC')
      and form_index in (1, 2, 3)
  ),
  1485,
  'active upgrade rules cover five rarities, three star forms and 99 level steps'
);

select is(
  (
    with grouped_rules as (
      select rarity_code, form_index, count(*)::integer as rule_count
      from inventory.upgrade_rules
      where active = true
        and rarity_code in ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC')
        and form_index in (1, 2, 3)
      group by rarity_code, form_index
    )
    select count(*)::integer
    from grouped_rules
    where rule_count <> 99
  ),
  0,
  'each rarity and star form has exactly 99 active upgrade steps'
);

select is(
  (
    select count(*)::integer
    from inventory.upgrade_rules
    where active = true
      and rarity_code in ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC')
      and form_index in (1, 2, 3)
      and (
        from_level < 1
        or from_level > 99
        or to_level <> from_level + 1
      )
  ),
  0,
  'active upgrade rules are contiguous 1 to 100 steps'
);

select is(
  (
    select count(*)::integer
    from catalog.collectible_templates template
    join (
      values
        ('COMMON', 100),
        ('RARE', 140),
        ('EPIC', 210),
        ('LEGENDARY', 330),
        ('MYTHIC', 330)
    ) expected(rarity_code, base_power)
      on expected.rarity_code = template.rarity_code
    where template.base_power <> expected.base_power
  ),
  0,
  'collectible template base_power matches the new rarity base table'
);

select is(
  (
    select jsonb_build_object('cost', cost_fgems, 'gain', power_gain)
    from inventory.upgrade_rules
    where active = true
      and rarity_code = 'COMMON'
      and form_index = 1
      and from_level = 1
  ),
  jsonb_build_object('cost', 70::numeric, 'gain', 5),
  'COMMON 1 to 2 uses the detailed base table'
);

select is(
  (
    select jsonb_build_object('cost', cost_fgems, 'gain', power_gain)
    from inventory.upgrade_rules
    where active = true
      and rarity_code = 'RARE'
      and form_index = 1
      and from_level = 1
  ),
  jsonb_build_object('cost', 90::numeric, 'gain', 6),
  'RARE 1 to 2 applies cost and growth multipliers'
);

select is(
  (
    select jsonb_build_object('cost', cost_fgems, 'gain', power_gain)
    from inventory.upgrade_rules
    where active = true
      and rarity_code = 'EPIC'
      and form_index = 1
      and from_level = 50
  ),
  jsonb_build_object('cost', 2860::numeric, 'gain', 23),
  'EPIC 50 to 51 rounds scaled cost and power correctly'
);

select is(
  (
    select jsonb_build_object('cost', cost_fgems, 'gain', power_gain)
    from inventory.upgrade_rules
    where active = true
      and rarity_code = 'LEGENDARY'
      and form_index = 1
      and from_level = 99
  ),
  jsonb_build_object('cost', 13110::numeric, 'gain', 72),
  'LEGENDARY 99 to 100 uses legendary multipliers'
);

select is(
  (
    select jsonb_build_object('cost', cost_fgems, 'gain', power_gain)
    from inventory.upgrade_rules
    where active = true
      and rarity_code = 'MYTHIC'
      and form_index = 1
      and from_level = 99
  ),
  jsonb_build_object('cost', 13110::numeric, 'gain', 72),
  'MYTHIC 99 to 100 matches legendary multipliers'
);

select is(
  (
    with expected_totals(rarity_code, total_cost, level_100_power) as (
      values
        ('COMMON', 227110::numeric, 1994),
        ('RARE', 272940::numeric, 2337),
        ('EPIC', 352510::numeric, 2824),
        ('LEGENDARY', 477380::numeric, 3659),
        ('MYTHIC', 477380::numeric, 3659)
    ),
    actual_totals as (
      select
        rules.rarity_code,
        rules.form_index,
        sum(rules.cost_fgems)::numeric as total_cost,
        max(numbers.base_power) + sum(rules.power_gain)::integer as level_100_power
      from inventory.upgrade_rules rules
      join (
        values
          ('COMMON', 100),
          ('RARE', 140),
          ('EPIC', 210),
          ('LEGENDARY', 330),
          ('MYTHIC', 330)
      ) numbers(rarity_code, base_power)
        on numbers.rarity_code = rules.rarity_code
      where rules.active = true
        and rules.rarity_code in ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC')
        and rules.form_index in (1, 2, 3)
      group by rules.rarity_code, rules.form_index
    )
    select count(*)::integer
    from actual_totals actual
    join expected_totals expected on expected.rarity_code = actual.rarity_code
    where actual.total_cost <> expected.total_cost
      or actual.level_100_power <> expected.level_100_power
  ),
  0,
  'per-rarity total cost and level-100 power match the detailed per-level table'
);

select * from finish();

rollback;
