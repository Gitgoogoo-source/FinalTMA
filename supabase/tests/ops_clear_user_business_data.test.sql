-- pgTAP coverage for the scheme 2 user business-data reset flow.
-- The real one-off script is scripts/ops/clear-user-7697887701-business-data.sql.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null
)
returns uuid
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := api.auth_upsert_telegram_user(
    p_telegram_user_id := p_telegram_user_id,
    p_username := coalesce(p_username, 'u' || p_telegram_user_id::text),
    p_first_name := 'Ops',
    p_last_name := 'Reset',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.create_catalog_fixture(p_prefix text)
returns jsonb
language plpgsql
as $$
declare
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_form_id uuid;
begin
  insert into catalog.series (slug, display_name, status)
  values (p_prefix || '-series', 'Ops Reset Series', 'active')
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Ops Reset Faction')
  returning id into v_faction_id;

  insert into catalog.collectible_templates (
    slug, display_name, rarity_code, type_code, series_id, faction_id,
    base_power, release_status, tradeable, upgradeable, evolvable, decomposable, nft_mintable
  )
  values (
    p_prefix || '-template', 'Ops Reset Collectible', 'COMMON', 'CHARACTER',
    v_series_id, v_faction_id, 10, 'active', true, true, true, true, true
  )
  returning id into v_template_id;

  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, image_url, thumbnail_url, is_default
  )
  values (
    v_template_id, 1, 'base', 'Base', 'https://example.test/base.png',
    'https://example.test/base-thumb.png', true
  )
  returning id into v_form_id;

  return jsonb_build_object(
    'template_id', v_template_id,
    'form_id', v_form_id
  );
end;
$$;

create or replace function testutil.create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid,
  p_status text default 'available'
)
returns uuid
language plpgsql
as $$
declare
  v_item_id uuid;
begin
  insert into inventory.item_instances (
    owner_user_id, template_id, form_id, level, power, status, source_type, metadata
  )
  values (
    p_user_id, p_template_id, p_form_id, 1, 10, p_status, 'admin',
    jsonb_build_object('fixture', true)
  )
  returning id into v_item_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, after_state)
  values (v_item_id, p_user_id, 'created', 'admin', jsonb_build_object('fixture', true));

  return v_item_id;
end;
$$;

create or replace function testutil.run_scheme2_business_reset(p_telegram_user_id bigint)
returns void
language plpgsql
as $$
declare
  v_reason text := 'scheme2 business reset pgTAP';
  v_user_id uuid;
  v_now timestamptz := now();
  v_before jsonb;
  v_after jsonb;
  v_balance record;
begin
  drop table if exists _business_reset_items;
  drop table if exists _business_reset_listings;
  drop table if exists _business_reset_draw_orders;
  drop table if exists _business_reset_star_orders;

  create temp table _business_reset_items (id uuid primary key) on commit drop;
  create temp table _business_reset_listings (id uuid primary key) on commit drop;
  create temp table _business_reset_draw_orders (id uuid primary key) on commit drop;
  create temp table _business_reset_star_orders (id uuid primary key) on commit drop;

  select id
  into v_user_id
  from core.users
  where telegram_user_id = p_telegram_user_id
  for update;

  if v_user_id is null then
    raise exception 'TARGET_USER_NOT_FOUND:%', p_telegram_user_id;
  end if;

  insert into _business_reset_items (id)
  select id from inventory.item_instances where owner_user_id = v_user_id
  union
  select item_instance_id from inventory.item_instance_events where user_id = v_user_id
  union
  select item_instance_id from gacha.draw_results where user_id = v_user_id and item_instance_id is not null
  union
  select item_instance_id from inventory.inventory_locks where user_id = v_user_id;

  insert into _business_reset_listings (id)
  select id from market.listings where seller_user_id = v_user_id
  union
  select listing_id from market.listing_items where buyer_user_id = v_user_id
  union
  select listing_id from market.listing_items where item_instance_id in (select id from _business_reset_items);

  insert into _business_reset_draw_orders (id)
  select id from gacha.draw_orders where user_id = v_user_id
  union
  select draw_order_id from gacha.draw_results where user_id = v_user_id;

  insert into _business_reset_star_orders (id)
  select id from payments.star_orders where user_id = v_user_id;

  if exists (
    select 1
    from onchain.nft_items
    where owner_user_id = v_user_id
      and status in ('minted', 'transferred', 'burned')
  ) then
    raise exception 'TARGET_HAS_ONCHAIN_NFTS_MANUAL_REVIEW_REQUIRED:%', v_user_id;
  end if;

  if exists (
    select 1
    from onchain.mint_queue
    where user_id = v_user_id
      and status in ('queued', 'processing', 'submitted', 'confirming', 'retrying', 'manual_review')
  ) then
    raise exception 'TARGET_HAS_ACTIVE_MINT_QUEUE_MANUAL_REVIEW_REQUIRED:%', v_user_id;
  end if;

  v_before := jsonb_build_object(
    'items', (select count(*) from _business_reset_items),
    'listings', (select count(*) from _business_reset_listings),
    'draw_orders', (select count(*) from _business_reset_draw_orders),
    'star_orders', (select count(*) from _business_reset_star_orders)
  );

  update core.user_profiles
  set selected_item_instance_id = null,
      ui_settings = '{}'::jsonb,
      updated_at = v_now
  where user_id = v_user_id;

  update payments.star_orders
  set status = case
        when status in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked')
          then 'cancelled'
        else status
      end,
      business_id = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'reason', v_reason)
      ),
      updated_at = v_now
  where user_id = v_user_id;

  update payments.star_invoices
  set status = case when status in ('created', 'sent', 'opened') then 'expired' else status end,
      updated_at = v_now
  where star_order_id in (select id from _business_reset_star_orders);

  delete from ops.telegram_init_data_consumptions where user_id = v_user_id;
  delete from core.app_sessions where user_id = v_user_id;
  delete from core.user_api_tokens where user_id = v_user_id;
  delete from core.wallet_proofs where user_id = v_user_id;
  delete from core.user_wallets where user_id = v_user_id;
  delete from core.user_devices where user_id = v_user_id;
  delete from core.notifications where user_id = v_user_id;
  delete from ops.idempotency_keys where user_id = v_user_id;
  update ops.app_events set user_id = null where user_id = v_user_id;

  delete from tasks.referral_rewards where user_id = v_user_id;
  delete from tasks.referral_commissions where inviter_user_id = v_user_id or invitee_user_id = v_user_id;
  delete from tasks.referrals where inviter_user_id = v_user_id or invitee_user_id = v_user_id;
  delete from tasks.share_events where user_id = v_user_id;
  delete from tasks.task_claims where user_id = v_user_id;
  delete from tasks.user_task_progress where user_id = v_user_id;
  delete from tasks.user_signins where user_id = v_user_id;
  delete from tasks.user_signin_states where user_id = v_user_id;

  delete from album.milestone_claims where user_id = v_user_id;
  delete from album.leaderboard_entries where user_id = v_user_id;
  delete from album.user_discoveries where user_id = v_user_id;

  delete from market.order_items
  where order_id in (
    select id from market.orders
    where buyer_user_id = v_user_id or seller_user_id = v_user_id or listing_id in (select id from _business_reset_listings)
  )
     or listing_item_id in (
       select id from market.listing_items
       where listing_id in (select id from _business_reset_listings)
          or item_instance_id in (select id from _business_reset_items)
     )
     or item_instance_id in (select id from _business_reset_items);

  delete from market.orders
  where buyer_user_id = v_user_id or seller_user_id = v_user_id or listing_id in (select id from _business_reset_listings);

  delete from market.listing_items
  where listing_id in (select id from _business_reset_listings)
     or buyer_user_id = v_user_id
     or item_instance_id in (select id from _business_reset_items);

  delete from market.listing_events
  where user_id = v_user_id or listing_id in (select id from _business_reset_listings);

  delete from market.listings
  where seller_user_id = v_user_id or id in (select id from _business_reset_listings);

  delete from gacha.draw_audit
  where user_id = v_user_id or draw_order_id in (select id from _business_reset_draw_orders);

  delete from gacha.draw_results
  where user_id = v_user_id
     or draw_order_id in (select id from _business_reset_draw_orders)
     or item_instance_id in (select id from _business_reset_items);

  delete from gacha.draw_orders
  where user_id = v_user_id or id in (select id from _business_reset_draw_orders);

  delete from gacha.user_pity_states where user_id = v_user_id;

  delete from onchain.wallet_nft_snapshots where user_id = v_user_id;
  delete from onchain.wallet_sync_jobs where user_id = v_user_id;
  delete from onchain.mint_queue where user_id = v_user_id or item_instance_id in (select id from _business_reset_items);

  delete from inventory.evolution_consumed_items
  where attempt_id in (select id from inventory.evolution_attempts where user_id = v_user_id)
     or item_instance_id in (select id from _business_reset_items);
  delete from inventory.evolution_attempts where user_id = v_user_id;
  delete from inventory.decompose_logs where user_id = v_user_id or item_instance_id in (select id from _business_reset_items);
  delete from inventory.upgrade_logs where user_id = v_user_id or item_instance_id in (select id from _business_reset_items);
  delete from inventory.inventory_locks where user_id = v_user_id or item_instance_id in (select id from _business_reset_items);
  delete from inventory.item_instance_events where user_id = v_user_id or item_instance_id in (select id from _business_reset_items);
  delete from inventory.item_instances where id in (select id from _business_reset_items);

  for v_balance in
    select currency_code, available_amount
    from economy.user_balances
    where user_id = v_user_id and available_amount > 0
    order by currency_code
  loop
    perform api.economy_debit(
      p_user_id => v_user_id,
      p_currency_code => v_balance.currency_code,
      p_amount => v_balance.available_amount,
      p_source_type => 'business_reset',
      p_source_id => v_user_id,
      p_source_ref => 'telegram_user_id:' || p_telegram_user_id::text,
      p_idempotency_key => 'business_reset:telegram:' || p_telegram_user_id::text || ':debit:' || v_balance.currency_code,
      p_note => v_reason,
      p_metadata => jsonb_build_object('reason', v_reason, 'telegram_user_id', p_telegram_user_id)
    );
  end loop;

  delete from economy.balance_locks where user_id = v_user_id;

  update core.users
  set referred_by_user_id = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'reason', v_reason)
      ),
      updated_at = v_now
  where id = v_user_id;

  v_after := jsonb_build_object(
    'owned_items', (select count(*) from inventory.item_instances where owner_user_id = v_user_id),
    'listings', (select count(*) from market.listings where seller_user_id = v_user_id),
    'draw_orders', (select count(*) from gacha.draw_orders where user_id = v_user_id)
  );

  insert into ops.admin_audit_logs (
    action, target_schema, target_table, target_id, before_state, after_state, reason
  )
  values (
    'user.business_data_reset.scheme2', 'core', 'users', v_user_id, v_before, v_after, v_reason
  );
end;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;

insert into _ids (key, id) values ('user', testutil.make_user(7697887701, 'ops_clear_target'));
insert into _ids (key, id) values ('other', testutil.make_user(7697887702, 'ops_clear_other'));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('ops-clear-user-reset'));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;
insert into _ids (key, id) select 'item_available', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'available');
insert into _ids (key, id) select 'item_listed', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'listed');

update core.user_profiles
set selected_item_instance_id = (select id from _ids where key = 'item_available'),
    ui_settings = '{"selected":"fixture"}'::jsonb
where user_id = (select id from _ids where key = 'user');

insert into _ids (key, payload)
select 'kcoin_credit', api.economy_credit(
  (select id from _ids where key = 'user'),
  'KCOIN',
  1000,
  'test_setup',
  null,
  'ops-clear-kcoin',
  'ops-clear-kcoin-credit',
  'fixture',
  '{}'::jsonb
);

insert into _ids (key, payload)
select 'fgems_credit', api.economy_credit(
  (select id from _ids where key = 'user'),
  'FGEMS',
  500,
  'test_setup',
  null,
  'ops-clear-fgems',
  'ops-clear-fgems-credit',
  'fixture',
  '{}'::jsonb
);

with inserted as (
  insert into market.listings (
  seller_user_id, template_id, form_id, rarity_code, status,
  item_count, remaining_count, unit_price_kcoin, expected_net_amount
  )
  values (
    (select id from _ids where key = 'user'),
    (select id from _ids where key = 'template'),
    (select id from _ids where key = 'form'),
    'COMMON',
    'active',
    1,
    1,
    120,
    114
  )
  returning id
)
insert into _ids (key, id)
select 'listing', id from inserted;

insert into market.listing_items (listing_id, item_instance_id, status)
values ((select id from _ids where key = 'listing'), (select id from _ids where key = 'item_listed'), 'reserved');

insert into market.listing_events (listing_id, user_id, event_type, after_state)
values ((select id from _ids where key = 'listing'), (select id from _ids where key = 'user'), 'created', '{"fixture":true}'::jsonb);

insert into inventory.inventory_locks (
  item_instance_id, user_id, lock_type, source_type, source_id, status
)
values (
  (select id from _ids where key = 'item_listed'),
  (select id from _ids where key = 'user'),
  'market_listing',
  'market_listing',
  (select id from _ids where key = 'listing'),
  'active'
);

with inserted as (
  insert into gacha.blind_boxes (slug, display_name, tier, status, price_stars)
  values ('ops-clear-user-box', 'Ops Clear Box', 'normal', 'active', 10)
  returning id
)
insert into _ids (key, id)
select 'box', id from inserted;

with inserted as (
  insert into gacha.drop_pool_versions (box_id, version_no, status, total_weight, published_at)
  values ((select id from _ids where key = 'box'), 1, 'active', 1, now())
  returning id
)
insert into _ids (key, id)
select 'pool', id from inserted;

with inserted as (
  insert into gacha.drop_pool_items (pool_version_id, template_id, form_id, rarity_code, drop_weight)
  values ((select id from _ids where key = 'pool'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 'COMMON', 1)
  returning id
)
insert into _ids (key, id)
select 'drop_item', id from inserted;

with inserted as (
  insert into payments.star_orders (
  user_id, business_type, status, xtr_amount, telegram_invoice_payload, title, idempotency_key
  )
  values (
    (select id from _ids where key = 'user'),
    'gacha_open',
    'created',
    10,
    'ops-clear-pending-payload',
    'Pending Fixture',
    'ops-clear-pending-order'
  )
  returning id
)
insert into _ids (key, id)
select 'pending_star_order', id from inserted;

insert into payments.star_invoices (star_order_id, payload, status)
values ((select id from _ids where key = 'pending_star_order'), 'ops-clear-pending-payload', 'sent');

with inserted as (
  insert into payments.star_orders (
  user_id, business_type, status, xtr_amount, telegram_invoice_payload, title, idempotency_key
  )
  values (
    (select id from _ids where key = 'user'),
    'gacha_open',
    'fulfilled',
    10,
    'ops-clear-fulfilled-payload',
    'Fulfilled Fixture',
    'ops-clear-fulfilled-order'
  )
  returning id
)
insert into _ids (key, id)
select 'fulfilled_star_order', id from inserted;

insert into payments.star_payments (
  star_order_id, user_id, telegram_payment_charge_id, xtr_amount, invoice_payload
)
values (
  (select id from _ids where key = 'fulfilled_star_order'),
  (select id from _ids where key = 'user'),
  'ops-clear-charge-001',
  10,
  'ops-clear-fulfilled-payload'
);

with inserted as (
  insert into gacha.draw_orders (
  user_id, box_id, pool_version_id, payment_star_order_id, status,
  quantity, draw_count, unit_price_stars, total_price_stars, invoice_payload, idempotency_key
  )
  values (
    (select id from _ids where key = 'user'),
    (select id from _ids where key = 'box'),
    (select id from _ids where key = 'pool'),
    (select id from _ids where key = 'fulfilled_star_order'),
    'opened',
    1,
    1,
    10,
    10,
    'ops-clear-draw-payload',
    'ops-clear-draw-order'
  )
  returning id
)
insert into _ids (key, id)
select 'draw_order', id from inserted;

update payments.star_orders
set business_id = (select id from _ids where key = 'draw_order')
where id = (select id from _ids where key = 'fulfilled_star_order');

insert into gacha.draw_results (
  draw_order_id, user_id, box_id, pool_version_id, draw_index, drop_pool_item_id,
  item_instance_id, template_id, form_id, rarity_code
)
values (
  (select id from _ids where key = 'draw_order'),
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'box'),
  (select id from _ids where key = 'pool'),
  1,
  (select id from _ids where key = 'drop_item'),
  (select id from _ids where key = 'item_available'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form'),
  'COMMON'
);

insert into gacha.draw_audit (draw_order_id, user_id, pool_version_id)
values ((select id from _ids where key = 'draw_order'), (select id from _ids where key = 'user'), (select id from _ids where key = 'pool'));

with inserted as (
  insert into gacha.pity_rules (box_id, pool_version_id, rule_name, threshold, target_rarity_code)
  values ((select id from _ids where key = 'box'), (select id from _ids where key = 'pool'), 'Ops Clear Pity', 10, 'COMMON')
  returning id
)
insert into _ids (key, id)
select 'pity', id from inserted;

insert into gacha.user_pity_states (user_id, box_id, pity_rule_id, current_count, total_draws)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), (select id from _ids where key = 'pity'), 3, 3);

with inserted as (
  insert into tasks.task_definitions (code, task_type, title, period_type, target_count, reward, action_type)
  values ('ops-clear-task', 'daily', 'Ops Clear Task', 'daily', 1, '[]'::jsonb, 'none')
  returning id
)
insert into _ids (key, id)
select 'task', id from inserted;

insert into tasks.user_task_progress (user_id, task_id, period_key, progress_count, target_count, status)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'task'), '2026-06-04', 1, 1, 'completed');

insert into tasks.task_claims (user_id, task_id, period_key)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'task'), '2026-06-04');

with inserted as (
  insert into tasks.signin_campaigns (code, title)
  values ('ops-clear-signin', 'Ops Clear Signin')
  returning id
)
insert into _ids (key, id)
select 'campaign', id from inserted;

insert into tasks.user_signins (user_id, campaign_id, day_index, signin_date)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'campaign'), 1, current_date);

insert into tasks.user_signin_states (user_id, campaign_id, current_streak, cycle_position, last_signin_date, total_signins)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'campaign'), 1, 1, current_date, 1);

with inserted as (
  insert into album.books (code, display_name, book_type)
  values ('ops-clear-book', 'Ops Clear Book', 'all')
  returning id
)
insert into _ids (key, id)
select 'book', id from inserted;

insert into album.book_items (book_id, template_id)
values ((select id from _ids where key = 'book'), (select id from _ids where key = 'template'));

insert into album.user_discoveries (user_id, template_id, first_item_instance_id)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'item_available'))
on conflict (user_id, template_id) do update
set first_item_instance_id = excluded.first_item_instance_id,
    first_source_type = 'test_setup',
    metadata = coalesce(album.user_discoveries.metadata, '{}'::jsonb) || jsonb_build_object('fixture', true);

with inserted as (
  insert into album.milestones (book_id, required_count, title)
  values ((select id from _ids where key = 'book'), 1, 'Ops Clear Milestone')
  returning id
)
insert into _ids (key, id)
select 'milestone', id from inserted;

insert into album.milestone_claims (user_id, milestone_id)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'milestone'));

with inserted as (
  insert into album.weekly_leaderboards (week_key, starts_at, ends_at)
  values ('ops-clear-week', now(), now() + interval '7 days')
  returning id
)
insert into _ids (key, id)
select 'leaderboard', id from inserted;

insert into album.leaderboard_entries (leaderboard_id, user_id, score)
values ((select id from _ids where key = 'leaderboard'), (select id from _ids where key = 'user'), 10);

with inserted as (
  insert into core.app_sessions (user_id, session_token_hash, expires_at)
  values ((select id from _ids where key = 'user'), 'ops-clear-session-hash', now() + interval '1 hour')
  returning id
)
insert into _ids (key, id)
select 'session', id from inserted;

insert into ops.telegram_init_data_consumptions (user_id, init_data_hash, consumed_until, session_id)
values ((select id from _ids where key = 'user'), 'ops-clear-init-data-hash', now() + interval '1 hour', (select id from _ids where key = 'session'));

insert into core.user_devices (user_id, device_key)
values ((select id from _ids where key = 'user'), 'ops-clear-device');

insert into core.wallet_proofs (user_id, challenge, status, expires_at)
values ((select id from _ids where key = 'user'), 'ops-clear-wallet-proof', 'pending', now() + interval '1 hour');

insert into core.notifications (user_id, notification_type)
values ((select id from _ids where key = 'user'), 'ops_clear_fixture');

insert into ops.app_events (user_id, event_name)
values ((select id from _ids where key = 'user'), 'ops_clear_fixture');

select testutil.run_scheme2_business_reset(7697887701);

select ok(exists (select 1 from core.users where telegram_user_id = 7697887701 and status = 'active'), 'target core.users row is preserved');
select is((select count(*)::int from inventory.item_instances where owner_user_id = (select id from _ids where key = 'user')), 0, 'owned inventory is cleared');
select is((select count(*)::int from inventory.item_instance_events where user_id = (select id from _ids where key = 'user')), 0, 'inventory events are cleared for user');
select is((select count(*)::int from inventory.inventory_locks where user_id = (select id from _ids where key = 'user')), 0, 'inventory locks are cleared');
select is((select count(*)::int from market.listings where seller_user_id = (select id from _ids where key = 'user')), 0, 'market listings are cleared');
select is((select count(*)::int from gacha.draw_orders where user_id = (select id from _ids where key = 'user')), 0, 'gacha draw orders are cleared');
select is((select count(*)::int from gacha.draw_results where user_id = (select id from _ids where key = 'user')), 0, 'gacha draw results are cleared');
select is((select count(*)::int from tasks.user_task_progress where user_id = (select id from _ids where key = 'user')), 0, 'task progress is cleared');
select is((select count(*)::int from tasks.task_claims where user_id = (select id from _ids where key = 'user')), 0, 'task claims are cleared');
select is((select count(*)::int from album.user_discoveries where user_id = (select id from _ids where key = 'user')), 0, 'album discoveries are cleared');
select is((select count(*)::int from core.app_sessions where user_id = (select id from _ids where key = 'user')), 0, 'sessions are cleared');
select is((select count(*)::int from ops.telegram_init_data_consumptions where user_id = (select id from _ids where key = 'user')), 0, 'initData replay rows are cleared');
select is((select count(*)::int from core.wallet_proofs where user_id = (select id from _ids where key = 'user')), 0, 'wallet proof rows are cleared');
select is((select count(*)::int from core.notifications where user_id = (select id from _ids where key = 'user')), 0, 'notifications are cleared');
select is((select count(*)::int from payments.star_orders where user_id = (select id from _ids where key = 'user')), 2, 'star orders are preserved');
select is((select count(*)::int from payments.star_payments where user_id = (select id from _ids where key = 'user')), 1, 'star payment records are preserved');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'pending_star_order')), 'cancelled', 'pending star order is cancelled');
select is((select status from payments.star_orders where id = (select id from _ids where key = 'fulfilled_star_order')), 'fulfilled', 'fulfilled star order status is preserved');
select is((select business_id from payments.star_orders where id = (select id from _ids where key = 'fulfilled_star_order')), null, 'payment business pointer is detached');
select is((select available_amount from economy.user_balances where user_id = (select id from _ids where key = 'user') and currency_code = 'KCOIN'), 0::numeric, 'KCOIN balance is reset to zero');
select is((select available_amount from economy.user_balances where user_id = (select id from _ids where key = 'user') and currency_code = 'FGEMS'), 0::numeric, 'FGEMS balance is reset to zero');
select is((select locked_amount from economy.user_balances where user_id = (select id from _ids where key = 'user') and currency_code = 'KCOIN'), 0::numeric, 'KCOIN locked balance is zero');
select is((select count(*)::int from economy.currency_ledger where user_id = (select id from _ids where key = 'user')), 4, 'ledger is preserved and receives reset debit entries');
select ok(exists (
  select 1
  from economy.currency_ledger
  where user_id = (select id from _ids where key = 'user')
    and source_type = 'business_reset'
    and idempotency_key = 'business_reset:telegram:7697887701:debit:KCOIN'
), 'reset debit ledger exists for KCOIN');
select ok(exists (
  select 1
  from ops.admin_audit_logs
  where action = 'user.business_data_reset.scheme2'
    and target_id = (select id from _ids where key = 'user')
), 'reset audit log is written');
select is((select selected_item_instance_id from core.user_profiles where user_id = (select id from _ids where key = 'user')), null, 'selected item is cleared from profile');
select is((select count(*)::int from ops.app_events where user_id = (select id from _ids where key = 'user')), 0, 'app events are detached from user');

select * from finish();

rollback;
