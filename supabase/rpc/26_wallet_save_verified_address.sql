-- wallet_save_verified_address.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.wallet_save_verified_address

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


-- ============================================================
