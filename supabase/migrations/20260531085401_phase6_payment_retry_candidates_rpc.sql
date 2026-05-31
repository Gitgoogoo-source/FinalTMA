-- Phase 6 payment retry candidate listing RPC.
-- Keeps payments schema private from PostgREST while allowing service-role ops
-- scripts to discover retryable fulfillment orders.

begin;

create or replace function api.admin_list_retryable_payment_orders(
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(coalesce(p_limit, 10), 100);
begin
  if v_limit <= 0 then
    raise exception 'PAYMENT_RETRY_LIMIT_INVALID' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'limit', v_limit,
    'statuses', to_jsonb(array['paid', 'fulfilling', 'failed']::text[]),
    'orders', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'star_order_id', candidate.id,
            'status', candidate.status,
            'xtr_amount', candidate.xtr_amount,
            'paid_at', candidate.paid_at,
            'updated_at', candidate.updated_at,
            'fulfilled_at', candidate.fulfilled_at
          )
          order by candidate.updated_at asc, candidate.id asc
        )
        from (
          select
            so.id,
            so.status,
            so.xtr_amount,
            so.paid_at,
            so.updated_at,
            so.fulfilled_at
          from payments.star_orders so
          where so.status in ('paid', 'fulfilling', 'failed')
            and so.fulfilled_at is null
          order by so.updated_at asc, so.id asc
          limit v_limit
        ) candidate
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function api.admin_list_retryable_payment_orders(integer)
from public, anon, authenticated;

grant execute on function api.admin_list_retryable_payment_orders(integer)
to service_role;

comment on function api.admin_list_retryable_payment_orders(integer) is
  'Lists paid/fulfilling/failed Star orders that have no fulfilled_at timestamp for the payment retry ops script. Service-role only.';

commit;
