-- Phase 5: server-side payment status read RPC.
-- Keep gacha/payments private from PostgREST and expose only a service-role API RPC.

create or replace function api.gacha_get_payment_status(
  p_user_id uuid,
  p_draw_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order gacha.draw_orders%rowtype;
  v_star_order payments.star_orders%rowtype;
  v_star_payment payments.star_payments%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_draw_order_id is null then
    raise exception 'draw_order_id is required';
  end if;

  select * into v_order
  from gacha.draw_orders
  where id = p_draw_order_id
    and user_id = p_user_id
  limit 1;

  if v_order.id is null then
    return null;
  end if;

  if v_order.payment_star_order_id is not null then
    select * into v_star_order
    from payments.star_orders
    where id = v_order.payment_star_order_id
      and user_id = p_user_id
    limit 1;
  else
    select * into v_star_order
    from payments.star_orders
    where user_id = p_user_id
      and business_type = 'gacha_open'
      and business_id = v_order.id
    order by created_at desc
    limit 1;
  end if;

  if v_star_order.id is not null then
    select * into v_star_payment
    from payments.star_payments
    where star_order_id = v_star_order.id
      and user_id = p_user_id
    order by paid_at desc nulls last, created_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'draw_order', jsonb_build_object(
      'id', v_order.id,
      'user_id', v_order.user_id,
      'box_id', v_order.box_id,
      'payment_star_order_id', v_order.payment_star_order_id,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'draw_count', v_order.draw_count,
      'quantity', v_order.quantity,
      'total_price_stars', v_order.total_price_stars,
      'open_reward_kcoin', v_order.open_reward_kcoin,
      'paid_at', v_order.paid_at,
      'opened_at', v_order.opened_at,
      'created_at', v_order.created_at,
      'updated_at', v_order.updated_at,
      'error_message', v_order.error_message
    ),
    'star_order', case
      when v_star_order.id is null then null
      else jsonb_build_object(
        'id', v_star_order.id,
        'user_id', v_star_order.user_id,
        'business_type', v_star_order.business_type,
        'business_id', v_star_order.business_id,
        'status', v_star_order.status,
        'xtr_amount', v_star_order.xtr_amount,
        'expires_at', v_star_order.expires_at,
        'precheckout_at', v_star_order.precheckout_at,
        'paid_at', v_star_order.paid_at,
        'fulfilled_at', v_star_order.fulfilled_at,
        'created_at', v_star_order.created_at,
        'updated_at', v_star_order.updated_at,
        'error_message', v_star_order.error_message
      )
    end,
    'payment', case
      when v_star_payment.id is null then null
      else jsonb_build_object(
        'id', v_star_payment.id,
        'star_order_id', v_star_payment.star_order_id,
        'user_id', v_star_payment.user_id,
        'currency', v_star_payment.currency,
        'xtr_amount', v_star_payment.xtr_amount,
        'paid_at', v_star_payment.paid_at,
        'created_at', v_star_payment.created_at
      )
    end
  );
end;
$$;

revoke execute on function api.gacha_get_payment_status(uuid, uuid)
from public, anon, authenticated;

grant execute on function api.gacha_get_payment_status(uuid, uuid)
to service_role;

comment on function api.gacha_get_payment_status(uuid, uuid) is
  'Returns a sanitized payment-status snapshot for one user-owned gacha draw order. Keeps gacha/payments tables outside exposed PostgREST schemas.';
