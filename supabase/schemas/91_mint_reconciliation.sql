create or replace function api.mint_reconciliation_candidates(p_limit integer default 100)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.submitted_at), '[]'::jsonb)
  from (
    select m.id mint_id, m.nft_number, m.template_id, m.transaction_hash, m.submitted_at,
           w.address receiver, t.name, t.rarity, t.stage, t.combat_power, t.image_detail_path
    from onchain.mints m
    join onchain.wallets w on w.id = m.wallet_id
    join catalog.templates t on t.id = m.template_id
    where m.status in ('submitted', 'unknown')
    order by m.submitted_at
    limit greatest(1, least(p_limit, 500))
  ) candidate
$$;

create or replace function api.mint_complete(
  p_mint_id uuid,
  p_success boolean,
  p_nft_address text default null,
  p_metadata_uri text default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_mint onchain.mints%rowtype; v_checksum text; v_result jsonb;
begin
  select * into v_mint from onchain.mints where id = p_mint_id for update;
  if v_mint.id is null then perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在'); end if;
  if v_mint.status in ('succeeded', 'failed', 'cancelled') then return onchain.mint_json(v_mint); end if;
  if p_success then
    if p_nft_address is null or p_metadata_uri is null or p_metadata is null then perform api.raise_business_error('MINT_RESULT_INCOMPLETE', 'Mint 成功资料不完整'); end if;
    update inventory.reservations set status = 'consumed', released_at = now() where kind = 'mint' and reference_id = v_mint.id and status = 'active';
    perform inventory.change_holding(v_mint.user_id, v_mint.template_id, -1);
    update onchain.mints set status = 'succeeded', nft_address = p_nft_address, metadata_uri = p_metadata_uri, completed_at = now(), updated_at = now() where id = v_mint.id returning * into v_mint;
    v_checksum := encode(extensions.digest(convert_to(p_metadata::text, 'UTF8'), 'sha256'), 'hex');
    insert into onchain.nft_metadata (nft_number, mint_id, snapshot, checksum) values (v_mint.nft_number, v_mint.id, p_metadata, v_checksum) on conflict (nft_number) do nothing;
    perform tasks.progress(v_mint.user_id, 'mint_success');
  else
    update inventory.reservations set status = 'released', released_at = now() where kind = 'mint' and reference_id = v_mint.id and status = 'active';
    update onchain.mints set status = 'failed', completed_at = now(), updated_at = now() where id = v_mint.id returning * into v_mint;
  end if;
  v_result := onchain.mint_json(v_mint);
  update operations.operations set status = case when p_success then 'succeeded' else 'failed' end,
    result = v_result, error_code = case when p_success then null else 'MINT_FAILED' end,
    completed_at = now(), updated_at = now()
  where use_case = 'mint.submit' and result->>'id' = v_mint.id::text and status in ('pending', 'unknown');
  return v_result;
end;
$$;

create or replace function api.mint_mark_unknown(p_mint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_mint onchain.mints%rowtype;
begin
  update onchain.mints set status = 'unknown', updated_at = now()
  where id = p_mint_id and status = 'submitted' returning * into v_mint;
  if v_mint.id is null then select * into v_mint from onchain.mints where id = p_mint_id; end if;
  if v_mint.id is null then perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在'); end if;
  update operations.operations set status = 'unknown', updated_at = now()
  where use_case = 'mint.submit' and result->>'id' = p_mint_id::text and status = 'pending';
  return onchain.mint_json(v_mint);
end;
$$;
