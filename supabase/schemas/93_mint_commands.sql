create or replace function api.mint_reserve(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_wallet onchain.wallets%rowtype;
  v_mint onchain.mints%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'mint.reserve', p_operation_id, jsonb_build_object('template_id', p_template_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_wallet from onchain.wallets where user_id = v_user_id and status = 'verified' for share;
    if v_wallet.id is null then perform api.raise_business_error('WALLET_NOT_VERIFIED', '钱包尚未验证'); end if;
    if exists (select 1 from onchain.mints where user_id = v_user_id and template_id = p_template_id and status in ('reserved', 'submitted', 'unknown')) then perform api.raise_business_error('MINT_ALREADY_ACTIVE', '该藏品已有进行中的 Mint'); end if;
    if inventory.available_quantity(v_user_id, p_template_id) < 1 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '没有可 Mint 的藏品'); end if;
    insert into onchain.mints (user_id, wallet_id, template_id, operation_id, permit_expires_at)
    values (v_user_id, v_wallet.id, p_template_id, p_operation_id, now() + interval '10 minutes') returning * into v_mint;
    insert into inventory.reservations (user_id, template_id, quantity, kind, reference_id) values (v_user_id, p_template_id, 1, 'mint', v_mint.id);
    v_result := jsonb_build_object('mint', onchain.mint_json(v_mint), 'receiver', v_wallet.address, 'permit_payload', jsonb_build_object('mint_id', v_mint.id, 'nft_number', v_mint.nft_number, 'nonce', v_mint.nonce, 'receiver', v_wallet.address, 'template_id', p_template_id, 'valid_until', v_mint.permit_expires_at), 'valid_until', v_mint.permit_expires_at);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.mint_attach_permit(p_mint_id uuid, p_permit text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_mint onchain.mints%rowtype; v_receiver text; v_result jsonb;
begin
  select m, w.address into v_mint, v_receiver from onchain.mints m join onchain.wallets w on w.id = m.wallet_id where m.id = p_mint_id for update of m;
  if v_mint.id is null or v_mint.status <> 'reserved' or v_mint.permit_expires_at <= now() then perform api.raise_business_error('MINT_NOT_SUBMITTABLE', 'Mint 预留已失效'); end if;
  update onchain.mints set permit = p_permit, updated_at = now() where id = p_mint_id returning * into v_mint;
  v_result := jsonb_build_object('mint', onchain.mint_json(v_mint), 'receiver', v_receiver, 'permit', p_permit, 'valid_until', v_mint.permit_expires_at);
  return operations.complete_command(v_mint.operation_id, v_result);
end;
$$;

create or replace function api.mint_submit(
  p_session_id uuid,
  p_operation_id uuid,
  p_mint_id uuid,
  p_transaction_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_mint onchain.mints%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'mint.submit', p_operation_id, jsonb_build_object('mint_id', p_mint_id, 'transaction_hash', p_transaction_hash));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_mint from onchain.mints where id = p_mint_id and user_id = v_operation.user_id for update;
    if v_mint.id is null then perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在'); end if;
    if v_mint.status <> 'reserved' or v_mint.permit_expires_at <= now() or v_mint.permit is null then perform api.raise_business_error('MINT_NOT_SUBMITTABLE', 'Mint 已不可提交'); end if;
    if exists (select 1 from onchain.mints where transaction_hash = p_transaction_hash and id <> p_mint_id) then perform api.raise_business_error('TRANSACTION_ALREADY_USED', '交易哈希已被使用'); end if;
    update onchain.mints set status = 'submitted', transaction_hash = p_transaction_hash, submitted_at = now(), updated_at = now() where id = p_mint_id returning * into v_mint;
    v_result := onchain.mint_json(v_mint);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.mint_cancel(p_session_id uuid, p_operation_id uuid, p_mint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_mint onchain.mints%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'mint.cancel', p_operation_id, jsonb_build_object('mint_id', p_mint_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_mint from onchain.mints where id = p_mint_id and user_id = v_operation.user_id for update;
    if v_mint.id is null then perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在'); end if;
    if v_mint.status <> 'reserved' then perform api.raise_business_error('MINT_NOT_CANCELLABLE', 'Mint 已提交链上，不能取消'); end if;
    update onchain.mints set status = 'cancelled', completed_at = now(), updated_at = now() where id = p_mint_id returning * into v_mint;
    update inventory.reservations set status = 'released', released_at = now() where kind = 'mint' and reference_id = p_mint_id and status = 'active';
    v_result := onchain.mint_json(v_mint);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
