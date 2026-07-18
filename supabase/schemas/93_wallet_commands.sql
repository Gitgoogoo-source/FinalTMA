create or replace function api.wallet_save_verified(
  p_session_id uuid,
  p_operation_id uuid,
  p_challenge text,
  p_address text,
  p_network text,
  p_wallet_app_name text,
  p_public_key text
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
  v_challenge onchain.wallet_challenges%rowtype;
  v_wallet onchain.wallets%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'wallet.verify', p_operation_id, jsonb_build_object('address', p_address, 'network', p_network, 'wallet_app_name', p_wallet_app_name));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_network not in ('mainnet', 'testnet') then perform api.raise_business_error('WALLET_PROOF_INVALID', '钱包网络无效'); end if;
    select * into v_challenge from onchain.wallet_challenges
    where user_id = v_user_id and challenge = p_challenge and consumed_at is null and expires_at > now() for update;
    if v_challenge.id is null then perform api.raise_business_error('WALLET_CHALLENGE_INVALID', '钱包挑战已失效'); end if;
    if exists (select 1 from onchain.wallets where address = p_address and user_id <> v_user_id and status = 'verified') then perform api.raise_business_error('WALLET_ADDRESS_IN_USE', '该地址已绑定其他账号'); end if;
    update onchain.wallets set status = 'disconnected', disconnected_at = now(), updated_at = now() where user_id = v_user_id and status = 'verified';
    insert into onchain.wallets (user_id, address, network, wallet_app_name, public_key)
    values (v_user_id, p_address, p_network, p_wallet_app_name, p_public_key)
    on conflict (address) do update set network = excluded.network, wallet_app_name = excluded.wallet_app_name, public_key = excluded.public_key, status = 'verified', verified_at = now(), disconnected_at = null, updated_at = now()
    returning * into v_wallet;
    update onchain.wallet_challenges set consumed_at = now() where id = v_challenge.id;
    perform tasks.progress(v_user_id, 'wallet_verified');
    v_result := jsonb_build_object('connected', true, 'address', v_wallet.address, 'network', v_wallet.network, 'wallet_app_name', v_wallet.wallet_app_name, 'verified_at', v_wallet.verified_at);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.wallet_disconnect(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'wallet.disconnect', p_operation_id, '{}'::jsonb);
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if exists (select 1 from onchain.mints where user_id = v_user_id and status in ('reserved', 'submitted', 'unknown')) then perform api.raise_business_error('MINT_IN_PROGRESS', 'Mint 处理中不能断开钱包'); end if;
    update onchain.wallets set status = 'disconnected', disconnected_at = now(), updated_at = now() where user_id = v_user_id and status = 'verified';
    if not found then perform api.raise_business_error('WALLET_NOT_CONNECTED', '钱包未连接'); end if;
    v_result := jsonb_build_object('disconnected', true);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
