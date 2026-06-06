-- Allow K-coin topups to either use a fixed package or exactly cover the
-- current K-coin shortage for a server-priced open-box action.

begin;

drop function if exists api.kcoin_topup_create_order(uuid, integer, text);

create or replace function api.kcoin_topup_create_order(
  p_user_id uuid,
  p_amount integer,
  p_idempotency_key text,
  p_intent text default 'MANUAL_TOPUP',
  p_box_slug text default null,
  p_draw_count integer default null,
  p_required_kcoin integer default null
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
  v_intent text := upper(nullif(btrim(coalesce(p_intent, 'MANUAL_TOPUP')), ''));
  v_box_slug text := nullif(btrim(coalesce(p_box_slug, '')), '');
  v_draw_count integer := p_draw_count;
  v_required_kcoin integer := p_required_kcoin;
  v_available_kcoin numeric(38,0) := 0;
  v_shortage_kcoin numeric(38,0) := 0;
  v_is_fixed_package boolean := false;
  v_is_shortage_topup boolean := false;
  v_topup_type text := 'PACKAGE';
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
  if v_amount is null or v_amount <= 0 then
    raise exception 'kcoin topup amount is invalid';
  end if;

  if v_intent is null then
    v_intent := 'MANUAL_TOPUP';
  end if;

  if v_intent not in ('MANUAL_TOPUP', 'OPEN_BOX') then
    raise exception 'open box topup context is invalid';
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

  v_is_fixed_package := v_amount in (500, 1000, 5000, 10000);

  if v_intent = 'MANUAL_TOPUP' then
    if not v_is_fixed_package then
      raise exception 'kcoin topup amount is invalid';
    end if;
  else
    if v_box_slug is null
       or v_draw_count is null
       or v_draw_count not in (1, 10)
       or v_required_kcoin is null
       or v_required_kcoin <= 0 then
      raise exception 'open box topup context is invalid';
    end if;

    insert into economy.user_balances (user_id, currency_code)
    values (p_user_id, 'KCOIN')
    on conflict (user_id, currency_code) do nothing;

    select coalesce(available_amount, 0)
    into v_available_kcoin
    from economy.user_balances
    where user_id = p_user_id
      and currency_code = 'KCOIN'
    for update;

    v_shortage_kcoin := greatest(v_required_kcoin::numeric - v_available_kcoin, 0);
    v_is_shortage_topup := v_shortage_kcoin > 0 and v_amount::numeric = v_shortage_kcoin;

    if not v_is_fixed_package and not v_is_shortage_topup then
      raise exception 'kcoin topup amount is invalid';
    end if;

    if v_available_kcoin + v_amount < v_required_kcoin then
      raise exception 'topup amount is not enough for open box';
    end if;

    if v_is_shortage_topup then
      v_topup_type := 'SHORTAGE';
    end if;
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
      'allowed_amounts', jsonb_build_array('SHORTAGE', 500, 1000, 5000, 10000),
      'intent', v_intent,
      'topup_type', v_topup_type,
      'box_slug', v_box_slug,
      'draw_count', v_draw_count,
      'required_kcoin', v_required_kcoin,
      'balance_before', v_available_kcoin,
      'shortage_kcoin', v_shortage_kcoin,
      'estimated_balance_after_topup', v_available_kcoin + v_amount,
      'estimated_balance_after_open_box',
        case
          when v_intent = 'OPEN_BOX'
            then v_available_kcoin + v_amount - v_required_kcoin
          else null
        end
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
      'exchange_rate', '1_star_to_1_kcoin',
      'intent', v_intent,
      'topup_type', v_topup_type,
      'box_slug', v_box_slug,
      'draw_count', v_draw_count,
      'required_kcoin', v_required_kcoin
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
    'intent', v_intent,
    'topup_type', v_topup_type,
    'required_kcoin', v_required_kcoin,
    'balance_before', v_available_kcoin,
    'shortage_kcoin', v_shortage_kcoin,
    'estimated_balance_after_topup', v_available_kcoin + v_amount,
    'estimated_balance_after_open_box',
      case
        when v_intent = 'OPEN_BOX'
          then v_available_kcoin + v_amount - v_required_kcoin
        else null
      end,
    'idempotent', false
  );
end;
$$;

comment on function api.kcoin_topup_create_order(uuid, integer, text, text, text, integer, integer) is
  'Creates a Telegram Stars K-coin topup order. Manual topups must use fixed packages; OPEN_BOX topups may also exactly cover the current KCOIN shortage for the server-priced draw.';

revoke execute on function api.kcoin_topup_create_order(uuid, integer, text, text, text, integer, integer)
  from public, anon, authenticated;

grant execute on function api.kcoin_topup_create_order(uuid, integer, text, text, text, integer, integer)
  to service_role;

do $$
declare
  v_function_def text;
  v_updated_function_def text;
begin
  select pg_get_functiondef(
    'api.gacha_open_with_kcoin_from_server_price(uuid,text,integer,text,integer,integer)'::regprocedure
  )
  into v_function_def;

  v_updated_function_def := replace(
    v_function_def,
$needle$
  v_progress_result jsonb;
  v_draw_i integer;
  v_rows integer;
$needle$,
$replacement$
  v_progress_result jsonb;
  v_available_kcoin numeric(38,0) := 0;
  v_shortage_kcoin numeric(38,0) := 0;
  v_draw_i integer;
  v_rows integer;
$replacement$
  );

  v_updated_function_def := replace(
    v_updated_function_def,
$needle$
  v_payload :=
    'kcoin_gacha_' ||
$needle$,
$replacement$
  insert into economy.user_balances (user_id, currency_code)
  values (p_user_id, 'KCOIN')
  on conflict (user_id, currency_code) do nothing;

  select coalesce(available_amount, 0)
  into v_available_kcoin
  from economy.user_balances
  where user_id = p_user_id
    and currency_code = 'KCOIN'
  for update;

  if v_available_kcoin < v_total_price then
    v_shortage_kcoin := v_total_price::numeric - v_available_kcoin;
    raise exception 'insufficient balance: required=%, balance=%, shortage=%',
      v_total_price,
      v_available_kcoin,
      v_shortage_kcoin;
  end if;

  v_payload :=
    'kcoin_gacha_' ||
$replacement$
  );

  if v_updated_function_def = v_function_def
     or position('v_available_kcoin numeric(38,0)' in v_updated_function_def) = 0
     or position('insufficient balance: required=%' in v_updated_function_def) = 0 then
    raise exception 'failed to patch gacha_open_with_kcoin_from_server_price shortage details';
  end if;

  execute v_updated_function_def;
end;
$$;

commit;
