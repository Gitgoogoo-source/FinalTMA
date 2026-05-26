-- catalog.policies.sql
-- RLS for public collectible catalog and admin-managed game configuration.

grant usage on schema catalog to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema catalog from anon, authenticated;
grant all privileges on all tables in schema catalog to service_role;

grant select on all tables in schema catalog to anon, authenticated;
grant select on public.v_collectible_catalog to anon, authenticated;

-- Admin direct writes are allowed only for JWTs with catalog:write.
grant insert, update, delete on all tables in schema catalog to authenticated;

alter table catalog.rarities enable row level security;
alter table catalog.item_types enable row level security;
alter table catalog.series enable row level security;
alter table catalog.factions enable row level security;
alter table catalog.collectible_templates enable row level security;
alter table catalog.collectible_forms enable row level security;
alter table catalog.collectible_media enable row level security;
alter table catalog.power_rules enable row level security;
alter table catalog.market_price_rules enable row level security;
alter table catalog.item_tags enable row level security;
alter table catalog.template_tags enable row level security;
alter table catalog.banner_campaigns enable row level security;

DROP POLICY IF EXISTS catalog_rarities_read_public ON catalog.rarities;
CREATE POLICY catalog_rarities_read_public ON catalog.rarities
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS catalog_item_types_read_public ON catalog.item_types;
CREATE POLICY catalog_item_types_read_public ON catalog.item_types
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS catalog_series_read_public ON catalog.series;
CREATE POLICY catalog_series_read_public ON catalog.series
FOR SELECT TO anon, authenticated
USING (
  status in ('active', 'hidden')
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS catalog_factions_read_public ON catalog.factions;
CREATE POLICY catalog_factions_read_public ON catalog.factions
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS catalog_templates_read_public ON catalog.collectible_templates;
CREATE POLICY catalog_templates_read_public ON catalog.collectible_templates
FOR SELECT TO anon, authenticated
USING (release_status in ('active', 'hidden'));

DROP POLICY IF EXISTS catalog_forms_read_public ON catalog.collectible_forms;
CREATE POLICY catalog_forms_read_public ON catalog.collectible_forms
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from catalog.collectible_templates t
    where t.id = template_id
      and t.release_status in ('active', 'hidden')
  )
);

DROP POLICY IF EXISTS catalog_media_read_public ON catalog.collectible_media;
CREATE POLICY catalog_media_read_public ON catalog.collectible_media
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from catalog.collectible_templates t
    where t.id = template_id
      and t.release_status in ('active', 'hidden')
  )
);

DROP POLICY IF EXISTS catalog_power_rules_read_active ON catalog.power_rules;
CREATE POLICY catalog_power_rules_read_active ON catalog.power_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS catalog_market_price_rules_read_active ON catalog.market_price_rules;
CREATE POLICY catalog_market_price_rules_read_active ON catalog.market_price_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS catalog_item_tags_read_public ON catalog.item_tags;
CREATE POLICY catalog_item_tags_read_public ON catalog.item_tags
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS catalog_template_tags_read_public ON catalog.template_tags;
CREATE POLICY catalog_template_tags_read_public ON catalog.template_tags
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from catalog.collectible_templates t
    where t.id = template_id
      and t.release_status in ('active', 'hidden')
  )
);

DROP POLICY IF EXISTS catalog_banners_read_public ON catalog.banner_campaigns;
CREATE POLICY catalog_banners_read_public ON catalog.banner_campaigns
FOR SELECT TO anon, authenticated
USING (
  status = 'active'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

-- Admin read for draft/retired catalog records.
DROP POLICY IF EXISTS catalog_all_admin_read ON catalog.rarities;
CREATE POLICY catalog_all_admin_read ON catalog.rarities FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_item_types_admin_read ON catalog.item_types;
CREATE POLICY catalog_item_types_admin_read ON catalog.item_types FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_series_admin_read ON catalog.series;
CREATE POLICY catalog_series_admin_read ON catalog.series FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_factions_admin_read ON catalog.factions;
CREATE POLICY catalog_factions_admin_read ON catalog.factions FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_templates_admin_read ON catalog.collectible_templates;
CREATE POLICY catalog_templates_admin_read ON catalog.collectible_templates FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_forms_admin_read ON catalog.collectible_forms;
CREATE POLICY catalog_forms_admin_read ON catalog.collectible_forms FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_media_admin_read ON catalog.collectible_media;
CREATE POLICY catalog_media_admin_read ON catalog.collectible_media FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_power_rules_admin_read ON catalog.power_rules;
CREATE POLICY catalog_power_rules_admin_read ON catalog.power_rules FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_market_price_rules_admin_read ON catalog.market_price_rules;
CREATE POLICY catalog_market_price_rules_admin_read ON catalog.market_price_rules FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read') OR ops.has_admin_permission('market:read'));
DROP POLICY IF EXISTS catalog_item_tags_admin_read ON catalog.item_tags;
CREATE POLICY catalog_item_tags_admin_read ON catalog.item_tags FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_template_tags_admin_read ON catalog.template_tags;
CREATE POLICY catalog_template_tags_admin_read ON catalog.template_tags FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_banners_admin_read ON catalog.banner_campaigns;
CREATE POLICY catalog_banners_admin_read ON catalog.banner_campaigns FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));

-- Admin write policies.
DROP POLICY IF EXISTS catalog_rarities_admin_write ON catalog.rarities;
CREATE POLICY catalog_rarities_admin_write ON catalog.rarities FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_item_types_admin_write ON catalog.item_types;
CREATE POLICY catalog_item_types_admin_write ON catalog.item_types FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_series_admin_write ON catalog.series;
CREATE POLICY catalog_series_admin_write ON catalog.series FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_factions_admin_write ON catalog.factions;
CREATE POLICY catalog_factions_admin_write ON catalog.factions FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_templates_admin_write ON catalog.collectible_templates;
CREATE POLICY catalog_templates_admin_write ON catalog.collectible_templates FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_forms_admin_write ON catalog.collectible_forms;
CREATE POLICY catalog_forms_admin_write ON catalog.collectible_forms FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_media_admin_write ON catalog.collectible_media;
CREATE POLICY catalog_media_admin_write ON catalog.collectible_media FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_power_rules_admin_write ON catalog.power_rules;
CREATE POLICY catalog_power_rules_admin_write ON catalog.power_rules FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_market_rules_admin_write ON catalog.market_price_rules;
CREATE POLICY catalog_market_rules_admin_write ON catalog.market_price_rules FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write') OR ops.has_admin_permission('market:write')) WITH CHECK (ops.has_admin_permission('catalog:write') OR ops.has_admin_permission('market:write'));
DROP POLICY IF EXISTS catalog_item_tags_admin_write ON catalog.item_tags;
CREATE POLICY catalog_item_tags_admin_write ON catalog.item_tags FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_template_tags_admin_write ON catalog.template_tags;
CREATE POLICY catalog_template_tags_admin_write ON catalog.template_tags FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_banners_admin_write ON catalog.banner_campaigns;
CREATE POLICY catalog_banners_admin_write ON catalog.banner_campaigns FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));


