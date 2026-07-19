create or replace function api.inventory_decompose(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text,
  p_quantity bigint
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
  v_template catalog.templates%rowtype;
  v_reward bigint;
  v_remaining bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'inventory.decompose', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    if p_quantity <= 0 or inventory.available_quantity(v_user_id, p_template_id) < p_quantity then
      perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足');
    end if;
    perform inventory.change_holding(v_user_id, p_template_id, -p_quantity);
    v_reward := v_template.decompose_fgems * p_quantity;
    perform economy.change_balance(v_user_id, 'FGEMS', v_reward, 'decompose', p_operation_id, p_template_id);
    perform tasks.progress(v_user_id, 'decompose');
    select quantity into v_remaining from inventory.holdings where user_id = v_user_id and template_id = p_template_id;
    v_result := jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity, 'fgems_earned', v_reward, 'remaining', coalesce(v_remaining, 0), 'assets', economy.assets(v_user_id));
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
