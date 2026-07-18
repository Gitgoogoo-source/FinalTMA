create or replace function api.topup_create_order(
  p_session_id uuid,
  p_operation_id uuid,
  p_mode text,
  p_amount bigint,
  p_intent jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_balance bigint;
  v_required bigint;
  v_tier text;
  v_count integer;
  v_template catalog.templates%rowtype;
  v_box catalog.boxes%rowtype;
  v_order payments.orders%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'topup.create_order', p_operation_id, jsonb_strip_nulls(jsonb_build_object('mode', p_mode, 'amount', p_amount, 'intent', p_intent)));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if exists (select 1 from payments.orders where user_id = v_user_id and kind = 'kcoin_topup' and status in ('pending', 'paid')) then
      perform api.raise_business_error('PAYMENT_ALREADY_PENDING', '已有待处理充值订单');
    end if;
    if p_mode = 'fixed' then
      if p_amount is null or not exists (select 1 from catalog.topup_products where amount = p_amount) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '充值档位无效'); end if;
      v_required := p_amount;
    elsif p_mode = 'exact_gap' then
      select available into v_balance from economy.balances where user_id = v_user_id and currency = 'KCOIN' for update;
      if p_intent->>'kind' = 'gacha' then
        v_tier := p_intent->>'tier'; v_count := (p_intent->>'draw_count')::integer;
        select * into v_box from catalog.boxes where tier = v_tier;
        if v_box.tier is null or v_count not in (1, 10) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '开盒补差意图无效'); end if;
        v_required := case when v_count = 10 then v_box.ten_price else v_box.single_price end;
        if v_count = 1 and v_tier in ('normal', 'rare') and exists (
          select 1 from economy.entitlements where user_id = v_user_id and kind = case v_tier when 'normal' then 'free_normal_box' else 'free_rare_box' end and status = 'unused'
        ) then v_required := 0; end if;
      elsif p_intent->>'kind' = 'market' then
        select * into v_template from catalog.templates where id = p_intent->>'template_id';
        v_count := (p_intent->>'quantity')::integer;
        if v_template.id is null or v_count <= 0 then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '市场补差意图无效'); end if;
        v_required := v_template.market_price * v_count;
      elsif p_intent->>'kind' = 'wheel' then
        v_count := (p_intent->>'count')::integer;
        if v_count not in (1, 10) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '转盘补差意图无效'); end if;
        v_required := case when v_count = 10 then 180 else 20 end;
      else
        perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '补差意图无效');
      end if;
      v_required := greatest(v_required - coalesce(v_balance, 0), 0);
      if v_required = 0 then perform api.raise_business_error('TOPUP_NOT_REQUIRED', '当前余额无需补差'); end if;
    else
      perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '充值模式无效');
    end if;
    insert into payments.orders (user_id, operation_id, kind, stars_amount, kcoin_amount, invoice_payload, intent, expires_at)
    values (v_user_id, p_operation_id, 'kcoin_topup', v_required, v_required, 'pokepets:' || extensions.gen_random_uuid(), coalesce(p_intent, '{}'::jsonb), now() + interval '15 minutes')
    returning * into v_order;
    v_result := payments.order_json(v_order);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.vip_create_order(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_status jsonb;
  v_order payments.orders%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'vip.create_order', p_operation_id, '{}'::jsonb);
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    v_status := vip.status_json(v_user_id);
    if not coalesce((v_status->>'can_purchase')::boolean, false) and not coalesce((v_status->>'can_renew')::boolean, false) then perform api.raise_business_error('VIP_RENEWAL_LIMIT', '月卡续费次数已达上限'); end if;
    if exists (select 1 from payments.orders where user_id = v_user_id and kind = 'vip' and status in ('pending', 'paid')) then perform api.raise_business_error('PAYMENT_ALREADY_PENDING', '已有待处理月卡订单'); end if;
    insert into payments.orders (user_id, operation_id, kind, stars_amount, invoice_payload, expires_at)
    values (v_user_id, p_operation_id, 'vip', 199, 'pokepets:' || extensions.gen_random_uuid(), now() + interval '15 minutes') returning * into v_order;
    v_result := payments.order_json(v_order);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.payment_set_invoice_url(p_order_id uuid, p_invoice_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_order payments.orders%rowtype; v_result jsonb;
begin
  update payments.orders set invoice_url = coalesce(invoice_url, p_invoice_url), updated_at = now()
  where id = p_order_id and status = 'pending' returning * into v_order;
  if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
  v_result := payments.order_json(v_order);
  update operations.operations set result = v_result, updated_at = now() where id = v_order.operation_id and status = 'pending';
  return v_result;
end;
$$;
