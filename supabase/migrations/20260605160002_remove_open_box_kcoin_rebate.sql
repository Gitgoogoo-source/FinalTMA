-- Remove the post-open KCOIN rebate as a live feature while keeping historical
-- order snapshots and ledger rows available for audit/reconciliation.

begin;

alter table gacha.blind_boxes
  alter column open_reward_kcoin set default 0;

alter table gacha.draw_orders
  alter column open_reward_kcoin set default 0;

update gacha.blind_boxes
set open_reward_kcoin = 0,
    updated_at = now()
where open_reward_kcoin <> 0;

update gacha.draw_orders
set open_reward_kcoin = 0,
    updated_at = now()
where status not in ('opened', 'completed')
  and open_reward_kcoin <> 0;

create or replace function gacha.force_zero_open_reward_kcoin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.open_reward_kcoin := 0;
  return new;
end;
$$;

revoke execute on function gacha.force_zero_open_reward_kcoin()
  from public, anon, authenticated;

drop trigger if exists force_zero_open_reward_kcoin_on_blind_boxes
  on gacha.blind_boxes;

create trigger force_zero_open_reward_kcoin_on_blind_boxes
before insert or update of open_reward_kcoin on gacha.blind_boxes
for each row
execute function gacha.force_zero_open_reward_kcoin();

drop trigger if exists force_zero_open_reward_kcoin_on_draw_orders
  on gacha.draw_orders;

create trigger force_zero_open_reward_kcoin_on_draw_orders
before insert or update of open_reward_kcoin on gacha.draw_orders
for each row
execute function gacha.force_zero_open_reward_kcoin();

do $$
declare
  v_function_def text;
  v_updated_function_def text;
  v_rebate_block text := $old$
  v_reward_kcoin := v_box.open_reward_kcoin * p_quantity;
  if v_reward_kcoin > 0 then
    v_credit := api._credit_balance(
      p_user_id,
      'KCOIN',
      v_reward_kcoin,
      'open_box_rebate',
      v_draw_order_id,
      null,
      'open_box_rebate:' || v_draw_order_id::text,
      'Open box rebate',
      jsonb_build_object('draw_order_id', v_draw_order_id, 'draw_count', p_quantity, 'quantity', p_quantity)
    );
  end if;
$old$;
  v_commission_block text := $old$
  if v_reward_kcoin > 0
     and not coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
    v_referral_commission := api.referral_create_commission(
      p_user_id,
      v_draw_order_id,
      v_reward_kcoin,
      v_referral_commission_bps
    );
  elsif coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
$old$;
begin
  select pg_get_functiondef(
    'api.gacha_open_with_kcoin_from_server_price(uuid,text,integer,text,integer,integer)'::regprocedure
  )
  into v_function_def;

  v_updated_function_def := replace(
    v_function_def,
    v_rebate_block,
    E'\n  v_reward_kcoin := 0;\n  v_credit := null;\n'
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    v_commission_block,
    $new$
  if not coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
    v_referral_commission := api.referral_create_commission(
      p_user_id,
      v_draw_order_id,
      v_total_price,
      v_referral_commission_bps
    );
  elsif coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
$new$
  );

  if v_updated_function_def = v_function_def
     or position('open_box_rebate' in v_updated_function_def) > 0 then
    raise exception 'failed to remove open_box_rebate from api.gacha_open_with_kcoin_from_server_price';
  end if;

  if position(E'v_draw_order_id,\n      v_reward_kcoin,' in v_updated_function_def) > 0
     or position(E'v_draw_order_id,\n      v_total_price,' in v_updated_function_def) = 0 then
    raise exception 'failed to keep referral commission based on paid KCOIN amount';
  end if;

  execute v_updated_function_def;
end;
$$;

do $$
declare
  v_function_def text;
  v_updated_function_def text;
  v_rebate_block text := $old$
    v_reward_kcoin := v_order.open_reward_kcoin * v_order.draw_count;
    if v_reward_kcoin > 0 then
      v_credit := api._credit_balance(
        v_order.user_id,
        'KCOIN',
        v_reward_kcoin,
        'open_box_rebate',
        v_order.id,
        null,
        'open_box_rebate:' || v_order.id::text,
        'Open box rebate',
        jsonb_build_object('draw_order_id', v_order.id, 'draw_count', v_order.draw_count, 'quantity', v_order.quantity)
      );
    end if;
$old$;
  v_commission_block text := $old$
    if v_reward_kcoin > 0
       and not coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
      v_referral_commission := api.referral_create_commission(
        v_order.user_id,
        v_order.id,
        v_reward_kcoin,
        v_referral_commission_bps
      );
    elsif coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
$old$;
begin
  select pg_get_functiondef(
    'api.gacha_process_paid_order_without_task_progress(uuid,text,text,jsonb)'::regprocedure
  )
  into v_function_def;

  v_updated_function_def := replace(
    v_function_def,
    v_rebate_block,
    E'\n    v_reward_kcoin := 0;\n    v_credit := null;\n'
  );

  v_updated_function_def := replace(
    v_updated_function_def,
    v_commission_block,
    $new$
    if not coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
      v_referral_commission := api.referral_create_commission(
        v_order.user_id,
        v_order.id,
        v_order.total_price_stars,
        v_referral_commission_bps
      );
    elsif coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
$new$
  );

  if v_updated_function_def = v_function_def
     or position('open_box_rebate' in v_updated_function_def) > 0 then
    raise exception 'failed to remove open_box_rebate from api.gacha_process_paid_order_without_task_progress';
  end if;

  if position(E'v_order.id,\n        v_reward_kcoin,' in v_updated_function_def) > 0
     or position(E'v_order.id,\n        v_order.total_price_stars,' in v_updated_function_def) = 0 then
    raise exception 'failed to keep referral commission based on paid order amount';
  end if;

  execute v_updated_function_def;
end;
$$;

comment on column gacha.blind_boxes.open_reward_kcoin is
  'Deprecated. Open-box KCOIN rebate is disabled; kept only for historical compatibility.';

comment on column gacha.draw_orders.open_reward_kcoin is
  'Deprecated historical snapshot. New draw orders always store 0 because open-box KCOIN rebate is disabled.';

commit;
