-- VIP monthly price controlled by trusted Vercel server environment.
--
-- The Vercel API reads VIP_MONTHLY_PRICE_XTR and passes it to this RPC.
-- Frontend expected_price_xtr is only a stale-page guard and never becomes
-- the source of truth.

begin;

create or replace function api.vip_create_order_with_server_price_checked(
  p_user_id uuid,
  p_plan_id uuid,
  p_idempotency_key text,
  p_server_price_xtr integer,
  p_expected_price_xtr integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_status text;
  v_plan vip.vip_plans%rowtype;
  v_existing_order vip.vip_orders%rowtype;
  v_existing_star_order payments.star_orders%rowtype;
  v_vip_order_id uuid := pg_catalog.gen_random_uuid();
  v_star_order_id uuid := pg_catalog.gen_random_uuid();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_payload text;
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_plan_id is null then
    raise exception 'plan_id is required';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;
  if p_server_price_xtr is null or p_server_price_xtr <= 0 then
    raise exception 'server price xtr is invalid';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('vip_create_order_with_server_price_checked'),
    pg_catalog.hashtext(v_key)
  );

  select status into v_user_status
  from core.users
  where id = p_user_id;

  if v_user_status is null then
    raise exception 'user not found';
  end if;
  if v_user_status <> 'active' then
    raise exception 'user is not active';
  end if;

  select * into v_existing_order
  from vip.vip_orders
  where idempotency_key = v_key
  for update;

  if v_existing_order.id is not null then
    if v_existing_order.user_id <> p_user_id
       or v_existing_order.plan_id <> p_plan_id then
      raise exception 'idempotency key conflict';
    end if;
    if p_expected_price_xtr is not null
       and v_existing_order.xtr_amount <> p_expected_price_xtr then
      raise exception 'expected price changed';
    end if;

    select * into v_existing_star_order
    from payments.star_orders
    where id = v_existing_order.star_order_id;

    return jsonb_build_object(
      'vip_order_id', v_existing_order.id,
      'star_order_id', v_existing_order.star_order_id,
      'invoice_payload', v_existing_order.invoice_payload,
      'xtr_amount', v_existing_order.xtr_amount,
      'status', v_existing_order.status,
      'payment_order_status', v_existing_star_order.status,
      'expires_at', v_existing_star_order.expires_at,
      'idempotent', true
    );
  end if;

  select * into v_plan
  from vip.vip_plans
  where id = p_plan_id
  for update;

  if v_plan.id is null then
    raise exception 'vip plan not found';
  end if;
  if v_plan.status <> 'active'
     or (v_plan.starts_at is not null and v_plan.starts_at > now())
     or (v_plan.ends_at is not null and v_plan.ends_at <= now()) then
    raise exception 'vip plan is not active';
  end if;
  if p_expected_price_xtr is not null
     and p_expected_price_xtr <> p_server_price_xtr then
    raise exception 'expected price changed';
  end if;

  v_payload :=
    'vip_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');

  insert into vip.vip_orders (
    id,
    user_id,
    plan_id,
    status,
    xtr_amount,
    invoice_payload,
    idempotency_key,
    metadata
  ) values (
    v_vip_order_id,
    p_user_id,
    v_plan.id,
    'created',
    p_server_price_xtr,
    v_payload,
    v_key,
    jsonb_build_object(
      'plan_code', v_plan.code,
      'duration_days', v_plan.duration_days,
      'price_source', 'server_env',
      'configured_plan_price_xtr', v_plan.price_xtr
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
    'vip_monthly',
    v_vip_order_id,
    'created',
    p_server_price_xtr,
    v_payload,
    v_plan.display_name,
    'VIP monthly card for 30 days',
    v_key,
    v_expires_at,
    jsonb_build_object(
      'plan_id', v_plan.id,
      'plan_code', v_plan.code,
      'duration_days', v_plan.duration_days,
      'manual_renewal', true,
      'price_source', 'server_env',
      'configured_plan_price_xtr', v_plan.price_xtr
    )
  );

  update vip.vip_orders
  set star_order_id = v_star_order_id,
      updated_at = now()
  where id = v_vip_order_id;

  return jsonb_build_object(
    'vip_order_id', v_vip_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', p_server_price_xtr,
    'status', 'created',
    'payment_order_status', 'created',
    'expires_at', v_expires_at,
    'idempotent', false
  );
end;
$$;

comment on function api.vip_create_order_with_server_price_checked(uuid, uuid, text, integer, integer) is
  'Creates a VIP monthly Stars order using the trusted server-provided XTR price from Vercel env.';

revoke execute on function api.vip_create_order_with_server_price_checked(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;

grant execute on function api.vip_create_order_with_server_price_checked(uuid, uuid, text, integer, integer)
  to service_role;

commit;
