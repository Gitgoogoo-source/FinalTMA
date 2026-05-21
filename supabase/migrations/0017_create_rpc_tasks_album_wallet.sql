-- 0017_create_rpc_tasks_album_wallet.sql
-- RPC functions for tasks, sign-in, referral, album milestone rewards and TON wallet / mint queue.

create or replace function api.task_daily_check_in(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign tasks.signin_campaigns%rowtype;
  v_existing tasks.user_signins%rowtype;
  v_count integer;
  v_day_index integer;
  v_reward jsonb;
  v_signin_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select * into v_campaign
  from tasks.signin_campaigns
  where active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_campaign.id is null then
    raise exception 'active sign-in campaign not found';
  end if;

  select * into v_existing
  from tasks.user_signins
  where user_id = p_user_id
    and campaign_id = v_campaign.id
    and signin_date = current_date;

  if v_existing.id is not null then
    return jsonb_build_object('signin_id', v_existing.id, 'already_claimed', true, 'day_index', v_existing.day_index, 'reward', v_existing.reward);
  end if;

  select count(*)::integer into v_count
  from tasks.user_signins
  where user_id = p_user_id and campaign_id = v_campaign.id and status = 'claimed';

  v_day_index := least(v_count + 1, v_campaign.cycle_days);

  select reward into v_reward
  from tasks.signin_days
  where campaign_id = v_campaign.id and day_index = v_day_index;

  v_reward := coalesce(v_reward, '[]'::jsonb);

  insert into tasks.user_signins (user_id, campaign_id, day_index, signin_date, reward, status)
  values (p_user_id, v_campaign.id, v_day_index, current_date, v_reward, 'claimed')
  returning id into v_signin_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_reward, 'daily_check_in', v_signin_id, 'daily_check_in:' || v_signin_id::text
  );

  return jsonb_build_object(
    'signin_id', v_signin_id,
    'already_claimed', false,
    'day_index', v_day_index,
    'reward', v_reward,
    'ledger_results', v_rewards_result
  );
end;
$$;

create or replace function api.task_claim_reward(
  p_user_id uuid,
  p_task_id uuid,
  p_period_key text default 'once'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress tasks.user_task_progress%rowtype;
  v_task tasks.task_definitions%rowtype;
  v_claim_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null or p_task_id is null then
    raise exception 'user_id and task_id are required';
  end if;

  select * into v_task from tasks.task_definitions where id = p_task_id and active = true;
  if v_task.id is null then
    raise exception 'task not found';
  end if;

  select * into v_progress
  from tasks.user_task_progress
  where user_id = p_user_id and task_id = p_task_id and period_key = coalesce(p_period_key, 'once')
  for update;

  if v_progress.id is null then
    raise exception 'task progress not found';
  end if;
  if v_progress.status = 'claimed' then
    select id into v_claim_id
    from tasks.task_claims
    where user_id = p_user_id and task_id = p_task_id and period_key = coalesce(p_period_key, 'once');
    return jsonb_build_object('claim_id', v_claim_id, 'status', 'claimed', 'idempotent', true);
  end if;
  if v_progress.status <> 'completed' then
    raise exception 'task is not completed';
  end if;

  insert into tasks.task_claims (user_id, task_id, period_key, reward)
  values (p_user_id, p_task_id, coalesce(p_period_key, 'once'), v_task.reward)
  returning id into v_claim_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_task.reward, 'task_claim', v_claim_id, 'task_claim:' || v_claim_id::text
  );

  update tasks.user_task_progress
  set status = 'claimed', claimed_at = now(), updated_at = now()
  where id = v_progress.id;

  return jsonb_build_object('claim_id', v_claim_id, 'reward', v_task.reward, 'ledger_results', v_rewards_result);
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
  v_ref tasks.referrals%rowtype;
  v_inviter_reward numeric(38,0);
  v_invitee_reward numeric(38,0);
  v_credit_inviter jsonb;
  v_credit_invitee jsonb;
begin
  select * into v_ref
  from tasks.referrals
  where invitee_user_id = p_invitee_user_id and status in ('pending', 'qualified')
  for update;

  if v_ref.id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_referral');
  end if;

  select amount into v_inviter_reward from economy.reward_rules where code = 'REFERRAL_FIRST_OPEN_INVITER' and active = true;
  select amount into v_invitee_reward from economy.reward_rules where code = 'REFERRAL_FIRST_OPEN_INVITEE' and active = true;
  v_inviter_reward := coalesce(v_inviter_reward, 500);
  v_invitee_reward := coalesce(v_invitee_reward, 500);

  update tasks.referrals
  set status = 'rewarded', first_open_order_id = p_draw_order_id, qualified_at = coalesce(qualified_at, now()), rewarded_at = now(), updated_at = now()
  where id = v_ref.id;

  v_credit_inviter := api._credit_balance(
    v_ref.inviter_user_id, 'KCOIN', v_inviter_reward, 'referral_first_open', v_ref.id, null,
    'referral_first_open:inviter:' || v_ref.id::text,
    'Referral first open inviter reward', jsonb_build_object('invitee_user_id', p_invitee_user_id)
  );

  v_credit_invitee := api._credit_balance(
    v_ref.invitee_user_id, 'KCOIN', v_invitee_reward, 'referral_first_open', v_ref.id, null,
    'referral_first_open:invitee:' || v_ref.id::text,
    'Referral first open invitee reward', jsonb_build_object('inviter_user_id', v_ref.inviter_user_id)
  );

  insert into tasks.referral_rewards (referral_id, user_id, reward_role, currency_code, amount, ledger_id, status)
  values
    (v_ref.id, v_ref.inviter_user_id, 'inviter', 'KCOIN', v_inviter_reward, (v_credit_inviter ->> 'ledger_id')::uuid, 'granted'),
    (v_ref.id, v_ref.invitee_user_id, 'invitee', 'KCOIN', v_invitee_reward, (v_credit_invitee ->> 'ledger_id')::uuid, 'granted')
  on conflict (referral_id, reward_role) do nothing;

  return jsonb_build_object(
    'processed', true,
    'referral_id', v_ref.id,
    'inviter_reward', v_inviter_reward,
    'invitee_reward', v_invitee_reward
  );
end;
$$;

create or replace function api.referral_create_commission(
  p_invitee_user_id uuid,
  p_source_id uuid,
  p_base_amount_kcoin numeric,
  p_commission_bps integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref tasks.referrals%rowtype;
  v_amount numeric(38,0);
  v_credit jsonb;
  v_commission_id uuid;
begin
  if p_base_amount_kcoin is null or p_base_amount_kcoin <= 0 then
    return jsonb_build_object('processed', false, 'reason', 'no_base_amount');
  end if;

  select * into v_ref
  from tasks.referrals
  where invitee_user_id = p_invitee_user_id and status = 'rewarded'
  limit 1;

  if v_ref.id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_rewarded_referral');
  end if;

  v_amount := floor(p_base_amount_kcoin * coalesce(p_commission_bps, 1000) / 10000);
  if v_amount <= 0 then
    return jsonb_build_object('processed', false, 'reason', 'zero_commission');
  end if;

  insert into tasks.referral_commissions (
    referral_id, inviter_user_id, invitee_user_id, source_type, source_id,
    base_amount_kcoin, commission_bps, commission_amount_kcoin, status
  ) values (
    v_ref.id, v_ref.inviter_user_id, v_ref.invitee_user_id, 'gacha_open', p_source_id,
    p_base_amount_kcoin, coalesce(p_commission_bps, 1000), v_amount, 'pending'
  ) returning id into v_commission_id;

  v_credit := api._credit_balance(
    v_ref.inviter_user_id, 'KCOIN', v_amount, 'referral_commission', v_commission_id, null,
    'referral_commission:' || v_commission_id::text,
    'Referral commission', jsonb_build_object('invitee_user_id', p_invitee_user_id, 'source_id', p_source_id)
  );

  update tasks.referral_commissions
  set ledger_id = (v_credit ->> 'ledger_id')::uuid,
      status = 'granted'
  where id = v_commission_id;

  return jsonb_build_object('processed', true, 'commission_id', v_commission_id, 'amount_kcoin', v_amount);
end;
$$;

create or replace function api.album_claim_milestone(
  p_user_id uuid,
  p_milestone_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_milestone album.milestones%rowtype;
  v_collected_count integer;
  v_claim_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null or p_milestone_id is null then
    raise exception 'user_id and milestone_id are required';
  end if;

  select * into v_milestone
  from album.milestones
  where id = p_milestone_id and active = true;

  if v_milestone.id is null then
    raise exception 'milestone not found';
  end if;

  select id into v_claim_id
  from album.milestone_claims
  where user_id = p_user_id and milestone_id = p_milestone_id;

  if v_claim_id is not null then
    return jsonb_build_object('claim_id', v_claim_id, 'idempotent', true);
  end if;

  select count(*)::integer into v_collected_count
  from album.book_items bi
  join album.user_discoveries ud on ud.template_id = bi.template_id and ud.user_id = p_user_id
  where bi.book_id = v_milestone.book_id;

  if v_collected_count < v_milestone.required_count then
    raise exception 'milestone not reached: collected %, required %', v_collected_count, v_milestone.required_count;
  end if;

  insert into album.milestone_claims (user_id, milestone_id, reward)
  values (p_user_id, p_milestone_id, v_milestone.reward)
  returning id into v_claim_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_milestone.reward, 'album_milestone', v_claim_id, 'album_milestone:' || v_claim_id::text
  );

  return jsonb_build_object(
    'claim_id', v_claim_id,
    'collected_count', v_collected_count,
    'required_count', v_milestone.required_count,
    'reward', v_milestone.reward,
    'ledger_results', v_rewards_result
  );
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
  v_wallet_id uuid;
begin
  if p_user_id is null or p_address is null then
    raise exception 'user_id and address are required';
  end if;

  if coalesce(p_is_primary, true) then
    update core.user_wallets
    set is_primary = false, updated_at = now()
    where user_id = p_user_id and chain = 'TON' and network = coalesce(p_network, 'mainnet');
  end if;

  insert into core.user_wallets (
    user_id, chain, network, address, address_raw, wallet_app_name,
    is_primary, status, verified_at
  ) values (
    p_user_id, 'TON', coalesce(p_network, 'mainnet'), p_address, p_address_raw, p_wallet_app_name,
    coalesce(p_is_primary, true), 'connected', now()
  )
  on conflict (user_id, chain, network, address) do update
  set address_raw = excluded.address_raw,
      wallet_app_name = excluded.wallet_app_name,
      is_primary = excluded.is_primary,
      status = 'connected',
      verified_at = now(),
      disconnected_at = null,
      updated_at = now()
  returning id into v_wallet_id;

  return jsonb_build_object('wallet_id', v_wallet_id, 'address', p_address, 'network', coalesce(p_network, 'mainnet'));
end;
$$;

create or replace function api.wallet_enqueue_mint(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_collection_id uuid,
  p_wallet_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item inventory.item_instances%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_collection onchain.nft_collections%rowtype;
  v_queue_id uuid;
begin
  if p_user_id is null or p_item_instance_id is null or p_collection_id is null or p_idempotency_key is null then
    raise exception 'user_id, item_instance_id, collection_id and idempotency_key are required';
  end if;

  select * into v_item
  from inventory.item_instances
  where id = p_item_instance_id
  for update;

  if v_item.id is null then
    raise exception 'item not found';
  end if;
  if v_item.owner_user_id <> p_user_id then
    raise exception 'not item owner';
  end if;
  if v_item.status <> 'available' then
    raise exception 'item is not available for mint';
  end if;

  select * into v_template from catalog.collectible_templates where id = v_item.template_id;
  if not v_template.nft_mintable then
    raise exception 'item is not mintable';
  end if;

  select * into v_collection from onchain.nft_collections where id = p_collection_id and status = 'active';
  if v_collection.id is null then
    raise exception 'active NFT collection not found';
  end if;

  insert into onchain.mint_queue (
    user_id, wallet_id, collection_id, item_instance_id, template_id, form_id,
    status, next_attempt_at, idempotency_key
  ) values (
    p_user_id, p_wallet_id, p_collection_id, p_item_instance_id, v_item.template_id, v_item.form_id,
    'queued', now(), p_idempotency_key
  )
  on conflict (idempotency_key) do update set updated_at = now()
  returning id into v_queue_id;

  insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, source_id)
  values (p_item_instance_id, p_user_id, 'mint', 'mint_queue', v_queue_id)
  on conflict do nothing;

  update inventory.item_instances
  set status = 'minting', nft_mint_status = 'queued', updated_at = now(), lock_version = lock_version + 1
  where id = p_item_instance_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (p_item_instance_id, p_user_id, 'mint_queued', 'mint_queue', v_queue_id,
          jsonb_build_object('collection_id', p_collection_id));

  return jsonb_build_object('mint_queue_id', v_queue_id, 'status', 'queued');
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
  v_queue onchain.mint_queue%rowtype;
  v_nft_item_id uuid;
begin
  select * into v_queue
  from onchain.mint_queue
  where id = p_mint_queue_id
  for update;

  if v_queue.id is null then
    raise exception 'mint queue not found';
  end if;

  insert into onchain.nft_items (
    collection_id, item_instance_id, template_id, form_id, item_index, item_address,
    owner_address, owner_user_id, metadata_url, status, minted_tx_hash, minted_at
  ) values (
    v_queue.collection_id, v_queue.item_instance_id, v_queue.template_id, v_queue.form_id, p_item_index, p_item_address,
    p_owner_address, v_queue.user_id, p_metadata_url, 'minted', p_tx_hash, now()
  )
  on conflict (item_instance_id) do update
  set item_index = excluded.item_index,
      item_address = excluded.item_address,
      owner_address = excluded.owner_address,
      metadata_url = excluded.metadata_url,
      status = 'minted',
      minted_tx_hash = excluded.minted_tx_hash,
      minted_at = coalesce(onchain.nft_items.minted_at, now()),
      updated_at = now()
  returning id into v_nft_item_id;

  update onchain.mint_queue
  set status = 'minted', nft_item_id = v_nft_item_id, tx_hash = p_tx_hash, completed_at = now(), updated_at = now()
  where id = p_mint_queue_id;

  update inventory.item_instances
  set status = 'minted', nft_mint_status = 'minted', minted_nft_item_id = v_nft_item_id, updated_at = now(), lock_version = lock_version + 1
  where id = v_queue.item_instance_id;

  update inventory.inventory_locks
  set status = 'consumed', released_at = now(), updated_at = now()
  where item_instance_id = v_queue.item_instance_id and source_type = 'mint_queue' and source_id = p_mint_queue_id and status = 'active';

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_queue.item_instance_id, v_queue.user_id, 'minted', 'mint_queue', p_mint_queue_id,
          jsonb_build_object('nft_item_id', v_nft_item_id, 'item_address', p_item_address, 'tx_hash', p_tx_hash));

  return jsonb_build_object('nft_item_id', v_nft_item_id, 'status', 'minted', 'item_address', p_item_address);
end;
$$;
