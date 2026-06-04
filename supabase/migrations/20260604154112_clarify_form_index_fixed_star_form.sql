-- Clarify form_index semantics without changing data or business logic.
-- form_index is a fixed star form assigned when an item instance is generated.
-- Upgrade rules use rarity_code + form_index + from_level, but upgrades only
-- change level and power; they never mutate form_index.

comment on table catalog.collectible_forms is
  'Star-form variants for a collectible template. The form_index is fixed when an item instance is generated; upgrades change level, not form_index.';

comment on column catalog.collectible_forms.form_index is
  'Immutable star form index for generated item instances: 1 means 1-star, 2 means 2-star, and so on. It is not an upgrade level.';

comment on column catalog.collectible_forms.next_form_id is
  'Optional catalog link to another configured form. Runtime item upgrades do not mutate form_index.';

comment on column catalog.power_rules.form_index is
  'Fixed star form index used with rarity and level when calculating collectible power.';

comment on column catalog.market_price_rules.form_index is
  'Optional fixed star form filter for market pricing. Null means the rule can apply to every star form.';

comment on table inventory.upgrade_rules is
  'Upgrade rules. Upgrade always succeeds, consumes FGEMS, and changes level only.';

comment on column inventory.upgrade_rules.form_index is
  'Fixed star form index used with rarity_code and from_level to find the rule. Upgrading does not change form_index.';

comment on column inventory.decompose_rules.form_index is
  'Fixed star form index used with rarity_code and min_level to find the reward rule. It is not a mutable evolution stage.';
