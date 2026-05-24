-- 20260521071217_0019_create_constraints.sql
-- Cross-schema foreign keys, uniqueness, indexes, updated_at triggers and integrity triggers.

-- Cross-schema foreign keys that could not be declared before dependent tables existed.
alter table core.user_profiles
  add constraint user_profiles_selected_item_instance_fk
  foreign key (selected_item_instance_id) references inventory.item_instances(id) on delete set null;

alter table gacha.draw_orders
  add constraint draw_orders_payment_star_order_fk
  foreign key (payment_star_order_id) references payments.star_orders(id) on delete set null;

alter table gacha.draw_results
  add constraint draw_results_item_instance_fk
  foreign key (item_instance_id) references inventory.item_instances(id) on delete set null;

alter table market.listing_items
  add constraint listing_items_sold_order_fk
  foreign key (sold_order_id) references market.orders(id) on delete set null;

alter table inventory.item_instances
  add constraint item_instances_minted_nft_item_fk
  foreign key (minted_nft_item_id) references onchain.nft_items(id) on delete set null;

alter table tasks.referrals
  add constraint referrals_first_open_order_fk
  foreign key (first_open_order_id) references gacha.draw_orders(id) on delete set null;

-- Strong uniqueness and anti-double-spend indexes.
create unique index if not exists user_wallets_unique_user_chain_network_address
  on core.user_wallets (user_id, chain, network, address);

create unique index if not exists user_wallets_one_primary_connected_per_network
  on core.user_wallets (user_id, chain, network)
  where is_primary = true and status = 'connected';

create unique index if not exists drop_pool_versions_one_active_per_box
  on gacha.drop_pool_versions (box_id)
  where status = 'active';

create unique index if not exists collectible_forms_one_default_per_template
  on catalog.collectible_forms (template_id)
  where is_default = true;

create unique index if not exists inventory_one_active_lock_per_item
  on inventory.inventory_locks (item_instance_id)
  where status = 'active';

create unique index if not exists market_one_reserved_listing_item_per_instance
  on market.listing_items (item_instance_id)
  where status = 'reserved';

create unique index if not exists market_active_listing_item_instance_unique
  on market.listing_items (item_instance_id, status)
  where status = 'reserved';

create unique index if not exists mint_queue_one_active_per_item
  on onchain.mint_queue (item_instance_id)
  where status in ('queued', 'processing');

create unique index if not exists leaderboard_rank_unique_per_board
  on album.leaderboard_entries (leaderboard_id, rank)
  where rank is not null;

create unique index if not exists referral_commission_unique_source
  on tasks.referral_commissions (referral_id, source_type, source_id)
  where source_id is not null;

-- Performance indexes: core.
create index if not exists users_invite_code_idx on core.users (invite_code);
create index if not exists users_status_idx on core.users (status);
create index if not exists users_username_trgm_idx on core.users using gin ((username::text) gin_trgm_ops);
create index if not exists app_sessions_user_expires_idx on core.app_sessions (user_id, expires_at desc);
create index if not exists user_wallets_user_status_idx on core.user_wallets (user_id, status);
create index if not exists notifications_user_unread_idx on core.notifications (user_id, created_at desc) where read_at is null;

-- Performance indexes: economy.
create index if not exists user_balances_user_idx on economy.user_balances (user_id);
create index if not exists currency_ledger_user_created_idx on economy.currency_ledger (user_id, created_at desc);
create index if not exists currency_ledger_source_idx on economy.currency_ledger (source_type, source_id);
create index if not exists balance_locks_user_status_idx on economy.balance_locks (user_id, status);

-- Performance indexes: catalog.
create index if not exists collectible_templates_rarity_idx on catalog.collectible_templates (rarity_code);
create index if not exists collectible_templates_type_idx on catalog.collectible_templates (type_code);
create index if not exists collectible_templates_series_idx on catalog.collectible_templates (series_id);
create index if not exists collectible_templates_status_sort_idx on catalog.collectible_templates (release_status, sort_order);
create index if not exists collectible_forms_template_idx on catalog.collectible_forms (template_id, form_index);
create index if not exists collectible_media_template_form_idx on catalog.collectible_media (template_id, form_id, media_type);
create index if not exists banner_campaigns_placement_status_idx on catalog.banner_campaigns (placement, status, sort_order);

-- Performance indexes: gacha.
create index if not exists blind_boxes_status_sort_idx on gacha.blind_boxes (status, sort_order);
create index if not exists drop_pool_items_pool_weight_idx on gacha.drop_pool_items (pool_version_id, sort_order, drop_weight);
create index if not exists drop_pool_items_stock_idx on gacha.drop_pool_items (pool_version_id) where stock_remaining is null or stock_remaining > 0;
create index if not exists user_pity_states_user_box_idx on gacha.user_pity_states (user_id, box_id);
create index if not exists draw_orders_user_created_idx on gacha.draw_orders (user_id, created_at desc);
create index if not exists draw_orders_payment_idx on gacha.draw_orders (payment_star_order_id);
create index if not exists draw_results_user_created_idx on gacha.draw_results (user_id, created_at desc);

-- Performance indexes: inventory.
create index if not exists item_instances_owner_status_idx on inventory.item_instances (owner_user_id, status);
create index if not exists item_instances_template_form_idx on inventory.item_instances (template_id, form_id);
create index if not exists item_instances_owner_template_status_idx on inventory.item_instances (owner_user_id, template_id, form_id, status);
create index if not exists item_instance_events_item_created_idx on inventory.item_instance_events (item_instance_id, created_at desc);
create index if not exists upgrade_logs_user_created_idx on inventory.upgrade_logs (user_id, created_at desc);
create index if not exists evolution_attempts_user_created_idx on inventory.evolution_attempts (user_id, created_at desc);
create index if not exists decompose_logs_user_created_idx on inventory.decompose_logs (user_id, created_at desc);

-- Performance indexes: market.
create index if not exists listings_status_created_idx on market.listings (status, created_at desc);
create index if not exists listings_template_form_price_idx on market.listings (template_id, form_id, unit_price_kcoin) where status in ('active', 'partially_sold');
create index if not exists listings_seller_status_idx on market.listings (seller_user_id, status, created_at desc);
create index if not exists listing_items_listing_status_idx on market.listing_items (listing_id, status);
create index if not exists market_orders_buyer_created_idx on market.orders (buyer_user_id, created_at desc);
create index if not exists market_orders_seller_created_idx on market.orders (seller_user_id, created_at desc);
create index if not exists price_snapshots_template_time_idx on market.price_snapshots (template_id, form_id, snapshot_at desc);
create index if not exists depth_snapshots_template_time_idx on market.depth_snapshots (template_id, form_id, snapshot_at desc);

-- Performance indexes: payments.
create index if not exists star_orders_user_status_idx on payments.star_orders (user_id, status, created_at desc);
create index if not exists star_orders_payload_idx on payments.star_orders (telegram_invoice_payload);
create index if not exists star_payments_user_paid_idx on payments.star_payments (user_id, paid_at desc);
create index if not exists telegram_webhook_events_status_idx on payments.telegram_webhook_events (process_status, created_at desc);

-- Performance indexes: tasks.
create index if not exists task_progress_user_status_idx on tasks.user_task_progress (user_id, status);
create index if not exists task_claims_user_claimed_idx on tasks.task_claims (user_id, claimed_at desc);
create index if not exists user_signins_user_campaign_idx on tasks.user_signins (user_id, campaign_id, signin_date desc);
create index if not exists referrals_inviter_status_idx on tasks.referrals (inviter_user_id, status);
create index if not exists referral_commissions_inviter_created_idx on tasks.referral_commissions (inviter_user_id, created_at desc);

-- Performance indexes: album.
create index if not exists user_discoveries_user_idx on album.user_discoveries (user_id, discovered_at desc);
create index if not exists user_discoveries_template_idx on album.user_discoveries (template_id);
create index if not exists milestone_claims_user_idx on album.milestone_claims (user_id, claimed_at desc);
create index if not exists leaderboard_entries_board_rank_idx on album.leaderboard_entries (leaderboard_id, rank);
create index if not exists leaderboard_entries_user_idx on album.leaderboard_entries (user_id);

-- Performance indexes: onchain and ops.
create index if not exists nft_items_owner_user_idx on onchain.nft_items (owner_user_id, status);
create index if not exists nft_items_collection_index_idx on onchain.nft_items (collection_id, item_index);
create index if not exists mint_queue_status_next_idx on onchain.mint_queue (status, next_attempt_at, priority);
create index if not exists onchain_transactions_related_idx on onchain.transactions (related_type, related_id);
create index if not exists wallet_sync_jobs_user_status_idx on onchain.wallet_sync_jobs (user_id, status, created_at desc);
create index if not exists risk_events_user_status_idx on ops.risk_events (user_id, status, created_at desc);
create index if not exists admin_audit_target_idx on ops.admin_audit_logs (target_schema, target_table, target_id, created_at desc);
create index if not exists app_events_user_event_idx on ops.app_events (user_id, event_name, created_at desc);

-- GIN indexes for common JSON metadata queries.
create index if not exists users_metadata_gin_idx on core.users using gin (metadata);
create index if not exists collectible_templates_metadata_gin_idx on catalog.collectible_templates using gin (metadata);
create index if not exists draw_orders_metadata_gin_idx on gacha.draw_orders using gin (metadata);
create index if not exists item_instances_metadata_gin_idx on inventory.item_instances using gin (metadata);
create index if not exists listings_metadata_gin_idx on market.listings using gin (metadata);
create index if not exists webhook_payload_gin_idx on payments.telegram_webhook_events using gin (payload);

-- Updated_at triggers.
create trigger core_users_set_updated_at before update on core.users for each row execute function core.set_updated_at();
create trigger core_profiles_set_updated_at before update on core.user_profiles for each row execute function core.set_updated_at();
create trigger core_wallets_set_updated_at before update on core.user_wallets for each row execute function core.set_updated_at();
create trigger core_flags_set_updated_at before update on core.user_flags for each row execute function core.set_updated_at();

create trigger economy_balances_set_updated_at before update on economy.user_balances for each row execute function core.set_updated_at();
create trigger economy_locks_set_updated_at before update on economy.balance_locks for each row execute function core.set_updated_at();
create trigger reward_rules_set_updated_at before update on economy.reward_rules for each row execute function core.set_updated_at();
create trigger fee_rules_set_updated_at before update on economy.fee_rules for each row execute function core.set_updated_at();

create trigger series_set_updated_at before update on catalog.series for each row execute function core.set_updated_at();
create trigger factions_set_updated_at before update on catalog.factions for each row execute function core.set_updated_at();
create trigger collectible_templates_set_updated_at before update on catalog.collectible_templates for each row execute function core.set_updated_at();
create trigger collectible_forms_set_updated_at before update on catalog.collectible_forms for each row execute function core.set_updated_at();
create trigger power_rules_set_updated_at before update on catalog.power_rules for each row execute function core.set_updated_at();
create trigger market_price_rules_set_updated_at before update on catalog.market_price_rules for each row execute function core.set_updated_at();
create trigger banner_campaigns_set_updated_at before update on catalog.banner_campaigns for each row execute function core.set_updated_at();

create trigger blind_boxes_set_updated_at before update on gacha.blind_boxes for each row execute function core.set_updated_at();
create trigger box_price_rules_set_updated_at before update on gacha.box_price_rules for each row execute function core.set_updated_at();
create trigger drop_pool_versions_set_updated_at before update on gacha.drop_pool_versions for each row execute function core.set_updated_at();
create trigger drop_pool_items_set_updated_at before update on gacha.drop_pool_items for each row execute function core.set_updated_at();
create trigger pity_rules_set_updated_at before update on gacha.pity_rules for each row execute function core.set_updated_at();
create trigger user_pity_states_set_updated_at before update on gacha.user_pity_states for each row execute function core.set_updated_at();
create trigger draw_orders_set_updated_at before update on gacha.draw_orders for each row execute function core.set_updated_at();

create trigger item_instances_set_updated_at before update on inventory.item_instances for each row execute function core.set_updated_at();
create trigger inventory_locks_set_updated_at before update on inventory.inventory_locks for each row execute function core.set_updated_at();
create trigger upgrade_rules_set_updated_at before update on inventory.upgrade_rules for each row execute function core.set_updated_at();
create trigger evolution_rules_set_updated_at before update on inventory.evolution_rules for each row execute function core.set_updated_at();
create trigger decompose_rules_set_updated_at before update on inventory.decompose_rules for each row execute function core.set_updated_at();

create trigger listings_set_updated_at before update on market.listings for each row execute function core.set_updated_at();
create trigger market_orders_set_updated_at before update on market.orders for each row execute function core.set_updated_at();
create trigger price_health_rules_set_updated_at before update on market.price_health_rules for each row execute function core.set_updated_at();

create trigger star_orders_set_updated_at before update on payments.star_orders for each row execute function core.set_updated_at();
create trigger star_invoices_set_updated_at before update on payments.star_invoices for each row execute function core.set_updated_at();
create trigger star_refunds_set_updated_at before update on payments.star_refunds for each row execute function core.set_updated_at();
create trigger payment_disputes_set_updated_at before update on payments.payment_disputes for each row execute function core.set_updated_at();

create trigger task_definitions_set_updated_at before update on tasks.task_definitions for each row execute function core.set_updated_at();
create trigger task_progress_set_updated_at before update on tasks.user_task_progress for each row execute function core.set_updated_at();
create trigger signin_campaigns_set_updated_at before update on tasks.signin_campaigns for each row execute function core.set_updated_at();
create trigger referrals_set_updated_at before update on tasks.referrals for each row execute function core.set_updated_at();

create trigger album_books_set_updated_at before update on album.books for each row execute function core.set_updated_at();
create trigger album_milestones_set_updated_at before update on album.milestones for each row execute function core.set_updated_at();
create trigger weekly_leaderboards_set_updated_at before update on album.weekly_leaderboards for each row execute function core.set_updated_at();
create trigger album_score_rules_set_updated_at before update on album.score_rules for each row execute function core.set_updated_at();

create trigger nft_collections_set_updated_at before update on onchain.nft_collections for each row execute function core.set_updated_at();
create trigger nft_items_set_updated_at before update on onchain.nft_items for each row execute function core.set_updated_at();
create trigger mint_queue_set_updated_at before update on onchain.mint_queue for each row execute function core.set_updated_at();
create trigger onchain_transactions_set_updated_at before update on onchain.transactions for each row execute function core.set_updated_at();
create trigger wallet_sync_jobs_set_updated_at before update on onchain.wallet_sync_jobs for each row execute function core.set_updated_at();

create trigger admin_roles_set_updated_at before update on ops.admin_roles for each row execute function core.set_updated_at();
create trigger admin_users_set_updated_at before update on ops.admin_users for each row execute function core.set_updated_at();
create trigger feature_flags_set_updated_at before update on ops.feature_flags for each row execute function core.set_updated_at();
create trigger system_settings_set_updated_at before update on ops.system_settings for each row execute function core.set_updated_at();
create trigger idempotency_keys_set_updated_at before update on ops.idempotency_keys for each row execute function core.set_updated_at();
create trigger api_rate_limits_set_updated_at before update on ops.api_rate_limits for each row execute function core.set_updated_at();
create trigger support_tickets_set_updated_at before update on ops.support_tickets for each row execute function core.set_updated_at();

-- Immutable ledger protection.
create or replace function economy.prevent_currency_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'economy.currency_ledger is immutable; insert reversal entries instead';
end;
$$;

create trigger currency_ledger_no_update
before update or delete on economy.currency_ledger
for each row execute function economy.prevent_currency_ledger_mutation();

-- Maintain drop pool total weight automatically.
create or replace function gacha.refresh_drop_pool_total_weight()
returns trigger
language plpgsql
as $$
declare
  v_pool_id uuid;
begin
  v_pool_id := coalesce(new.pool_version_id, old.pool_version_id);
  update gacha.drop_pool_versions
  set total_weight = coalesce((select sum(drop_weight) from gacha.drop_pool_items where pool_version_id = v_pool_id), 0),
      updated_at = now()
  where id = v_pool_id;
  return coalesce(new, old);
end;
$$;

create trigger drop_pool_items_refresh_total_after_insert
after insert on gacha.drop_pool_items
for each row execute function gacha.refresh_drop_pool_total_weight();

create trigger drop_pool_items_refresh_total_after_update
after update of drop_weight, pool_version_id on gacha.drop_pool_items
for each row execute function gacha.refresh_drop_pool_total_weight();

create trigger drop_pool_items_refresh_total_after_delete
after delete on gacha.drop_pool_items
for each row execute function gacha.refresh_drop_pool_total_weight();

-- Generic album discovery trigger. Explicit RPC inserts also use ON CONFLICT, so this is safe.
create or replace function album.record_discovery_from_inventory()
returns trigger
language plpgsql
as $$
begin
  if new.owner_user_id is not null and new.status in ('available', 'minted') then
    insert into album.user_discoveries (user_id, template_id, first_item_instance_id, first_source_type, first_source_id)
    values (new.owner_user_id, new.template_id, new.id, new.source_type, new.source_id)
    on conflict (user_id, template_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger item_instances_record_album_discovery
after insert on inventory.item_instances
for each row execute function album.record_discovery_from_inventory();

-- Guard against negative marketplace listing state.
create or replace function market.validate_listing_counts()
returns trigger
language plpgsql
as $$
begin
  if new.remaining_count < 0 or new.remaining_count > new.item_count then
    raise exception 'invalid listing remaining_count';
  end if;
  if new.status = 'sold' and new.remaining_count <> 0 then
    raise exception 'sold listing must have zero remaining_count';
  end if;
  return new;
end;
$$;

create trigger listings_validate_counts
before insert or update on market.listings
for each row execute function market.validate_listing_counts();

-- Final comments.
comment on index inventory.inventory_one_active_lock_per_item is 'Critical anti-double-spend control: one active inventory lock per item instance.';
comment on index market.market_one_reserved_listing_item_per_instance is 'Prevents a single item instance from being reserved in multiple active marketplace listings.';
comment on trigger currency_ledger_no_update on economy.currency_ledger is 'Prevents accidental ledger mutation. Use reversal entries for corrections.';
