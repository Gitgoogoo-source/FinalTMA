-- Keep K-coin topup denominations aligned with the product recharge choices
-- and expose a service-role-only status RPC.

begin;

create or replace function api.kcoin_topup_create_order(
  p_user_id uuid,
  p_amount integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_status text;
  v_existing payments.kcoin_topup_orders%rowtype;
  v_existing_star_order payments.star_orders%rowtype;
  v_amount integer := p_amount;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_topup_order_id uuid := pg_catalog.gen_random_uuid();
  v_star_order_id uuid := pg_catalog.gen_random_uuid();
  v_payload text;
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;
  if v_amount not in (1, 500, 1000, 5000, 10000) then
    raise exception 'kcoin topup amount is invalid';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('kcoin_topup_create_order'),
    pg_catalog.hashtext(v_key)
  );

  select status into v_user_status
  from core.users
  where id = p_user_id
  for update;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  select * into v_existing
  from payments.kcoin_topup_orders
  where idempotency_key = v_key
  for update;

  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id or v_existing.xtr_amount <> v_amount then
      raise exception 'idempotency key conflict';
    end if;

    select * into v_existing_star_order
    from payments.star_orders
    where id = v_existing.star_order_id;

    return jsonb_build_object(
      'topup_order_id', v_existing.id,
      'star_order_id', v_existing.star_order_id,
      'invoice_payload', v_existing.invoice_payload,
      'xtr_amount', v_existing.xtr_amount,
      'kcoin_amount', v_existing.kcoin_amount,
      'status', v_existing.status,
      'payment_order_status', coalesce(v_existing_star_order.status, v_existing.status),
      'expires_at', v_existing_star_order.expires_at,
      'paid_at', v_existing.paid_at,
      'fulfilled_at', v_existing.fulfilled_at,
      'idempotent', true
    );
  end if;

  v_payload :=
    'kcoin_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into payments.kcoin_topup_orders (
    id,
    user_id,
    status,
    xtr_amount,
    kcoin_amount,
    invoice_payload,
    idempotency_key,
    metadata
  ) values (
    v_topup_order_id,
    p_user_id,
    'created',
    v_amount,
    v_amount,
    v_payload,
    v_key,
    jsonb_build_object(
      'exchange_rate', '1_star_to_1_kcoin',
      'allowed_amounts', jsonb_build_array(1, 500, 1000, 5000, 10000)
    )
  );

  insert into payments.star_orders (
    id,
    user_id,
    business_type,
    business_id,
    status,
    xtr_amount,
    telegram_invoice_payload,
    title,
    description,
    idempotency_key,
    expires_at,
    metadata
  ) values (
    v_star_order_id,
    p_user_id,
    'kcoin_topup',
    v_topup_order_id,
    'created',
    v_amount,
    v_payload,
    'K-coin Recharge',
    v_amount::text || ' K-coin',
    v_key,
    v_expires_at,
    jsonb_build_object(
      'topup_order_id', v_topup_order_id,
      'kcoin_amount', v_amount,
      'exchange_rate', '1_star_to_1_kcoin'
    )
  );

  update payments.kcoin_topup_orders
  set star_order_id = v_star_order_id,
      updated_at = now()
  where id = v_topup_order_id;

  return jsonb_build_object(
    'topup_order_id', v_topup_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', v_amount,
    'kcoin_amount', v_amount,
    'status', 'created',
    'payment_order_status', 'created',
    'expires_at', v_expires_at,
    'idempotent', false
  );
end;
$$;

create or replace function api.kcoin_topup_get_status(
  p_user_id uuid,
  p_topup_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topup_order payments.kcoin_topup_orders%rowtype;
  v_star_order payments.star_orders%rowtype;
  v_payment payments.star_payments%rowtype;
begin
  if p_user_id is null or p_topup_order_id is null then
    return null;
  end if;

  select * into v_topup_order
  from payments.kcoin_topup_orders
  where id = p_topup_order_id
    and user_id = p_user_id;

  if v_topup_order.id is null then
    return null;
  end if;

  if v_topup_order.star_order_id is not null then
    select * into v_star_order
    from payments.star_orders
    where id = v_topup_order.star_order_id
      and user_id = p_user_id
      and business_type = 'kcoin_topup';
  end if;

  if v_star_order.id is not null then
    select * into v_payment
    from payments.star_payments
    where star_order_id = v_star_order.id
      and user_id = p_user_id
    order by paid_at desc, created_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'order_id', v_topup_order.id,
    'topup_order_id', v_topup_order.id,
    'star_order_id', v_topup_order.star_order_id,
    'status', v_topup_order.status,
    'payment_order_status', coalesce(v_star_order.status, v_topup_order.status),
    'xtr_amount', v_topup_order.xtr_amount,
    'kcoin_amount', v_topup_order.kcoin_amount,
    'paid_at', coalesce(v_topup_order.paid_at, v_star_order.paid_at, v_payment.paid_at),
    'fulfilled_at', coalesce(v_topup_order.fulfilled_at, v_star_order.fulfilled_at),
    'topup_order', jsonb_build_object(
      'id', v_topup_order.id,
      'status', v_topup_order.status,
      'xtr_amount', v_topup_order.xtr_amount,
      'kcoin_amount', v_topup_order.kcoin_amount,
      'paid_at', v_topup_order.paid_at,
      'fulfilled_at', v_topup_order.fulfilled_at,
      'created_at', v_topup_order.created_at,
      'updated_at', v_topup_order.updated_at,
      'has_error', v_topup_order.error_message is not null
    ),
    'star_order', case
      when v_star_order.id is null then null
      else jsonb_build_object(
        'id', v_star_order.id,
        'status', v_star_order.status,
        'payment_order_status', v_star_order.status,
        'xtr_amount', v_star_order.xtr_amount,
        'expires_at', v_star_order.expires_at,
        'precheckout_at', v_star_order.precheckout_at,
        'paid_at', v_star_order.paid_at,
        'fulfilled_at', v_star_order.fulfilled_at,
        'created_at', v_star_order.created_at,
        'updated_at', v_star_order.updated_at,
        'has_error', v_star_order.error_message is not null
      )
    end,
    'payment', jsonb_build_object(
      'recorded', v_payment.id is not null,
      'status', case when v_payment.id is not null then 'paid' else coalesce(v_star_order.status, v_topup_order.status) end,
      'currency', coalesce(v_payment.currency, 'XTR'),
      'xtr_amount', coalesce(v_payment.xtr_amount, v_star_order.xtr_amount, v_topup_order.xtr_amount),
      'paid_at', v_payment.paid_at,
      'created_at', v_payment.created_at
    ),
    'fulfillment', jsonb_build_object(
      'status', v_topup_order.status,
      'credited', v_topup_order.status = 'fulfilled' and v_topup_order.credit_ledger_id is not null,
      'completed_at', coalesce(v_topup_order.fulfilled_at, v_star_order.fulfilled_at),
      'failed', v_topup_order.status = 'failed',
      'retryable', v_topup_order.status = 'failed' and coalesce(v_topup_order.paid_at, v_star_order.paid_at, v_payment.paid_at) is not null
    ),
    'server_time', now()
  );
end;
$$;

comment on function api.kcoin_topup_create_order(uuid, integer, text) is
  'Creates a service-role-only KCOIN topup order and linked Telegram Stars order for one allowed recharge amount.';

comment on function api.kcoin_topup_get_status(uuid, uuid) is
  'Returns a redacted KCOIN topup status snapshot for one session user and order.';

revoke execute on function api.kcoin_topup_create_order(uuid, integer, text)
  from public, anon, authenticated;
revoke execute on function api.kcoin_topup_get_status(uuid, uuid)
  from public, anon, authenticated;

grant execute on function api.kcoin_topup_create_order(uuid, integer, text)
  to service_role;
grant execute on function api.kcoin_topup_get_status(uuid, uuid)
  to service_role;

commit;
