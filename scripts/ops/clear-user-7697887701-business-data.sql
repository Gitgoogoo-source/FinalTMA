-- Scheme 2 user business-data reset for Telegram user 7697887701.
-- This is a one-off ops script, not a migration.
--
-- What this clears:
-- - user sessions, wallet bindings, device records and UI notifications
-- - gameplay state: gacha orders/results, inventory items, listings, tasks, album
-- - balance snapshots are brought to zero through ledger-backed debit entries
--
-- What this preserves:
-- - core.users identity row, so the Telegram user can log in again
-- - payments.star_orders / payments.star_payments for payment reconciliation
-- - economy.currency_ledger, including the reset debit entries
-- - ops audit/risk/support records
--
-- Safety stop:
-- - refuses to run if the user has minted/transferred/burned on-chain NFT rows
-- - refuses to run if the user has active mint queue work

begin;

create temp table _business_reset_items (
  id uuid primary key
) on commit drop;

create temp table _business_reset_listings (
  id uuid primary key
) on commit drop;

create temp table _business_reset_draw_orders (
  id uuid primary key
) on commit drop;

create temp table _business_reset_star_orders (
  id uuid primary key
) on commit drop;

do $$
declare
  v_telegram_user_id constant bigint := 7697887701;
  v_reason constant text := 'scheme2 business reset for telegram user 7697887701';
  v_user_id uuid;
  v_now timestamptz := now();
  v_before jsonb;
  v_after jsonb;
  v_balance record;
  v_lock record;
  v_remaining_locked numeric(38,0);
begin
  select id
  into v_user_id
  from core.users
  where telegram_user_id = v_telegram_user_id
  for update;

  if v_user_id is null then
    raise exception 'TARGET_USER_NOT_FOUND:%', v_telegram_user_id using errcode = 'P0001';
  end if;

  insert into _business_reset_items (id)
  select id
  from inventory.item_instances
  where owner_user_id = v_user_id
  union
  select item_instance_id
  from inventory.item_instance_events
  where user_id = v_user_id
    and item_instance_id is not null
  union
  select item_instance_id
  from gacha.draw_results
  where user_id = v_user_id
    and item_instance_id is not null
  union
  select item_instance_id
  from inventory.upgrade_logs
  where user_id = v_user_id
  union
  select item_instance_id
  from inventory.decompose_logs
  where user_id = v_user_id
  union
  select main_item_instance_id
  from inventory.evolution_attempts
  where user_id = v_user_id
    and main_item_instance_id is not null
  union
  select result_item_instance_id
  from inventory.evolution_attempts
  where user_id = v_user_id
    and result_item_instance_id is not null
  union
  select eci.item_instance_id
  from inventory.evolution_consumed_items eci
  join inventory.evolution_attempts ea on ea.id = eci.attempt_id
  where ea.user_id = v_user_id
  union
  select item_instance_id
  from inventory.inventory_locks
  where user_id = v_user_id
  union
  select item_instance_id
  from onchain.mint_queue
  where user_id = v_user_id;

  insert into _business_reset_listings (id)
  select id
  from market.listings
  where seller_user_id = v_user_id
  union
  select listing_id
  from market.listing_items
  where buyer_user_id = v_user_id
  union
  select listing_id
  from market.listing_items
  where item_instance_id in (select id from _business_reset_items);

  insert into _business_reset_draw_orders (id)
  select id
  from gacha.draw_orders
  where user_id = v_user_id
  union
  select draw_order_id
  from gacha.draw_results
  where user_id = v_user_id
  union
  select draw_order_id
  from gacha.draw_audit
  where user_id = v_user_id;

  insert into _business_reset_star_orders (id)
  select id
  from payments.star_orders
  where user_id = v_user_id;

  if exists (
    select 1
    from onchain.nft_items ni
    where (ni.owner_user_id = v_user_id or ni.item_instance_id in (select id from _business_reset_items))
      and ni.status in ('minted', 'transferred', 'burned')
  ) then
    raise exception 'TARGET_HAS_ONCHAIN_NFTS_MANUAL_REVIEW_REQUIRED:%', v_user_id using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from onchain.mint_queue mq
    where mq.user_id = v_user_id
      and mq.status in ('queued', 'processing', 'submitted', 'confirming', 'retrying', 'manual_review')
  ) then
    raise exception 'TARGET_HAS_ACTIVE_MINT_QUEUE_MANUAL_REVIEW_REQUIRED:%', v_user_id using errcode = 'P0001';
  end if;

  v_before := jsonb_build_object(
    'user_id', v_user_id,
    'telegram_user_id', v_telegram_user_id,
    'items', (select count(*) from _business_reset_items),
    'listings', (select count(*) from _business_reset_listings),
    'draw_orders', (select count(*) from _business_reset_draw_orders),
    'star_orders', (select count(*) from _business_reset_star_orders),
    'balances', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.currency_code)
      from (
        select currency_code, available_amount, locked_amount, total_earned, total_spent
        from economy.user_balances
        where user_id = v_user_id
      ) x
    ), '[]'::jsonb)
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
      error_message = case
        when status in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked')
          then coalesce(error_message, 'cancelled by scheme2 business reset')
        else error_message
      end,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object(
          'cleared_at', v_now,
          'reason', v_reason,
          'old_business_id', business_id
        )
      ),
      updated_at = v_now
  where user_id = v_user_id;

  update payments.star_invoices
  set status = case when status in ('created', 'sent', 'opened') then 'expired' else status end,
      raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'reason', v_reason)
      ),
      updated_at = v_now
  where star_order_id in (select id from _business_reset_star_orders);

  delete from ops.telegram_init_data_consumptions where user_id = v_user_id;
  delete from core.app_sessions where user_id = v_user_id;
  delete from core.user_api_tokens where user_id = v_user_id;
  delete from core.wallet_proofs where user_id = v_user_id;
  delete from onchain.wallet_nft_snapshots where user_id = v_user_id;
  delete from onchain.wallet_sync_jobs where user_id = v_user_id;
  delete from core.user_wallets where user_id = v_user_id;
  delete from core.user_devices where user_id = v_user_id;
  delete from core.notifications where user_id = v_user_id;
  delete from ops.idempotency_keys where user_id = v_user_id;

  update ops.app_events
  set user_id = null,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'old_user_id', v_user_id)
      )
  where user_id = v_user_id;

  update ops.risk_events
  set user_id = null,
      detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'old_user_id', v_user_id)
      )
  where user_id = v_user_id;

  update ops.support_tickets
  set user_id = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'old_user_id', v_user_id)
      ),
      updated_at = v_now
  where user_id = v_user_id;

  delete from tasks.referral_rewards
  where user_id = v_user_id
     or referral_id in (
       select id
       from tasks.referrals
       where inviter_user_id = v_user_id or invitee_user_id = v_user_id
     );

  delete from tasks.referral_commissions
  where inviter_user_id = v_user_id
     or invitee_user_id = v_user_id
     or referral_id in (
       select id
       from tasks.referrals
       where inviter_user_id = v_user_id or invitee_user_id = v_user_id
     );

  delete from tasks.referrals
  where inviter_user_id = v_user_id
     or invitee_user_id = v_user_id;

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
    select id
    from market.orders
    where buyer_user_id = v_user_id
       or seller_user_id = v_user_id
       or listing_id in (select id from _business_reset_listings)
  )
     or listing_item_id in (
       select id
       from market.listing_items
       where buyer_user_id = v_user_id
          or listing_id in (select id from _business_reset_listings)
          or item_instance_id in (select id from _business_reset_items)
     )
     or item_instance_id in (select id from _business_reset_items);

  delete from market.orders
  where buyer_user_id = v_user_id
     or seller_user_id = v_user_id
     or listing_id in (select id from _business_reset_listings);

  delete from market.listing_items
  where buyer_user_id = v_user_id
     or listing_id in (select id from _business_reset_listings)
     or item_instance_id in (select id from _business_reset_items);

  delete from market.listing_events
  where user_id = v_user_id
     or listing_id in (select id from _business_reset_listings);

  delete from market.listings
  where seller_user_id = v_user_id
     or id in (select id from _business_reset_listings);

  delete from gacha.draw_audit
  where user_id = v_user_id
     or draw_order_id in (select id from _business_reset_draw_orders);

  delete from gacha.draw_results
  where user_id = v_user_id
     or draw_order_id in (select id from _business_reset_draw_orders)
     or item_instance_id in (select id from _business_reset_items);

  delete from gacha.draw_orders
  where user_id = v_user_id
     or id in (select id from _business_reset_draw_orders);

  delete from gacha.user_pity_states where user_id = v_user_id;

  update onchain.transactions
  set user_id = null,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'old_user_id', v_user_id)
      ),
      updated_at = v_now
  where user_id = v_user_id;

  delete from onchain.wallet_nft_snapshots where user_id = v_user_id;
  delete from onchain.wallet_sync_jobs where user_id = v_user_id;
  delete from onchain.mint_queue
  where user_id = v_user_id
     or item_instance_id in (select id from _business_reset_items);

  update onchain.nft_items
  set owner_user_id = null,
      item_instance_id = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'old_user_id', v_user_id)
      ),
      updated_at = v_now
  where owner_user_id = v_user_id
     or item_instance_id in (select id from _business_reset_items);

  delete from inventory.evolution_consumed_items
  where attempt_id in (
    select id
    from inventory.evolution_attempts
    where user_id = v_user_id
  )
     or item_instance_id in (select id from _business_reset_items);

  delete from inventory.evolution_attempts
  where user_id = v_user_id
     or main_item_instance_id in (select id from _business_reset_items)
     or result_item_instance_id in (select id from _business_reset_items);

  delete from inventory.decompose_logs
  where user_id = v_user_id
     or item_instance_id in (select id from _business_reset_items);

  delete from inventory.upgrade_logs
  where user_id = v_user_id
     or item_instance_id in (select id from _business_reset_items);

  delete from inventory.inventory_locks
  where user_id = v_user_id
     or item_instance_id in (select id from _business_reset_items);

  delete from inventory.item_instance_events
  where user_id = v_user_id
     or item_instance_id in (select id from _business_reset_items);

  delete from inventory.item_instances
  where id in (select id from _business_reset_items);

  for v_lock in
    select id
    from economy.balance_locks
    where user_id = v_user_id
      and status = 'active'
    order by created_at, id
  loop
    perform api.economy_unlock_balance(
      p_lock_id => v_lock.id,
      p_mode => 'consume',
      p_idempotency_key => 'business_reset:telegram:' || v_telegram_user_id::text || ':consume_lock:' || v_lock.id::text,
      p_note => v_reason,
      p_metadata => jsonb_build_object('reason', v_reason, 'telegram_user_id', v_telegram_user_id)
    );
  end loop;

  select coalesce(sum(locked_amount), 0)
  into v_remaining_locked
  from economy.user_balances
  where user_id = v_user_id;

  if v_remaining_locked <> 0 then
    raise exception 'TARGET_LOCKED_BALANCE_REMAINS:%', v_remaining_locked using errcode = 'P0001';
  end if;

  for v_balance in
    select currency_code, available_amount
    from economy.user_balances
    where user_id = v_user_id
      and available_amount > 0
    order by currency_code
  loop
    perform api.economy_debit(
      p_user_id => v_user_id,
      p_currency_code => v_balance.currency_code,
      p_amount => v_balance.available_amount,
      p_source_type => 'business_reset',
      p_source_id => v_user_id,
      p_source_ref => 'telegram_user_id:' || v_telegram_user_id::text,
      p_idempotency_key => 'business_reset:telegram:' || v_telegram_user_id::text || ':debit:' || v_balance.currency_code,
      p_note => v_reason,
      p_metadata => jsonb_build_object('reason', v_reason, 'telegram_user_id', v_telegram_user_id)
    );
  end loop;

  delete from economy.balance_locks where user_id = v_user_id;

  update core.users
  set referred_by_user_id = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object(
          'cleared_at', v_now,
          'reason', v_reason
        )
      ),
      updated_at = v_now
  where id = v_user_id;

  update core.user_flags
  set active = false,
      ends_at = coalesce(ends_at, v_now),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'scheme2_business_reset', jsonb_build_object('cleared_at', v_now, 'reason', v_reason)
      ),
      updated_at = v_now
  where user_id = v_user_id
    and active = true;

  v_after := jsonb_build_object(
    'user_id', v_user_id,
    'telegram_user_id', v_telegram_user_id,
    'owned_items', (select count(*) from inventory.item_instances where owner_user_id = v_user_id),
    'listings', (select count(*) from market.listings where seller_user_id = v_user_id),
    'draw_orders', (select count(*) from gacha.draw_orders where user_id = v_user_id),
    'balances', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.currency_code)
      from (
        select currency_code, available_amount, locked_amount, total_earned, total_spent
        from economy.user_balances
        where user_id = v_user_id
      ) x
    ), '[]'::jsonb)
  );

  insert into ops.admin_audit_logs (
    admin_user_id,
    action,
    target_schema,
    target_table,
    target_id,
    before_state,
    after_state,
    reason
  ) values (
    null,
    'user.business_data_reset.scheme2',
    'core',
    'users',
    v_user_id,
    v_before,
    v_after,
    v_reason
  );
end $$;

commit;

with target_user as (
  select id, telegram_user_id, username::text as username, status
  from core.users
  where telegram_user_id = 7697887701
)
select jsonb_build_object(
  'target_user', coalesce((select to_jsonb(target_user) from target_user), 'null'::jsonb),
  'remaining', jsonb_build_object(
    'owned_items', (select count(*) from inventory.item_instances where owner_user_id = (select id from target_user)),
    'item_events', (select count(*) from inventory.item_instance_events where user_id = (select id from target_user)),
    'inventory_locks', (select count(*) from inventory.inventory_locks where user_id = (select id from target_user)),
    'market_listings', (select count(*) from market.listings where seller_user_id = (select id from target_user)),
    'draw_orders', (select count(*) from gacha.draw_orders where user_id = (select id from target_user)),
    'draw_results', (select count(*) from gacha.draw_results where user_id = (select id from target_user)),
    'task_progress', (select count(*) from tasks.user_task_progress where user_id = (select id from target_user)),
    'album_discoveries', (select count(*) from album.user_discoveries where user_id = (select id from target_user)),
    'sessions', (select count(*) from core.app_sessions where user_id = (select id from target_user)),
    'telegram_init_consumptions', (select count(*) from ops.telegram_init_data_consumptions where user_id = (select id from target_user))
  ),
  'balances', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.currency_code)
    from (
      select currency_code, available_amount, locked_amount, total_earned, total_spent
      from economy.user_balances
      where user_id = (select id from target_user)
    ) x
  ), '[]'::jsonb),
  'preserved', jsonb_build_object(
    'star_orders', (select count(*) from payments.star_orders where user_id = (select id from target_user)),
    'star_payments', (select count(*) from payments.star_payments where user_id = (select id from target_user)),
    'currency_ledger', (select count(*) from economy.currency_ledger where user_id = (select id from target_user)),
    'reset_audit_logs', (
      select count(*)
      from ops.admin_audit_logs
      where action = 'user.business_data_reset.scheme2'
        and target_id = (select id from target_user)
    )
  )
) as scheme2_business_reset_result;
