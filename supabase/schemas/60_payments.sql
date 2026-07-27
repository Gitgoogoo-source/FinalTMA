create table payments.topup_products (
  amount bigint primary key check (amount > 0),
  sort_order smallint not null unique check (sort_order > 0)
);

create table payments.orders (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  operation_id uuid not null unique references operations.operations(id),
  kind text not null check (kind in ('kcoin_topup', 'vip')),
  stars_amount bigint not null check (stars_amount > 0),
  kcoin_amount bigint not null default 0 check (kcoin_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'delivered', 'failed', 'cancelled', 'expired', 'refunded', 'rejected')),
  invoice_payload text not null unique,
  invoice_url text,
  pre_checkout_query_id text unique,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  intent jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  checkout_started_at timestamptz,
  paid_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  refunded_stars bigint not null default 0 check (refunded_stars >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_orders_pending_idx on payments.orders (expires_at, created_at) where status in ('pending', 'processing', 'paid');
create index payment_orders_user_created_idx on payments.orders (user_id, created_at desc);
create unique index payment_orders_user_kind_open_idx on payments.orders (user_id, kind) where status in ('pending', 'processing', 'paid');

create or replace function payments.order_json(p_order payments.orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'kind', p_order.kind,
    'status', p_order.status,
    'stars_amount', p_order.stars_amount,
    'kcoin_amount', p_order.kcoin_amount,
    'invoice_url', p_order.invoice_url,
    'expires_at', p_order.expires_at,
    'checkout_started_at', p_order.checkout_started_at,
    'paid_at', p_order.paid_at,
    'delivered_at', p_order.delivered_at,
    'failed_at', p_order.failed_at,
    'cancelled_at', p_order.cancelled_at,
    'intent', nullif(
      p_order.intent - 'battle_invite_token_hash',
      '{}'::jsonb
    )
  )
$$;

create or replace function api.topup_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'products', coalesce((select jsonb_agg(amount order by sort_order) from payments.topup_products), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(payments.order_json(p) order by p.created_at desc)
      from (
        select * from payments.orders
        where user_id = v_user_id
        order by created_at desc
        limit 10
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.topup_order(p_session_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select payments.order_json(p) into v_result
  from payments.orders p where p.id = p_order_id and p.user_id = v_user_id;
  if v_result is null then
    perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在');
  end if;
  return v_result;
end;
$$;

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
  v_box gacha.boxes%rowtype;
  v_battle_ruleset battle.rulesets%rowtype;
  v_battle_tier battle.entry_tiers%rowtype;
  v_battle_room battle.rooms%rowtype;
  v_battle_session identity.sessions%rowtype;
  v_battle_creator identity.users%rowtype;
  v_battle_room_id uuid;
  v_order payments.orders%rowtype;
  v_stale payments.orders%rowtype;
  v_result jsonb;
  v_normalized_intent jsonb := coalesce(p_intent, '{}'::jsonb);
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'topup.create_order', p_operation_id, jsonb_strip_nulls(jsonb_build_object('mode', p_mode, 'amount', p_amount, 'intent', p_intent)));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('pokepets:payment:' || v_user_id::text || ':kcoin_topup', 0));
    for v_stale in
      select * from payments.orders
      where user_id = v_user_id and kind = 'kcoin_topup' and status = 'pending' and checkout_started_at is null
      for update
    loop
      update payments.orders
      set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_stale.id
      returning * into v_stale;
      if exists (select 1 from operations.operations where id = v_stale.operation_id and status in ('pending', 'unknown')) then
        perform operations.fail_command(v_stale.operation_id, 'PAYMENT_CANCELLED', payments.order_json(v_stale));
      else
        update operations.operations set result = payments.order_json(v_stale), updated_at = now()
        where id = v_stale.operation_id;
      end if;
    end loop;
    if exists (select 1 from payments.orders where user_id = v_user_id and kind = 'kcoin_topup' and status in ('processing', 'paid')) then
      perform api.raise_business_error('PAYMENT_ALREADY_PROCESSING', '已有已提交支付的充值订单');
    end if;
    if p_intent is not null and p_intent <> '{}'::jsonb then
      if jsonb_typeof(p_intent) <> 'object' then
        perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '补差意图无效');
      end if;
      if p_intent->>'kind' = 'gacha' then
        v_tier := p_intent->>'tier'; v_count := (p_intent->>'draw_count')::integer;
        select * into v_box from gacha.boxes where tier = v_tier;
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
      elsif p_intent->>'kind' = 'battle_create' then
        select * into v_battle_ruleset
        from battle.rulesets
        where status = 'active';
        if v_battle_ruleset.id is null
           or not battle.rules_complete(v_battle_ruleset.id) then
          perform api.raise_business_error(
            'BATTLE_RULESET_UNAVAILABLE',
            'Battle 规则暂不可用，请稍后重试'
          );
        end if;
        select * into v_battle_tier
        from battle.entry_tiers
        where ruleset_id = v_battle_ruleset.id
          and id = p_intent->>'tier';
        if v_battle_tier.id is null then
          perform api.raise_business_error('BATTLE_TIER_INVALID', 'Battle 入场档位无效');
        end if;
        if exists (
          select 1
          from battle.participants
          where user_id = v_user_id
            and status = 'preparing_share'
        ) then
          perform api.raise_business_error(
            'BATTLE_SHARE_PREPARING',
            '挑战卡正在准备，请勿重复创建'
          );
        elsif exists (
          select 1
          from battle.participants
          where user_id = v_user_id
            and status in ('waiting', 'active')
        ) then
          perform api.raise_business_error(
            'BATTLE_ALREADY_PARTICIPATING',
            '当前已有未结束的 Battle'
          );
        end if;
        perform battle.validate_team_selection(
          v_user_id,
          v_battle_ruleset.id,
          p_intent->'template_ids'
        );
        v_required := v_battle_tier.entry_fee;
        v_normalized_intent := jsonb_build_object(
          'kind', 'battle_create',
          'tier', v_battle_tier.id,
          'template_ids', p_intent->'template_ids'
        );
      elsif p_intent->>'kind' = 'battle_accept' then
        if p_intent->>'room_id' is null
           or p_intent->>'room_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then
          perform api.raise_business_error('BATTLE_INVITE_INVALID', '挑战已失效');
        end if;
        v_battle_room_id := (p_intent->>'room_id')::uuid;
        select * into v_battle_session
        from identity.sessions
        where id = p_session_id
          and user_id = v_user_id
          and entry_kind = 'battle'
          and battle_invite_token_hash is not null
          and revoked_at is null
          and expires_at > now();
        if v_battle_session.id is null then
          perform api.raise_business_error('BATTLE_INVITE_INVALID', '挑战已失效');
        end if;
        select * into v_battle_room
        from battle.rooms
        where id = v_battle_room_id
          and invite_token_hash = v_battle_session.battle_invite_token_hash
        for update;
        if v_battle_room.id is null then
          perform api.raise_business_error('BATTLE_INVITE_INVALID', '挑战已失效');
        end if;
        select * into v_battle_creator
        from identity.users
        where id = v_battle_room.creator_user_id
        for update;
        if v_battle_room.status = 'expired' then
          perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
        elsif v_battle_room.status = 'cancelled' then
          perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
        elsif v_battle_room.status = 'voided' then
          perform api.raise_business_error(
            'BATTLE_VOIDED',
            'Battle 已安全作废，入场费和藏品已恢复'
          );
        elsif v_battle_room.status <> 'waiting' then
          perform api.raise_business_error(
            'BATTLE_ROOM_ALREADY_ACCEPTED',
            '挑战已被其他玩家接受'
          );
        elsif v_battle_room.expires_at <= now() then
          perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
        elsif v_battle_creator.status = 'banned' then
          perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
        elsif v_battle_room.creator_user_id = v_user_id then
          perform api.raise_business_error(
            'BATTLE_SELF_ACCEPT_FORBIDDEN',
            '不能接受自己创建的挑战'
          );
        elsif v_battle_room.creator_offline_since is not null
           or v_battle_room.creator_last_heartbeat_at < now() - make_interval(
             secs => battle.rule_int(
               v_battle_room.ruleset_id,
               'creator_online_window_seconds'
             )
           ) then
          perform api.raise_business_error(
            'BATTLE_CREATOR_OFFLINE',
            '创建者当前不在线'
          );
        end if;
        if exists (
          select 1
          from battle.participants
          where user_id = v_user_id
            and status in ('preparing_share', 'waiting', 'active')
        ) then
          perform api.raise_business_error(
            'BATTLE_ALREADY_PARTICIPATING',
            '当前已有未结束的 Battle'
          );
        end if;
        perform battle.validate_team_selection(
          v_user_id,
          v_battle_room.ruleset_id,
          p_intent->'template_ids'
        );
        select * into v_battle_tier
        from battle.entry_tiers
        where ruleset_id = v_battle_room.ruleset_id
          and id = v_battle_room.entry_tier_id;
        if v_battle_tier.id is null then
          perform api.raise_business_error(
            'BATTLE_RULESET_UNAVAILABLE',
            'Battle 规则暂不可用，请稍后重试'
          );
        end if;
        v_required := v_battle_tier.entry_fee;
        v_normalized_intent := jsonb_build_object(
          'kind', 'battle_accept',
          'room_id', v_battle_room.id,
          'template_ids', p_intent->'template_ids',
          'battle_invite_token_hash',
          v_battle_session.battle_invite_token_hash
        );
      else
        perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '补差意图无效');
      end if;
      select available into v_balance
      from economy.balances
      where user_id = v_user_id and currency = 'KCOIN'
      for update;
      v_required := greatest(v_required - coalesce(v_balance, 0), 0);
      if v_required = 0 then perform api.raise_business_error('TOPUP_NOT_REQUIRED', '当前余额无需补差'); end if;
    end if;
    if p_mode = 'fixed' then
      if p_amount is null or not exists (select 1 from payments.topup_products where amount = p_amount) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '充值档位无效'); end if;
      if p_intent is not null and p_intent <> '{}'::jsonb and p_amount < v_required then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '充值档位不足以覆盖最新差额'); end if;
      v_required := p_amount;
    elsif p_mode = 'exact_gap' then
      if p_intent is null or p_intent = '{}'::jsonb then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '补差意图无效'); end if;
    else
      perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '充值模式无效');
    end if;
    insert into payments.orders (user_id, operation_id, kind, stars_amount, kcoin_amount, invoice_payload, intent, expires_at)
    values (v_user_id, p_operation_id, 'kcoin_topup', v_required, v_required, 'pokepets:' || extensions.gen_random_uuid(), v_normalized_intent, now() + interval '15 minutes')
    returning * into v_order;
    v_result := payments.order_json(v_order);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function payments.vip_stars_price()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 199
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
    perform pg_advisory_xact_lock(hashtextextended('pokepets:payment:' || v_user_id::text || ':vip', 0));
    v_status := vip.status_json(v_user_id);
    if not coalesce((v_status->>'can_purchase')::boolean, false) and not coalesce((v_status->>'can_renew')::boolean, false) then perform api.raise_business_error('VIP_RENEWAL_LIMIT', '月卡续费次数已达上限'); end if;
    if exists (select 1 from payments.orders where user_id = v_user_id and kind = 'vip' and status in ('pending', 'processing', 'paid')) then perform api.raise_business_error('PAYMENT_ALREADY_PENDING', '已有待处理月卡订单'); end if;
    insert into payments.orders (user_id, operation_id, kind, stars_amount, invoice_payload, expires_at)
    values (v_user_id, p_operation_id, 'vip', payments.vip_stars_price(), 'pokepets:' || extensions.gen_random_uuid(), now() + interval '15 minutes') returning * into v_order;
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
  return operations.complete_command(v_order.operation_id, v_result);
end;
$$;

create or replace function api.payment_fail_invoice_creation(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_order payments.orders%rowtype;
begin
  select * into v_order from payments.orders where id = p_order_id for update;
  if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
  if v_order.status = 'pending' and v_order.invoice_url is null then
    update payments.orders set status = 'failed', failed_at = now(), updated_at = now()
    where id = v_order.id returning * into v_order;
    return operations.fail_command(v_order.operation_id, 'TELEGRAM_API_FAILED', payments.order_json(v_order));
  end if;
  return (select operations.operation_json(o) from operations.operations o where o.id = v_order.operation_id);
end;
$$;

create or replace function api.topup_cancel_order(p_session_id uuid, p_operation_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_order payments.orders%rowtype;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'topup.cancel_order', p_operation_id, jsonb_build_object('order_id', p_order_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('pokepets:payment:' || v_user_id::text || ':kcoin_topup', 0));
    select * into v_order from payments.orders
    where id = p_order_id and user_id = v_user_id and kind = 'kcoin_topup'
    for update;
    if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
    if v_order.status = 'pending' and v_order.checkout_started_at is null then
      update payments.orders set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_order.id returning * into v_order;
    elsif v_order.status in ('processing', 'paid') then
      perform api.raise_business_error('PAYMENT_ALREADY_PROCESSING', '支付已经提交，当前不能取消');
    end if;
    update operations.operations set result = payments.order_json(v_order), updated_at = now()
    where id = v_order.operation_id;
    return operations.complete_command(p_operation_id, payments.order_json(v_order));
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.topup_fail_order(p_session_id uuid, p_operation_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_order payments.orders%rowtype;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'topup.fail_order', p_operation_id, jsonb_build_object('order_id', p_order_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('pokepets:payment:' || v_user_id::text || ':kcoin_topup', 0));
    select * into v_order from payments.orders
    where id = p_order_id and user_id = v_user_id and kind = 'kcoin_topup'
    for update;
    if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
    if v_order.status in ('pending', 'processing') and v_order.telegram_payment_charge_id is null then
      update payments.orders set status = 'failed', failed_at = now(), updated_at = now()
      where id = v_order.id returning * into v_order;
    end if;
    update operations.operations set result = payments.order_json(v_order), updated_at = now()
    where id = v_order.operation_id;
    return operations.complete_command(p_operation_id, payments.order_json(v_order));
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
