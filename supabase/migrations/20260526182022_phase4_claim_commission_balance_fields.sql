-- Phase 4 / 10.2 commission claim balance response.
-- Extends the existing claim transaction response with KCOIN balance snapshots.

begin;

create or replace function api.referral_claim_commission(
  p_user_id uuid,
  p_commission_ids uuid[] default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_scoped_key text;
  v_request_hash text;
  v_requested_ids uuid[];
  v_existing_idempotency ops.idempotency_keys%rowtype;
  v_commission_ids uuid[] := array[]::uuid[];
  v_claim_count integer := 0;
  v_claim_amount numeric(38,0) := 0;
  v_credit jsonb;
  v_ledger_id uuid;
  v_kcoin_balance_before numeric(38,0);
  v_kcoin_balance_after numeric(38,0);
  v_kcoin_locked_after numeric(38,0);
  v_response jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  if p_commission_ids is not null then
    select coalesce(array_agg(distinct x.id order by x.id), array[]::uuid[])
      into v_requested_ids
    from unnest(p_commission_ids) as x(id)
    where x.id is not null;

    if cardinality(v_requested_ids) = 0 then
      raise exception 'commission_ids are required';
    end if;
  end if;

  v_scoped_key := 'referral_claim_commission:' || v_idempotency_key;
  v_request_hash := md5(jsonb_build_object(
    'user_id', p_user_id,
    'commission_ids', case
      when v_requested_ids is null then to_jsonb('all'::text)
      else to_jsonb(v_requested_ids)
    end
  )::text);

  perform pg_advisory_xact_lock(hashtext('referral_claim_commission'), hashtext(v_scoped_key));

  select * into v_existing_idempotency
  from ops.idempotency_keys
  where key = v_scoped_key
  for update;

  if v_existing_idempotency.key is not null then
    if v_existing_idempotency.scope <> 'referral_claim_commission'
       or v_existing_idempotency.user_id is distinct from p_user_id
       or v_existing_idempotency.request_hash is distinct from v_request_hash then
      raise exception 'idempotency conflict';
    end if;

    if v_existing_idempotency.status = 'completed'
       and v_existing_idempotency.response is not null then
      return v_existing_idempotency.response || jsonb_build_object('idempotent', true);
    end if;

    raise exception 'idempotency request is still in progress';
  end if;

  insert into ops.idempotency_keys (
    key,
    user_id,
    scope,
    request_hash,
    status,
    locked_until
  ) values (
    v_scoped_key,
    p_user_id,
    'referral_claim_commission',
    v_request_hash,
    'started',
    now() + interval '5 minutes'
  );

  with locked_commissions as (
    select c.id, c.commission_amount_kcoin, c.created_at
    from tasks.referral_commissions c
    where c.inviter_user_id = p_user_id
      and c.status = 'pending'
      and (v_requested_ids is null or c.id = any(v_requested_ids))
    order by c.created_at, c.id
    for update
  )
  select
    coalesce(array_agg(id order by created_at, id), array[]::uuid[]),
    coalesce(sum(commission_amount_kcoin), 0)::numeric(38,0),
    count(*)::integer
  into v_commission_ids, v_claim_amount, v_claim_count
  from locked_commissions;

  if v_requested_ids is not null
     and v_claim_count <> cardinality(v_requested_ids) then
    raise exception 'commission not found or not pending';
  end if;

  if v_claim_count = 0 then
    v_response := jsonb_build_object(
      'processed', true,
      'claimed', false,
      'claimed_count', 0,
      'claimed_amount_kcoin', 0,
      'amount_kcoin', 0,
      'commission_ids', '[]'::jsonb,
      'ledger_id', null,
      'kcoin_balance_before', null,
      'kcoin_balance_after', null,
      'kcoin_locked_after', null,
      'balance_change', 0,
      'status', 'no_pending',
      'idempotent', false
    );

    update ops.idempotency_keys
    set response = v_response,
        status = 'completed',
        locked_until = null,
        updated_at = now()
    where key = v_scoped_key;

    return v_response;
  end if;

  v_credit := api._credit_balance(
    p_user_id,
    'KCOIN',
    v_claim_amount,
    'referral_commission_claim',
    case when v_claim_count = 1 then v_commission_ids[1] else null end,
    null,
    'referral_commission_claim:' || v_idempotency_key,
    'Referral commission claim',
    jsonb_build_object(
      'commission_ids', to_jsonb(v_commission_ids),
      'claim_count', v_claim_count
    )
  );
  v_ledger_id := (v_credit ->> 'ledger_id')::uuid;
  v_kcoin_balance_before := (v_credit ->> 'available_before')::numeric(38,0);
  v_kcoin_balance_after := (v_credit ->> 'available_after')::numeric(38,0);
  v_kcoin_locked_after := (v_credit ->> 'locked_after')::numeric(38,0);

  update tasks.referral_commissions
  set status = 'granted',
      ledger_id = v_ledger_id,
      claimed_at = now()
  where id = any(v_commission_ids)
    and status = 'pending';

  v_response := jsonb_build_object(
    'processed', true,
    'claimed', true,
    'claimed_count', v_claim_count,
    'claimed_amount_kcoin', v_claim_amount,
    'amount_kcoin', v_claim_amount,
    'commission_ids', to_jsonb(v_commission_ids),
    'ledger_id', v_ledger_id,
    'kcoin_balance_before', v_kcoin_balance_before,
    'kcoin_balance_after', v_kcoin_balance_after,
    'kcoin_locked_after', v_kcoin_locked_after,
    'balance_change', v_claim_amount,
    'status', 'granted',
    'idempotent', false
  );

  update ops.idempotency_keys
  set response = v_response,
      status = 'completed',
      locked_until = null,
      updated_at = now()
  where key = v_scoped_key;

  return v_response;
end;
$$;

revoke execute on function api.referral_claim_commission(uuid, uuid[], text)
  from public, anon, authenticated;

grant execute on function api.referral_claim_commission(uuid, uuid[], text)
  to service_role;

commit;
