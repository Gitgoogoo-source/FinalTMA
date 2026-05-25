-- 009_album.seed.sql
-- Local reset companion for stage 3 album base data.
--
-- The remote project receives these rows through a versioned migration. Local
-- `supabase db reset` runs migrations before catalog seeds, so this idempotent
-- seed mirrors the album base data after collectibles have been seeded.

begin;

insert into album.books (
  code,
  display_name,
  description,
  book_type,
  series_id,
  faction_id,
  rarity_code,
  cover_url,
  active,
  sort_order,
  metadata
)
select
  'all_collectibles',
  'All Collectibles',
  'All active collectible templates.',
  'all',
  null::uuid,
  null::uuid,
  null::text,
  null::text,
  true,
  10,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '5.1_album_books',
    'source', '009_album_seed'
  )
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    book_type = excluded.book_type,
    series_id = excluded.series_id,
    faction_id = excluded.faction_id,
    rarity_code = excluded.rarity_code,
    cover_url = excluded.cover_url,
    active = excluded.active,
    sort_order = excluded.sort_order,
    metadata = album.books.metadata || excluded.metadata,
    updated_at = now();

insert into album.books (
  code,
  display_name,
  description,
  book_type,
  series_id,
  faction_id,
  rarity_code,
  cover_url,
  active,
  sort_order,
  metadata
)
select
  'series_' || s.slug,
  s.display_name || ' Album',
  coalesce(s.description, 'Series collectible album.'),
  'series',
  s.id,
  null::uuid,
  null::text,
  s.cover_url,
  true,
  100 + s.sort_order,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '5.1_album_books',
    'series_slug', s.slug,
    'source', '009_album_seed'
  )
from catalog.series s
where s.status = 'active'
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    book_type = excluded.book_type,
    series_id = excluded.series_id,
    faction_id = excluded.faction_id,
    rarity_code = excluded.rarity_code,
    cover_url = excluded.cover_url,
    active = excluded.active,
    sort_order = excluded.sort_order,
    metadata = album.books.metadata || excluded.metadata,
    updated_at = now();

insert into album.books (
  code,
  display_name,
  description,
  book_type,
  series_id,
  faction_id,
  rarity_code,
  cover_url,
  active,
  sort_order,
  metadata
)
select
  'rarity_' || lower(r.code),
  r.display_name || ' Album',
  'Collect all ' || lower(r.display_name) || ' collectibles.',
  'rarity',
  null::uuid,
  null::uuid,
  r.code,
  null::text,
  true,
  200 + r.sort_order,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '5.1_album_books',
    'rarity_code', r.code,
    'source', '009_album_seed'
  )
from catalog.rarities r
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    book_type = excluded.book_type,
    series_id = excluded.series_id,
    faction_id = excluded.faction_id,
    rarity_code = excluded.rarity_code,
    cover_url = excluded.cover_url,
    active = excluded.active,
    sort_order = excluded.sort_order,
    metadata = album.books.metadata || excluded.metadata,
    updated_at = now();

with book_item_rows as (
  select
    b.id as book_id,
    ct.id as template_id,
    ct.sort_order
  from album.books b
  join catalog.collectible_templates ct
    on ct.release_status = 'active'
  where b.code = 'all_collectibles'
    and b.active = true

  union all

  select
    b.id as book_id,
    ct.id as template_id,
    ct.sort_order
  from album.books b
  join catalog.collectible_templates ct
    on ct.series_id = b.series_id
   and ct.release_status = 'active'
  where b.book_type = 'series'
    and b.active = true

  union all

  select
    b.id as book_id,
    ct.id as template_id,
    ct.sort_order
  from album.books b
  join catalog.collectible_templates ct
    on ct.rarity_code = b.rarity_code
   and ct.release_status = 'active'
  where b.book_type = 'rarity'
    and b.active = true
)
insert into album.book_items (
  book_id,
  template_id,
  sort_order
)
select
  book_id,
  template_id,
  sort_order
from book_item_rows
on conflict (book_id, template_id) do update
set sort_order = excluded.sort_order;

with book_totals as (
  select
    b.id as book_id,
    b.book_type,
    b.code,
    b.rarity_code,
    count(bi.template_id)::integer as total_count
  from album.books b
  join album.book_items bi on bi.book_id = b.id
  where b.active = true
    and b.book_type in ('all', 'series', 'rarity')
  group by b.id, b.book_type, b.code, b.rarity_code
),
all_milestones as (
  select
    bt.book_id,
    v.required_count,
    v.title,
    v.reward,
    v.sort_order,
    v.metadata,
    10 as priority,
    bt.total_count
  from book_totals bt
  cross join (
    values
      (
        1,
        'First Discovery',
        jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 100)),
        10,
        jsonb_build_object('reward_label', '100 KCOIN')
      ),
      (
        3,
        'Collector III',
        jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 200)),
        30,
        jsonb_build_object('reward_label', '200 FGEMS')
      ),
      (
        6,
        'Collector VI',
        jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 500)),
        60,
        jsonb_build_object('reward_label', '500 KCOIN')
      ),
      (
        12,
        'Complete Launch Album',
        jsonb_build_array(
          jsonb_build_object('currency', 'KCOIN', 'amount', 1000),
          jsonb_build_object('currency', 'FGEMS', 'amount', 500)
        ),
        120,
        jsonb_build_object('reward_label', '1000 KCOIN + 500 FGEMS')
      )
  ) as v(required_count, title, reward, sort_order, metadata)
  where bt.book_type = 'all'
),
series_milestones as (
  select
    bt.book_id,
    v.required_count,
    v.title,
    v.reward,
    v.sort_order,
    v.metadata,
    v.priority,
    bt.total_count
  from book_totals bt
  cross join lateral (
    values
      (
        1,
        'Series First Discovery',
        jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 50)),
        10,
        jsonb_build_object('reward_label', '50 FGEMS'),
        10
      ),
      (
        greatest(1, ceil(bt.total_count::numeric * 0.5)::integer),
        'Series Half Complete',
        jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 150)),
        50,
        jsonb_build_object('reward_label', '150 FGEMS'),
        20
      ),
      (
        bt.total_count,
        'Series Complete',
        jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 500)),
        100,
        jsonb_build_object('reward_label', '500 KCOIN'),
        30
      )
  ) as v(required_count, title, reward, sort_order, metadata, priority)
  where bt.book_type = 'series'
),
rarity_milestones as (
  select
    bt.book_id,
    v.required_count,
    v.title,
    v.reward,
    v.sort_order,
    v.metadata,
    v.priority,
    bt.total_count
  from book_totals bt
  cross join lateral (
    values
      (
        1,
        initcap(lower(bt.rarity_code)) || ' First Discovery',
        case bt.rarity_code
          when 'COMMON' then jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 50))
          when 'RARE' then jsonb_build_array(
            jsonb_build_object('currency', 'KCOIN', 'amount', 100),
            jsonb_build_object('currency', 'FGEMS', 'amount', 50)
          )
          when 'EPIC' then jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 250))
          when 'LEGENDARY' then jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 500))
          else jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 50))
        end,
        10,
        jsonb_build_object('reward_label',
          case bt.rarity_code
            when 'COMMON' then '50 FGEMS'
            when 'RARE' then '100 KCOIN + 50 FGEMS'
            when 'EPIC' then '250 KCOIN'
            when 'LEGENDARY' then '500 KCOIN'
            else '50 FGEMS'
          end
        ),
        10
      ),
      (
        bt.total_count,
        initcap(lower(bt.rarity_code)) || ' Complete',
        case bt.rarity_code
          when 'COMMON' then jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 250))
          when 'RARE' then jsonb_build_array(
            jsonb_build_object('currency', 'KCOIN', 'amount', 400),
            jsonb_build_object('currency', 'FGEMS', 'amount', 150)
          )
          when 'EPIC' then jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 800))
          when 'LEGENDARY' then jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 1500))
          else jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 250))
        end,
        100,
        jsonb_build_object('reward_label',
          case bt.rarity_code
            when 'COMMON' then '250 FGEMS'
            when 'RARE' then '400 KCOIN + 150 FGEMS'
            when 'EPIC' then '800 KCOIN'
            when 'LEGENDARY' then '1500 KCOIN'
            else '250 FGEMS'
          end
        ),
        20
      )
  ) as v(required_count, title, reward, sort_order, metadata, priority)
  where bt.book_type = 'rarity'
),
milestone_rows as (
  select * from all_milestones
  union all
  select * from series_milestones
  union all
  select * from rarity_milestones
),
deduped_milestone_rows as (
  select
    book_id,
    required_count,
    title,
    reward,
    sort_order,
    metadata
  from (
    select
      mr.*,
      row_number() over (
        partition by mr.book_id, mr.required_count
        order by mr.priority desc, mr.sort_order desc
      ) as row_number
    from milestone_rows mr
    where mr.required_count > 0
      and mr.required_count <= mr.total_count
      and jsonb_array_length(mr.reward) > 0
  ) ranked
  where row_number = 1
)
insert into album.milestones (
  book_id,
  required_count,
  title,
  reward,
  active,
  sort_order,
  metadata
)
select
  book_id,
  required_count,
  title,
  reward,
  true,
  sort_order,
  metadata || jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '5.3_album_milestones',
    'source', '009_album_seed'
  )
from deduped_milestone_rows
on conflict (book_id, required_count) do update
set title = excluded.title,
    reward = excluded.reward,
    active = excluded.active,
    sort_order = excluded.sort_order,
    metadata = album.milestones.metadata || excluded.metadata,
    updated_at = now();

insert into album.score_rules (
  code,
  rule_type,
  rarity_code,
  points,
  active,
  metadata
)
values
  (
    'album_discovery_base',
    'discovery',
    null,
    10,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'description', 'Each discovered album template grants base score.',
      'source', '009_album_seed'
    )
  ),
  (
    'album_rarity_common',
    'rarity_bonus',
    'COMMON',
    1,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'source', '009_album_seed'
    )
  ),
  (
    'album_rarity_rare',
    'rarity_bonus',
    'RARE',
    5,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'source', '009_album_seed'
    )
  ),
  (
    'album_rarity_epic',
    'rarity_bonus',
    'EPIC',
    20,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'source', '009_album_seed'
    )
  ),
  (
    'album_rarity_legendary',
    'rarity_bonus',
    'LEGENDARY',
    80,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'source', '009_album_seed'
    )
  ),
  (
    'album_mint_bonus',
    'mint_bonus',
    null,
    30,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'description', 'Each minted NFT grants leaderboard score.',
      'source', '009_album_seed'
    )
  ),
  (
    'album_completion_50',
    'completion_bonus',
    null,
    100,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'required_percent', 50,
      'source', '009_album_seed'
    )
  ),
  (
    'album_completion_80',
    'completion_bonus',
    null,
    300,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'required_percent', 80,
      'source', '009_album_seed'
    )
  ),
  (
    'album_completion_100',
    'completion_bonus',
    null,
    1000,
    true,
    jsonb_build_object(
      'phase', 'stage_3_growth_system',
      'guide_section', '6.1_leaderboard_score_rules',
      'required_percent', 100,
      'source', '009_album_seed'
    )
  )
on conflict (code) do update
set rule_type = excluded.rule_type,
    rarity_code = excluded.rarity_code,
    points = excluded.points,
    active = excluded.active,
    metadata = album.score_rules.metadata || excluded.metadata,
    updated_at = now();

insert into album.weekly_leaderboards (
  week_key,
  starts_at,
  ends_at,
  status,
  metadata
)
values (
  to_char(date_trunc('week', now()), 'IYYY-"W"IW'),
  date_trunc('week', now()),
  date_trunc('week', now()) + interval '1 week',
  'active',
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '6.2_weekly_leaderboard',
    'source', '009_album_seed'
  )
)
on conflict (week_key) do update
set starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    status = case
      when album.weekly_leaderboards.status = 'archived' then album.weekly_leaderboards.status
      else excluded.status
    end,
    metadata = album.weekly_leaderboards.metadata || excluded.metadata,
    updated_at = now();

commit;
