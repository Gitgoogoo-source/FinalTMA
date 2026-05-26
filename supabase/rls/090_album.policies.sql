-- album.policies.sql
-- RLS for collection album progress, milestones and weekly leaderboards.

grant usage on schema album to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema album from anon, authenticated;
grant all privileges on all tables in schema album to service_role;

grant select on table
  album.books,
  album.book_items,
  album.milestones,
  album.weekly_leaderboards,
  album.leaderboard_entries,
  album.score_rules
to anon, authenticated;

grant select on table album.user_discoveries, album.milestone_claims to authenticated;
grant select on public.v_album_books to anon, authenticated;
grant select on public.v_weekly_leaderboard to anon, authenticated;

grant insert, update, delete on table
  album.books,
  album.book_items,
  album.milestones,
  album.weekly_leaderboards,
  album.leaderboard_entries,
  album.score_rules
to authenticated;

alter table album.books enable row level security;
alter table album.book_items enable row level security;
alter table album.user_discoveries enable row level security;
alter table album.milestones enable row level security;
alter table album.milestone_claims enable row level security;
alter table album.weekly_leaderboards enable row level security;
alter table album.leaderboard_entries enable row level security;
alter table album.score_rules enable row level security;

DROP POLICY IF EXISTS album_books_read_public ON album.books;
CREATE POLICY album_books_read_public ON album.books
FOR SELECT TO anon, authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS album_books_admin_read ON album.books;
CREATE POLICY album_books_admin_read ON album.books FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_books_admin_write ON album.books;
CREATE POLICY album_books_admin_write ON album.books FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_book_items_read_public ON album.book_items;
CREATE POLICY album_book_items_read_public ON album.book_items
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from album.books b
    where b.id = book_id
      and b.active = true
      and (b.starts_at is null or b.starts_at <= now())
      and (b.ends_at is null or b.ends_at > now())
  )
);

DROP POLICY IF EXISTS album_book_items_admin_read ON album.book_items;
CREATE POLICY album_book_items_admin_read ON album.book_items FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_book_items_admin_write ON album.book_items;
CREATE POLICY album_book_items_admin_write ON album.book_items FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_discoveries_select_own ON album.user_discoveries;
CREATE POLICY album_discoveries_select_own ON album.user_discoveries
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS album_discoveries_admin_read ON album.user_discoveries;
CREATE POLICY album_discoveries_admin_read ON album.user_discoveries
FOR SELECT TO authenticated
USING (ops.has_admin_permission('album:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS album_milestones_read_public ON album.milestones;
CREATE POLICY album_milestones_read_public ON album.milestones
FOR SELECT TO anon, authenticated
USING (
  active = true
  and exists (
    select 1 from album.books b
    where b.id = book_id
      and b.active = true
      and (b.starts_at is null or b.starts_at <= now())
      and (b.ends_at is null or b.ends_at > now())
  )
);

DROP POLICY IF EXISTS album_milestones_admin_read ON album.milestones;
CREATE POLICY album_milestones_admin_read ON album.milestones FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_milestones_admin_write ON album.milestones;
CREATE POLICY album_milestones_admin_write ON album.milestones FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_claims_select_own ON album.milestone_claims;
CREATE POLICY album_claims_select_own ON album.milestone_claims
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS album_claims_admin_read ON album.milestone_claims;
CREATE POLICY album_claims_admin_read ON album.milestone_claims
FOR SELECT TO authenticated
USING (ops.has_admin_permission('album:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS album_weekly_leaderboards_read_public ON album.weekly_leaderboards;
CREATE POLICY album_weekly_leaderboards_read_public ON album.weekly_leaderboards
FOR SELECT TO anon, authenticated
USING (status in ('active', 'settled'));

DROP POLICY IF EXISTS album_weekly_leaderboards_admin_read ON album.weekly_leaderboards;
CREATE POLICY album_weekly_leaderboards_admin_read ON album.weekly_leaderboards FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_weekly_leaderboards_admin_write ON album.weekly_leaderboards;
CREATE POLICY album_weekly_leaderboards_admin_write ON album.weekly_leaderboards FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_entries_read_public ON album.leaderboard_entries;
CREATE POLICY album_entries_read_public ON album.leaderboard_entries
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from album.weekly_leaderboards wl
    where wl.id = leaderboard_id
      and wl.status in ('active', 'settled')
  )
);

DROP POLICY IF EXISTS album_entries_admin_read ON album.leaderboard_entries;
CREATE POLICY album_entries_admin_read ON album.leaderboard_entries FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_entries_admin_write ON album.leaderboard_entries;
CREATE POLICY album_entries_admin_write ON album.leaderboard_entries FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_score_rules_read_public ON album.score_rules;
CREATE POLICY album_score_rules_read_public ON album.score_rules
FOR SELECT TO anon, authenticated
USING (active = true);

DROP POLICY IF EXISTS album_score_rules_admin_read ON album.score_rules;
CREATE POLICY album_score_rules_admin_read ON album.score_rules FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_score_rules_admin_write ON album.score_rules;
CREATE POLICY album_score_rules_admin_write ON album.score_rules FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));


