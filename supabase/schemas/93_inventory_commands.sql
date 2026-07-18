create or replace function api.inventory_evolve(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text
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
  v_source catalog.templates%rowtype;
  v_target catalog.templates%rowtype;
  v_rate integer;
  v_cost bigint;
  v_guarantee integer;
  v_failures integer;
  v_success boolean;
  v_new_album boolean := false;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'inventory.evolve', p_operation_id, jsonb_build_object('template_id', p_template_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_source from catalog.templates where id = p_template_id;
    if v_source.id is null or v_source.stage >= 3 then perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '当前藏品不能进化'); end if;
    select * into v_target from catalog.templates where chain_id = v_source.chain_id and stage = v_source.stage + 1;
    if inventory.available_quantity(v_user_id, v_source.id) < 3 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '需要三个可用材料'); end if;
    select case v_target.rarity when 'rare' then 95 when 'epic' then 60 when 'legendary' then 35 else 20 end,
           case v_target.rarity when 'rare' then 30 when 'epic' then 120 when 'legendary' then 500 else 2000 end,
           case v_target.rarity when 'rare' then 2 when 'epic' then 3 when 'legendary' then 5 else 8 end
    into v_rate, v_cost, v_guarantee;
    insert into gacha.evolution_pity (user_id, from_template_id) values (v_user_id, v_source.id) on conflict do nothing;
    select failures into v_failures from gacha.evolution_pity where user_id = v_user_id and from_template_id = v_source.id for update;
    perform economy.change_balance(v_user_id, 'FGEMS', -v_cost, 'evolution', p_operation_id, v_source.id);
    v_success := v_failures + 1 >= v_guarantee or identity.random_basis_points() < v_rate * 100;
    if v_success then
      perform inventory.change_holding(v_user_id, v_source.id, -3);
      perform inventory.change_holding(v_user_id, v_target.id, 1);
      v_new_album := album.unlock_template(v_user_id, v_target.id, p_operation_id);
      update gacha.evolution_pity set failures = 0, updated_at = now() where user_id = v_user_id and from_template_id = v_source.id;
      perform tasks.progress(v_user_id, 'evolution_success');
      if v_new_album then perform tasks.progress(v_user_id, 'album_unlock'); end if;
    else
      perform inventory.change_holding(v_user_id, v_source.id, -2);
      update gacha.evolution_pity set failures = failures + 1, updated_at = now() where user_id = v_user_id and from_template_id = v_source.id;
    end if;
    perform tasks.progress(v_user_id, 'evolution_attempt');
    v_result := jsonb_build_object(
      'success', v_success, 'source_template_id', v_source.id, 'target_template_id', v_target.id,
      'target_name', v_target.name, 'target_rarity', v_target.rarity, 'fgems_spent', v_cost,
      'failure_count', case when v_success then 0 else v_failures + 1 end,
      'new_album', v_new_album, 'assets', economy.assets(v_user_id)
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

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
