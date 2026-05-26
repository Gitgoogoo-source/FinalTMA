-- gacha_process_dev_paid_order.sql
-- ============================================================
-- First-stage DEV payment helper. It verifies order ownership by
-- order_id + user_id, then reuses the formal paid-order fulfillment RPC.

create or replace function api.gacha_process_dev_paid_order(
  p_order_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order gacha.draw_orders%rowtype;
  v_result jsonb;
begin
  if p_order_id is null or p_user_id is null then
    raise exception 'order_id and user_id are required';
  end if;

  select * into v_order
  from gacha.draw_orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'draw order not found';
  end if;
  if v_order.user_id <> p_user_id then
    raise exception 'draw order does not belong to user';
  end if;
  if v_order.payment_star_order_id is null then
    raise exception 'draw order has no linked star order';
  end if;

  v_result := api.gacha_process_paid_order(
    v_order.payment_star_order_id,
    'dev:' || v_order.id::text,
    'dev-paid',
    jsonb_build_object(
      'mode', 'DEV_PAID',
      'draw_order_id', v_order.id,
      'user_id', p_user_id
    )
  );

  return v_result || jsonb_build_object(
    'payment_mode', 'DEV_PAID',
    'payment_status', 'dev_paid'
  );
end;
$$;


-- ============================================================
