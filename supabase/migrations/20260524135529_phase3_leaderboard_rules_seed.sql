begin;

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
      'description', 'Each discovered album template grants base score.'
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
      'guide_section', '6.1_leaderboard_score_rules'
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
      'guide_section', '6.1_leaderboard_score_rules'
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
      'guide_section', '6.1_leaderboard_score_rules'
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
      'guide_section', '6.1_leaderboard_score_rules'
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
      'description', 'Each minted NFT grants leaderboard score.'
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
      'required_percent', 50
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
      'required_percent', 80
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
      'required_percent', 100
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
    'source', 'phase3_leaderboard_rules_seed'
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
