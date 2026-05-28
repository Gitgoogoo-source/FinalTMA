-- Phase 5 step 10: wallet security and idempotency hardening.
-- Keep the existing verified-wallet task progress wrapper, and add an audit
-- event when a newly verified primary wallet replaces a different primary.

begin;

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
  v_previous_primary core.user_wallets%rowtype;
  v_network text := coalesce(nullif(btrim(p_network), ''), 'mainnet');
begin
  if coalesce(p_is_primary, true) then
    select *
    into v_previous_primary
    from core.user_wallets
    where user_id = p_user_id
      and chain = 'TON'
      and network = v_network
      and status = 'connected'
      and is_primary = true
    order by verified_at desc nulls last, updated_at desc
    limit 1
    for update;
  end if;

  v_result := api.wallet_save_verified_address_without_task_progress(
    p_user_id,
    p_address,
    p_address_raw,
    v_network,
    p_wallet_app_name,
    p_is_primary
  );

  v_wallet_id := nullif(v_result ->> 'wallet_id', '')::uuid;

  if coalesce(p_is_primary, true)
     and v_wallet_id is not null
     and v_previous_primary.id is not null
     and v_previous_primary.id <> v_wallet_id then
    insert into ops.app_events (user_id, event_name, event_source, payload)
    values (
      p_user_id,
      'wallet_primary_switched',
      'wallet_rpc',
      jsonb_build_object(
        'previous_wallet_id', v_previous_primary.id,
        'new_wallet_id', v_wallet_id,
        'network', v_network,
        'previous_address_hash', encode(extensions.digest(v_previous_primary.address, 'sha256'), 'hex'),
        'new_address_hash', encode(extensions.digest(p_address, 'sha256'), 'hex')
      )
    );
  end if;

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

revoke execute on function api.wallet_save_verified_address(uuid, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function api.wallet_save_verified_address(uuid, text, text, text, text, boolean)
  to service_role;

commit;
