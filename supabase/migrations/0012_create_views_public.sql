-- 0012_create_views_public.sql
-- Read-oriented views for frontend queries. Write operations must still go through Vercel API and RPC.

create or replace view public.v_collectible_catalog as
select
  t.id as template_id,
  t.slug,
  t.display_name,
  t.subtitle,
  t.description,
  t.rarity_code,
  r.display_name as rarity_name,
  r.sort_order as rarity_sort_order,
  t.type_code,
  it.display_name as type_name,
  t.series_id,
  s.display_name as series_name,
  t.faction_id,
  f.display_name as faction_name,
  t.base_power,
  t.max_level,
  t.tradeable,
  t.upgradeable,
  t.evolvable,
  t.decomposable,
  t.nft_mintable,
  t.release_status,
  coalesce(
    jsonb_agg(
      distinct jsonb_build_object(
        'form_id', cf.id,
        'form_index', cf.form_index,
        'form_slug', cf.form_slug,
        'display_name', cf.display_name,
        'image_url', cf.image_url,
        'thumbnail_url', cf.thumbnail_url,
        'avatar_url', cf.avatar_url,
        'is_default', cf.is_default
      )
    ) filter (where cf.id is not null),
    '[]'::jsonb
  ) as forms
from catalog.collectible_templates t
join catalog.rarities r on r.code = t.rarity_code
join catalog.item_types it on it.code = t.type_code
left join catalog.series s on s.id = t.series_id
left join catalog.factions f on f.id = t.faction_id
left join catalog.collectible_forms cf on cf.template_id = t.id
where t.release_status in ('active', 'hidden')
group by t.id, r.code, r.display_name, r.sort_order, it.code, it.display_name, s.id, s.display_name, f.id, f.display_name;

create or replace view public.v_active_boxes as
select
  b.id,
  b.slug,
  b.display_name,
  b.description,
  b.tier,
  b.status,
  b.price_stars,
  b.total_stock,
  b.remaining_stock,
  b.open_reward_kcoin,
  b.cover_image_url,
  b.hero_image_url,
  b.starts_at,
  b.ends_at,
  b.sort_order,
  dpv.id as active_pool_version_id,
  dpv.version_no as active_pool_version_no,
  coalesce(
    jsonb_agg(
      distinct jsonb_build_object(
        'quantity', pr.quantity,
        'discount_bps', pr.discount_bps,
        'price_stars_override', pr.price_stars_override
      )
    ) filter (where pr.id is not null),
    '[]'::jsonb
  ) as price_rules
from gacha.blind_boxes b
left join gacha.drop_pool_versions dpv on dpv.box_id = b.id and dpv.status = 'active'
left join gacha.box_price_rules pr on pr.box_id = b.id and pr.active = true
where b.status in ('not_started', 'active', 'paused', 'sold_out')
group by b.id, dpv.id, dpv.version_no;

create or replace view public.v_box_rewards as
select
  b.id as box_id,
  b.slug as box_slug,
  dpv.id as pool_version_id,
  dpv.version_no,
  dpi.id as drop_pool_item_id,
  dpi.template_id,
  ct.display_name as collectible_name,
  dpi.form_id,
  cf.form_index,
  coalesce(cf.thumbnail_url, cf.image_url) as thumbnail_url,
  dpi.rarity_code,
  r.display_name as rarity_name,
  r.sort_order as rarity_sort_order,
  dpi.drop_weight,
  dpi.probability_bps,
  dpi.stock_total,
  dpi.stock_remaining,
  dpi.is_pity_eligible,
  dpi.sort_order
from gacha.blind_boxes b
join gacha.drop_pool_versions dpv on dpv.box_id = b.id and dpv.status = 'active'
join gacha.drop_pool_items dpi on dpi.pool_version_id = dpv.id
join catalog.collectible_templates ct on ct.id = dpi.template_id
left join catalog.collectible_forms cf on cf.id = dpi.form_id
join catalog.rarities r on r.code = dpi.rarity_code
where b.status in ('active', 'not_started', 'paused', 'sold_out');

create or replace view public.v_market_listings as
select
  l.id as listing_id,
  l.seller_user_id,
  l.template_id,
  t.display_name as collectible_name,
  l.form_id,
  cf.form_index,
  coalesce(cf.thumbnail_url, cf.image_url) as thumbnail_url,
  l.rarity_code,
  r.display_name as rarity_name,
  r.sort_order as rarity_sort_order,
  l.status,
  l.item_count,
  l.remaining_count,
  l.unit_price_kcoin,
  l.fee_bps,
  l.expected_net_amount,
  l.price_health,
  l.expires_at,
  l.created_at
from market.listings l
join catalog.collectible_templates t on t.id = l.template_id
left join catalog.collectible_forms cf on cf.id = l.form_id
join catalog.rarities r on r.code = l.rarity_code
where l.status in ('active', 'partially_sold') and l.remaining_count > 0;

create or replace view public.v_market_price_summary as
select distinct on (template_id, form_id)
  template_id,
  form_id,
  rarity_code,
  floor_price_kcoin,
  avg_price_kcoin,
  last_sale_price_kcoin,
  active_listing_count,
  sale_count_24h,
  volume_24h_kcoin,
  snapshot_at
from market.price_snapshots
order by template_id, form_id, snapshot_at desc;

create or replace view public.v_album_books as
select
  b.id as book_id,
  b.code,
  b.display_name,
  b.description,
  b.book_type,
  b.series_id,
  b.faction_id,
  b.rarity_code,
  b.cover_url,
  b.sort_order,
  count(bi.template_id)::integer as total_count
from album.books b
left join album.book_items bi on bi.book_id = b.id
where b.active = true
group by b.id;

create or replace view public.v_weekly_leaderboard as
select
  wl.week_key,
  wl.starts_at,
  wl.ends_at,
  le.user_id,
  u.username,
  up.display_name,
  up.avatar_url,
  le.rank,
  le.score,
  le.collected_count,
  le.total_count,
  le.completion_percent,
  le.rare_count,
  le.epic_count,
  le.legendary_count,
  le.minted_count,
  le.calculated_at
from album.weekly_leaderboards wl
join album.leaderboard_entries le on le.leaderboard_id = wl.id
join core.users u on u.id = le.user_id
left join core.user_profiles up on up.user_id = u.id
where wl.status in ('active', 'settled');

create or replace view public.v_user_asset_summary as
select
  ub.user_id,
  jsonb_object_agg(
    ub.currency_code,
    jsonb_build_object(
      'available', ub.available_amount,
      'locked', ub.locked_amount,
      'total_earned', ub.total_earned,
      'total_spent', ub.total_spent
    )
  ) as balances
from economy.user_balances ub
where ub.user_id = core.current_user_id()
group by ub.user_id;

create or replace view public.v_user_inventory as
select
  ii.id as item_instance_id,
  ii.owner_user_id,
  ii.template_id,
  t.display_name,
  t.slug,
  ii.form_id,
  cf.form_index,
  cf.image_url,
  cf.thumbnail_url,
  ii.serial_no,
  ii.level,
  ii.power,
  ii.status,
  ii.nft_mint_status,
  t.rarity_code,
  r.display_name as rarity_name,
  t.type_code,
  t.tradeable,
  t.upgradeable,
  t.evolvable,
  t.decomposable,
  t.nft_mintable,
  ii.acquired_at
from inventory.item_instances ii
join catalog.collectible_templates t on t.id = ii.template_id
left join catalog.collectible_forms cf on cf.id = ii.form_id
join catalog.rarities r on r.code = t.rarity_code
where ii.owner_user_id = core.current_user_id();

create or replace view public.v_user_task_status as
select
  p.user_id,
  d.id as task_id,
  d.code,
  d.task_type,
  d.title,
  d.description,
  d.period_type,
  coalesce(p.period_key, 'once') as period_key,
  coalesce(p.progress_count, 0) as progress_count,
  coalesce(p.target_count, d.target_count) as target_count,
  coalesce(p.status, 'in_progress') as status,
  d.reward,
  d.action_type,
  d.action_url,
  p.completed_at,
  p.claimed_at
from tasks.task_definitions d
left join tasks.user_task_progress p on p.task_id = d.id and p.user_id = core.current_user_id()
where d.active = true;

comment on view public.v_user_asset_summary is 'Current authenticated user asset summary. Depends on app_user_id JWT claim.';
comment on view public.v_user_inventory is 'Current authenticated user inventory view. Depends on app_user_id JWT claim.';
comment on view public.v_user_task_status is 'Current authenticated user task status view. Depends on app_user_id JWT claim.';
