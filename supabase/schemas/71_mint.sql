create table onchain.mints (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  wallet_id uuid not null references onchain.wallets(id),
  template_id text not null references catalog.templates(id),
  operation_id uuid not null unique references operations.operations(id),
  nft_number bigint generated always as identity (start with 0 minvalue 0) unique,
  nonce uuid not null default extensions.gen_random_uuid() unique,
  permit text,
  status text not null default 'reserved' check (status in ('reserved', 'submitted', 'succeeded', 'failed', 'cancelled', 'unknown')),
  permit_expires_at timestamptz not null,
  transaction_hash text unique,
  nft_address text unique,
  metadata_uri text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mints_pending_idx on onchain.mints (status, created_at) where status in ('reserved', 'submitted', 'unknown');
create index mints_user_created_idx on onchain.mints (user_id, created_at desc);
create unique index mints_user_template_active_idx on onchain.mints (user_id, template_id) where status in ('reserved', 'submitted', 'unknown');

create table onchain.nft_metadata (
  nft_number bigint primary key,
  mint_id uuid not null unique references onchain.mints(id),
  snapshot jsonb not null,
  checksum text not null,
  created_at timestamptz not null default now()
);

create or replace function onchain.mint_json(p_mint onchain.mints)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_mint.id,
    'template_id', p_mint.template_id,
    'status', p_mint.status,
    'nft_number', p_mint.nft_number,
    'transaction_hash', p_mint.transaction_hash,
    'permit_expires_at', p_mint.permit_expires_at,
    'submitted_at', p_mint.submitted_at,
    'completed_at', p_mint.completed_at
  )
$$;

create or replace function api.mint_list(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object('mints', coalesce((
    select jsonb_agg(onchain.mint_json(m) order by m.created_at desc)
    from onchain.mints m where m.user_id = v_user_id
  ), '[]'::jsonb));
end;
$$;

create or replace function api.mint_get(p_session_id uuid, p_mint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select onchain.mint_json(m) into v_result
  from onchain.mints m where m.id = p_mint_id and m.user_id = v_user_id;
  if v_result is null then
    perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.mint_metadata(p_nft_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select snapshot into v_result from onchain.nft_metadata where nft_number = p_nft_id;
  if v_result is null then
    perform api.raise_business_error('NFT_METADATA_NOT_FOUND', 'NFT 元数据不存在');
  end if;
  return v_result;
end;
$$;

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
    perform pg_advisory_xact_lock(hashtextextended('pokepets:mint:' || v_user_id::text || ':' || p_template_id, 0));
    if exists (select 1 from onchain.mints where user_id = v_user_id and template_id = p_template_id and status in ('reserved', 'submitted', 'unknown')) then perform api.raise_business_error('MINT_ALREADY_ACTIVE', '该藏品已有进行中的 Mint'); end if;
    if inventory.available_quantity(v_user_id, p_template_id) < 1 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '没有可 Mint 的藏品'); end if;
    insert into onchain.mints (user_id, wallet_id, template_id, operation_id, permit_expires_at)
    values (v_user_id, v_wallet.id, p_template_id, p_operation_id, now() + interval '10 minutes') returning * into v_mint;
    perform inventory.reserve(v_user_id, p_template_id, 1, 'mint', v_mint.id);
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
  select * into v_mint from onchain.mints where id = p_mint_id for update;
  if v_mint.id is null or v_mint.status <> 'reserved' or v_mint.permit_expires_at <= now() then perform api.raise_business_error('MINT_NOT_SUBMITTABLE', 'Mint 预留已失效'); end if;
  select address into v_receiver from onchain.wallets where id = v_mint.wallet_id;
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
