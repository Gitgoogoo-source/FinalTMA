create table onchain.wallet_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  challenge text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index wallet_challenges_user_active_idx on onchain.wallet_challenges (user_id, expires_at desc) where consumed_at is null;

create table onchain.wallets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  address text not null unique,
  network text not null check (network in ('mainnet', 'testnet')),
  wallet_app_name text,
  public_key text not null,
  status text not null default 'verified' check (status in ('verified', 'disconnected', 'revoked')),
  verified_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index wallets_user_verified_idx on onchain.wallets (user_id) where status = 'verified';

create or replace function api.wallet_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select jsonb_build_object(
    'connected', true,
    'address', w.address,
    'network', w.network,
    'wallet_app_name', w.wallet_app_name,
    'verified_at', w.verified_at
  ) into v_result
  from onchain.wallets w where w.user_id = v_user_id and w.status = 'verified';
  return coalesce(v_result, jsonb_build_object(
    'connected', false,
    'address', null,
    'network', null,
    'wallet_app_name', null,
    'verified_at', null
  ));
end;
$$;

create or replace function api.wallet_create_challenge(
  p_session_id uuid,
  p_payload text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  delete from onchain.wallet_challenges
  where user_id = v_user_id and consumed_at is null and expires_at <= now();
  insert into onchain.wallet_challenges (user_id, challenge, expires_at)
  values (v_user_id, p_payload, p_expires_at);
  return jsonb_build_object('payload', p_payload, 'expires_at', p_expires_at);
end;
$$;

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
  v_wallet onchain.wallets%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'wallet.disconnect', p_operation_id, '{}'::jsonb);
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_wallet from onchain.wallets where user_id = v_user_id and status = 'verified' for update;
    if v_wallet.id is null then perform api.raise_business_error('WALLET_NOT_CONNECTED', '钱包未连接'); end if;
    if exists (select 1 from onchain.mints where user_id = v_user_id and status in ('reserved', 'submitted', 'unknown')) then perform api.raise_business_error('MINT_IN_PROGRESS', 'Mint 处理中不能断开钱包'); end if;
    update onchain.wallets set status = 'disconnected', disconnected_at = now(), updated_at = now() where id = v_wallet.id;
    v_result := jsonb_build_object('disconnected', true);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

