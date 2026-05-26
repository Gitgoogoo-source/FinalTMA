-- Phase 4 / 9.1 task progress sources.
-- Scope: only connect task progress sources that already exist in the remote
-- task definitions. This deliberately does not add evolve/decompose/album
-- sources because no active remote task definition currently uses them.

begin;

alter function api.gacha_process_paid_order(uuid, text, text, jsonb)
  rename to gacha_process_paid_order_without_task_progress;

alter function api.referral_process_first_open(uuid, uuid)
  rename to referral_process_first_open_without_task_progress;

alter function api.market_create_listing(uuid, uuid[], numeric, text)
  rename to market_create_listing_without_task_progress;

alter function api.market_buy_listing(uuid, uuid, integer, numeric, text)
  rename to market_buy_listing_without_task_progress;

alter function api.inventory_upgrade_item(uuid, uuid, text)
  rename to inventory_upgrade_item_without_task_progress;

alter function api.wallet_save_verified_address(uuid, text, text, text, text, boolean)
  rename to wallet_save_verified_address_without_task_progress;

alter function api.onchain_mark_mint_success(uuid, text, bigint, text, text, text)
  rename to onchain_mark_mint_success_without_task_progress;

create or replace function api.gacha_process_paid_order(
  p_star_order_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_raw_update jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_draw_order_id uuid;
  v_user_id uuid;
  v_draw_count integer;
  v_event_date date;
  v_progress_result jsonb;
begin
  v_result := api.gacha_process_paid_order_without_task_progress(
    p_star_order_id,
    p_telegram_payment_charge_id,
    p_provider_payment_charge_id,
    p_raw_update
  );

  v_draw_order_id := nullif(v_result ->> 'draw_order_id', '')::uuid;

  if v_draw_order_id is not null then
    select
      user_id,
      greatest(coalesce(draw_count, quantity, 1), 1),
      coalesce(opened_at, updated_at, now())::date
    into v_user_id, v_draw_count, v_event_date
    from gacha.draw_orders
    where id = v_draw_order_id;

    if v_user_id is not null then
      v_progress_result := api.task_record_progress(
        v_user_id,
        'gacha_open_success',
        v_draw_count,
        v_draw_order_id,
        coalesce(v_event_date, current_date)::text
      );

      v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function api.referral_process_first_open(
  p_invitee_user_id uuid,
  p_draw_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_referral_id uuid;
  v_inviter_user_id uuid;
  v_progress_result jsonb;
begin
  v_result := api.referral_process_first_open_without_task_progress(
    p_invitee_user_id,
    p_draw_order_id
  );

  if coalesce((v_result ->> 'processed')::boolean, false) then
    v_referral_id := nullif(v_result ->> 'referral_id', '')::uuid;

    select inviter_user_id
    into v_inviter_user_id
    from tasks.referrals
    where id = v_referral_id;

    if v_inviter_user_id is not null then
      v_progress_result := api.task_record_progress(
        v_inviter_user_id,
        'referral_first_open',
        1,
        v_referral_id,
        null
      );

      v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function api.market_create_listing(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_listing_id uuid;
  v_seller_user_id uuid;
  v_event_date date;
  v_progress_result jsonb;
begin
  v_result := api.market_create_listing_without_task_progress(
    p_user_id,
    p_item_instance_ids,
    p_unit_price_kcoin,
    p_idempotency_key
  );

  v_listing_id := nullif(v_result ->> 'listing_id', '')::uuid;

  if v_listing_id is not null then
    select seller_user_id, coalesce(created_at, updated_at, now())::date
    into v_seller_user_id, v_event_date
    from market.listings
    where id = v_listing_id;

    if v_seller_user_id is not null then
      v_progress_result := api.task_record_progress(
        v_seller_user_id,
        'market_listing_created',
        1,
        v_listing_id,
        coalesce(v_event_date, current_date)::text
      );

      v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function api.market_buy_listing(
  p_buyer_user_id uuid,
  p_listing_id uuid,
  p_quantity integer,
  p_expected_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_buyer_user_id uuid;
  v_item_count integer;
  v_event_date date;
  v_progress_result jsonb;
begin
  v_result := api.market_buy_listing_without_task_progress(
    p_buyer_user_id,
    p_listing_id,
    p_quantity,
    p_expected_unit_price_kcoin,
    p_idempotency_key
  );

  v_order_id := nullif(v_result ->> 'order_id', '')::uuid;

  if v_order_id is not null then
    select
      buyer_user_id,
      greatest(coalesce(item_count, p_quantity, 1), 1),
      coalesce(completed_at, updated_at, created_at, now())::date
    into v_buyer_user_id, v_item_count, v_event_date
    from market.orders
    where id = v_order_id;

    if v_buyer_user_id is not null then
      v_progress_result := api.task_record_progress(
        v_buyer_user_id,
        'market_order_completed',
        v_item_count,
        v_order_id,
        coalesce(v_event_date, current_date)::text
      );

      v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function api.inventory_upgrade_item(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_log_id uuid;
  v_event_date date;
  v_progress_result jsonb;
begin
  v_result := api.inventory_upgrade_item_without_task_progress(
    p_user_id,
    p_item_instance_id,
    p_idempotency_key
  );

  select logs.id, coalesce(logs.created_at, now())::date
  into v_log_id, v_event_date
  from inventory.upgrade_logs logs
  where logs.user_id = p_user_id
    and logs.item_instance_id = p_item_instance_id
    and logs.idempotency_key = nullif(btrim(p_idempotency_key), '')
  order by logs.created_at desc
  limit 1;

  if v_log_id is not null then
    v_progress_result := api.task_record_progress(
      p_user_id,
      'inventory_upgrade_success',
      1,
      v_log_id,
      coalesce(v_event_date, current_date)::text
    );

    v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
  end if;

  return v_result;
end;
$$;

create or replace function api.wallet_save_verified_address(
  p_user_id uuid,
  p_address text,
  p_address_raw text default null,
  p_network text default 'mainnet',
  p_wallet_app_name text default null,
  p_is_primary boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_wallet_id uuid;
  v_progress_result jsonb;
begin
  v_result := api.wallet_save_verified_address_without_task_progress(
    p_user_id,
    p_address,
    p_address_raw,
    p_network,
    p_wallet_app_name,
    p_is_primary
  );

  v_wallet_id := nullif(v_result ->> 'wallet_id', '')::uuid;

  if v_wallet_id is not null then
    v_progress_result := api.task_record_progress(
      p_user_id,
      'wallet_verified',
      1,
      v_wallet_id,
      null
    );

    v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
  end if;

  return v_result;
end;
$$;

create or replace function api.onchain_mark_mint_success(
  p_mint_queue_id uuid,
  p_item_address text,
  p_item_index bigint,
  p_owner_address text,
  p_tx_hash text,
  p_metadata_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_nft_item_id uuid;
  v_owner_user_id uuid;
  v_event_week text;
  v_progress_result jsonb;
begin
  v_result := api.onchain_mark_mint_success_without_task_progress(
    p_mint_queue_id,
    p_item_address,
    p_item_index,
    p_owner_address,
    p_tx_hash,
    p_metadata_url
  );

  v_nft_item_id := nullif(v_result ->> 'nft_item_id', '')::uuid;

  if v_nft_item_id is not null then
    select owner_user_id, to_char(coalesce(minted_at, updated_at, now())::date, 'IYYY-"W"IW')
    into v_owner_user_id, v_event_week
    from onchain.nft_items
    where id = v_nft_item_id;

    if v_owner_user_id is not null then
      v_progress_result := api.task_record_progress(
        v_owner_user_id,
        'nft_sync_success',
        1,
        v_nft_item_id,
        v_event_week
      );

      v_result := v_result || jsonb_build_object('task_progress', v_progress_result);
    end if;
  end if;

  return v_result;
end;
$$;

revoke execute on function api.gacha_process_paid_order_without_task_progress(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function api.referral_process_first_open_without_task_progress(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function api.market_create_listing_without_task_progress(uuid, uuid[], numeric, text)
  from public, anon, authenticated, service_role;
revoke execute on function api.market_buy_listing_without_task_progress(uuid, uuid, integer, numeric, text)
  from public, anon, authenticated, service_role;
revoke execute on function api.inventory_upgrade_item_without_task_progress(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function api.wallet_save_verified_address_without_task_progress(uuid, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function api.onchain_mark_mint_success_without_task_progress(uuid, text, bigint, text, text, text)
  from public, anon, authenticated, service_role;

revoke execute on function api.gacha_process_paid_order(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function api.referral_process_first_open(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function api.market_create_listing(uuid, uuid[], numeric, text)
  from public, anon, authenticated;
revoke execute on function api.market_buy_listing(uuid, uuid, integer, numeric, text)
  from public, anon, authenticated;
revoke execute on function api.inventory_upgrade_item(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function api.wallet_save_verified_address(uuid, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function api.onchain_mark_mint_success(uuid, text, bigint, text, text, text)
  from public, anon, authenticated;

grant execute on function api.gacha_process_paid_order(uuid, text, text, jsonb)
  to service_role;
grant execute on function api.referral_process_first_open(uuid, uuid)
  to service_role;
grant execute on function api.market_create_listing(uuid, uuid[], numeric, text)
  to service_role;
grant execute on function api.market_buy_listing(uuid, uuid, integer, numeric, text)
  to service_role;
grant execute on function api.inventory_upgrade_item(uuid, uuid, text)
  to service_role;
grant execute on function api.wallet_save_verified_address(uuid, text, text, text, text, boolean)
  to service_role;
grant execute on function api.onchain_mark_mint_success(uuid, text, bigint, text, text, text)
  to service_role;

commit;
