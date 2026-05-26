-- referral_create_commission.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.referral_create_commission

create or replace function api.referral_create_commission(
  p_invitee_user_id uuid,
  p_source_id uuid,
  p_base_amount_kcoin numeric,
  p_commission_bps integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref tasks.referrals%rowtype;
  v_order gacha.draw_orders%rowtype;
  v_result_count integer := 0;
  v_required_result_count integer := 0;
  v_amount numeric(38,0);
  v_commission_setting jsonb;
  v_commission_bps integer;
  v_commission_id uuid;
  v_existing tasks.referral_commissions%rowtype;
begin
  if p_invitee_user_id is null then
    raise exception 'invitee_user_id is required';
  end if;

  if p_source_id is null then
    raise exception 'source_id is required';
  end if;

  select *
  into v_order
  from gacha.draw_orders
  where id = p_source_id
  for share;

  if v_order.id is null or v_order.user_id <> p_invitee_user_id then
    return jsonb_build_object(
      'processed', false,
      'reason', 'draw_order_not_found'
    );
  end if;

  select count(*)::integer
  into v_result_count
  from gacha.draw_results
  where draw_order_id = p_source_id
    and user_id = p_invitee_user_id;

  v_required_result_count := greatest(coalesce(v_order.draw_count, v_order.quantity, 1), 1);

  if v_order.status not in ('opening', 'opened', 'completed')
     or v_result_count < v_required_result_count then
    return jsonb_build_object(
      'processed', false,
      'reason', 'draw_order_not_successful',
      'draw_order_id', p_source_id,
      'status', v_order.status,
      'result_count', v_result_count,
      'required_result_count', v_required_result_count
    );
  end if;

  if p_base_amount_kcoin is null or p_base_amount_kcoin <= 0 then
    return jsonb_build_object('processed', false, 'reason', 'no_base_amount');
  end if;

  if p_commission_bps is null then
    select value
    into v_commission_setting
    from ops.system_settings
    where key = 'REFERRAL_COMMISSION_BPS';

    if v_commission_setting is null then
      raise exception 'referral commission bps setting is required';
    elsif jsonb_typeof(v_commission_setting) = 'object'
          and v_commission_setting ? 'commission_bps'
          and (v_commission_setting ->> 'commission_bps') ~ '^[0-9]+$' then
      v_commission_bps := (v_commission_setting ->> 'commission_bps')::integer;
    else
      raise exception 'invalid referral commission bps setting';
    end if;
  else
    v_commission_bps := p_commission_bps;
  end if;

  if v_commission_bps < 0 or v_commission_bps > 10000 then
    raise exception 'commission_bps must be between 0 and 10000';
  end if;

  select * into v_ref
  from tasks.referrals
  where invitee_user_id = p_invitee_user_id
    and status = 'rewarded'
  limit 1;

  if v_ref.id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_rewarded_referral');
  end if;

  if v_ref.first_open_order_id is not distinct from p_source_id then
    return jsonb_build_object(
      'processed', false,
      'reason', 'first_open_order_not_commissionable',
      'referral_id', v_ref.id,
      'draw_order_id', p_source_id
    );
  end if;

  select * into v_existing
  from tasks.referral_commissions
  where referral_id = v_ref.id
    and source_type = 'gacha_open'
    and source_id = p_source_id
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'processed', true,
      'commission_id', v_existing.id,
      'amount_kcoin', v_existing.commission_amount_kcoin,
      'status', v_existing.status,
      'ledger_id', v_existing.ledger_id,
      'claimed_at', v_existing.claimed_at,
      'idempotent', true
    );
  end if;

  v_amount := floor(p_base_amount_kcoin * v_commission_bps / 10000);
  if v_amount <= 0 then
    return jsonb_build_object('processed', false, 'reason', 'zero_commission');
  end if;

  insert into tasks.referral_commissions (
    referral_id,
    inviter_user_id,
    invitee_user_id,
    source_type,
    source_id,
    base_amount_kcoin,
    commission_bps,
    commission_amount_kcoin,
    status
  ) values (
    v_ref.id,
    v_ref.inviter_user_id,
    v_ref.invitee_user_id,
    'gacha_open',
    p_source_id,
    p_base_amount_kcoin,
    v_commission_bps,
    v_amount,
    'pending'
  ) returning id into v_commission_id;

  return jsonb_build_object(
    'processed', true,
    'commission_id', v_commission_id,
    'amount_kcoin', v_amount,
    'status', 'pending',
    'ledger_id', null,
    'claimed_at', null,
    'idempotent', false
  );
end;
$$;


-- RPC: api.referral_claim_commission

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


-- ============================================================
