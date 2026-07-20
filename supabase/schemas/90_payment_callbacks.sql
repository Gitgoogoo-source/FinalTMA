create or replace function payments.process_first_recharge(p_user_id uuid, p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referral referral.relationships%rowtype;
  v_daily integer;
  v_lifetime integer;
  v_valid integer;
begin
  select * into v_referral from referral.relationships where invitee_id = p_user_id for update;
  if v_referral.invitee_id is null or v_referral.first_recharge_at is not null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('pokepets:referral-reward:' || v_referral.inviter_id::text, 0));
  update referral.relationships set first_recharge_at = now() where invitee_id = p_user_id;
  select count(*) into v_daily from referral.relationships where inviter_id = v_referral.inviter_id and (first_recharge_at at time zone 'utc')::date = identity.utc_day() and reward_fgems = 500;
  select count(*) into v_lifetime from referral.relationships where inviter_id = v_referral.inviter_id and reward_fgems = 500;
  if exists (select 1 from identity.users where id = v_referral.inviter_id and status = 'normal') and v_daily < 20 and v_lifetime < 300 then
    perform economy.change_balance(v_referral.inviter_id, 'FGEMS', 500, 'referral_first_recharge', p_operation_id, p_user_id::text);
    update referral.relationships set reward_fgems = 500, reward_operation_id = p_operation_id where invitee_id = p_user_id;
  end if;
  select count(*) into v_valid from referral.relationships where inviter_id = v_referral.inviter_id and first_recharge_at is not null;
  if v_valid >= 5 then
    insert into referral.milestones (user_id, threshold, operation_id) values (v_referral.inviter_id, 5, p_operation_id) on conflict do nothing;
    if found then insert into economy.entitlements (user_id, kind, source, operation_id) values (v_referral.inviter_id, 'free_normal_box', 'referral_5', p_operation_id); end if;
  end if;
  if v_valid >= 10 then
    insert into referral.milestones (user_id, threshold, operation_id) values (v_referral.inviter_id, 10, p_operation_id) on conflict do nothing;
    if found then insert into economy.entitlements (user_id, kind, source, operation_id) values (v_referral.inviter_id, 'free_rare_box', 'referral_10', p_operation_id); end if;
  end if;
end;
$$;

create or replace function payments.deliver(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order payments.orders%rowtype;
  v_user identity.users%rowtype;
  v_subscription vip.subscriptions%rowtype;
  v_result jsonb;
begin
  select * into v_order from payments.orders where id = p_order_id for update;
  if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
  if v_order.status = 'delivered' then return payments.order_json(v_order); end if;
  if v_order.status <> 'paid' then perform api.raise_business_error('PAYMENT_NOT_DELIVERABLE', '支付订单尚不可交付'); end if;
  select * into v_user from identity.users where id = v_order.user_id for update;
  if v_order.kind = 'vip' and v_user.status <> 'normal' then
    update payments.orders set status = 'rejected', updated_at = now() where id = p_order_id returning * into v_order;
    perform operations.fail_command(v_order.operation_id, 'PAYMENT_DELIVERY_BLOCKED', payments.order_json(v_order));
    return payments.order_json(v_order);
  end if;
  if v_order.kind = 'kcoin_topup' then
    perform economy.change_balance(v_order.user_id, 'KCOIN', v_order.kcoin_amount, 'stars_topup', v_order.operation_id, v_order.id::text);
  else
    select * into v_subscription from vip.subscriptions where user_id = v_order.user_id for update;
    if v_subscription.user_id is null or v_subscription.ends_on < identity.utc_day() then
      insert into vip.subscriptions (user_id, starts_on, ends_on, renewal_count)
      values (v_order.user_id, identity.utc_day(), identity.utc_day() + 29, 0)
      on conflict (user_id) do update set period_id = extensions.gen_random_uuid(), starts_on = excluded.starts_on, ends_on = excluded.ends_on, renewal_count = 0, updated_at = now();
    elsif v_subscription.renewal_count < 2 then
      update vip.subscriptions set ends_on = ends_on + 30, renewal_count = renewal_count + 1, updated_at = now() where user_id = v_order.user_id;
    else
      update payments.orders set status = 'rejected', updated_at = now() where id = p_order_id returning * into v_order;
      perform operations.fail_command(v_order.operation_id, 'VIP_RENEWAL_LIMIT', payments.order_json(v_order));
      return payments.order_json(v_order);
    end if;
  end if;
  update payments.orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = p_order_id returning * into v_order;
  perform payments.process_first_recharge(v_order.user_id, v_order.operation_id);
  v_result := payments.order_json(v_order);
  perform operations.complete_command(v_order.operation_id, v_result);
  return v_result;
end;
$$;

create or replace function api.payment_invoice_details(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', id, 'invoice_payload', invoice_payload, 'stars_amount', stars_amount, 'kind', kind)
  from payments.orders where id = p_order_id and status = 'pending'
$$;

create or replace function api.payment_begin_checkout(p_pre_checkout_query_id text, p_invoice_payload text, p_stars bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order payments.orders%rowtype;
  v_user identity.users%rowtype;
begin
  select * into v_order from payments.orders where invoice_payload = p_invoice_payload for update;
  if v_order.id is null or v_order.stars_amount <> p_stars then
    return jsonb_build_object('valid', false, 'payment_id', null);
  end if;
  if v_order.status = 'processing' and v_order.pre_checkout_query_id = p_pre_checkout_query_id then
    return jsonb_build_object('valid', true, 'payment_id', v_order.id);
  end if;
  select * into v_user from identity.users where id = v_order.user_id for update;
  if v_order.status <> 'pending' or v_order.pre_checkout_query_id is not null or v_order.expires_at <= now() or v_user.status <> 'normal' then
    return jsonb_build_object('valid', false, 'payment_id', v_order.id);
  end if;
  update payments.orders
  set status = 'processing', pre_checkout_query_id = p_pre_checkout_query_id,
      checkout_started_at = now(), updated_at = now()
  where id = v_order.id;
  return jsonb_build_object('valid', true, 'payment_id', v_order.id);
end;
$$;

create or replace function api.payment_apply_success(
  p_update_id text,
  p_invoice_payload text,
  p_telegram_charge_id text,
  p_provider_charge_id text,
  p_stars bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_order payments.orders%rowtype;
begin
  insert into operations.webhook_events (provider, event_id, payload) values ('telegram_update', p_update_id, p_payload) on conflict do nothing;
  if not found then return jsonb_build_object('duplicate', true); end if;
  select * into v_order from payments.orders where invoice_payload = p_invoice_payload for update;
  if v_order.id is null or v_order.stars_amount <> p_stars then perform api.raise_business_error('PAYMENT_MISMATCH', '支付订单不匹配'); end if;
  if v_order.telegram_payment_charge_id = p_telegram_charge_id then
    update operations.webhook_events set processed_at = now() where provider = 'telegram_update' and event_id = p_update_id;
    return jsonb_build_object('duplicate', true, 'order', case when v_order.status = 'paid' then payments.deliver(v_order.id) else payments.order_json(v_order) end);
  end if;
  if v_order.telegram_payment_charge_id is not null then perform api.raise_business_error('PAYMENT_MISMATCH', '支付订单已绑定其他付款凭据'); end if;
  update payments.orders
  set status = 'paid', telegram_payment_charge_id = p_telegram_charge_id,
      provider_payment_charge_id = p_provider_charge_id, paid_at = now(), updated_at = now()
  where id = v_order.id;
  update operations.webhook_events set processed_at = now() where provider = 'telegram_update' and event_id = p_update_id;
  return jsonb_build_object('duplicate', false, 'order', payments.deliver(v_order.id));
end;
$$;

create or replace function api.payment_apply_refund(
  p_update_id text,
  p_telegram_charge_id text,
  p_stars bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_order payments.orders%rowtype; v_total bigint;
begin
  insert into operations.webhook_events (provider, event_id, payload) values ('telegram_refund', p_update_id, p_payload) on conflict do nothing;
  if not found then return jsonb_build_object('duplicate', true); end if;
  select * into v_order from payments.orders where telegram_payment_charge_id = p_telegram_charge_id for update;
  if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '退款订单不存在'); end if;
  insert into risk.refunds (payment_id, provider_event_id, stars) values (v_order.id, p_update_id, p_stars) on conflict do nothing;
  if not found then return jsonb_build_object('duplicate', true); end if;
  update payments.orders set refunded_stars = least(stars_amount, refunded_stars + p_stars), status = 'refunded', updated_at = now() where id = v_order.id;
  update identity.users set total_refund_stars = total_refund_stars + p_stars, updated_at = now() where id = v_order.user_id returning total_refund_stars into v_total;
  if v_total > 100 then
    update identity.users set status = 'banned', updated_at = now() where id = v_order.user_id;
    update identity.sessions set revoked_at = now() where user_id = v_order.user_id and revoked_at is null;
  end if;
  update operations.webhook_events set processed_at = now() where provider = 'telegram_refund' and event_id = p_update_id;
  return jsonb_build_object('duplicate', false, 'payment_id', v_order.id, 'total_refund_stars', v_total, 'account_status', case when v_total > 100 then 'banned' else 'normal' end);
end;
$$;
