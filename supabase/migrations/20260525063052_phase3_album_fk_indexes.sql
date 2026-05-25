-- Fix Supabase performance advisor findings for album foreign keys.
-- Scope is intentionally limited to the album-related unindexed foreign keys
-- reported for the stage-3 growth system.

create index if not exists book_items_template_idx
  on album.book_items (template_id);

create index if not exists books_series_idx
  on album.books (series_id);

create index if not exists books_faction_idx
  on album.books (faction_id);

create index if not exists books_rarity_idx
  on album.books (rarity_code);

create index if not exists milestone_claims_milestone_idx
  on album.milestone_claims (milestone_id);

create index if not exists score_rules_rarity_idx
  on album.score_rules (rarity_code);

create index if not exists user_discoveries_first_item_instance_idx
  on album.user_discoveries (first_item_instance_id);
