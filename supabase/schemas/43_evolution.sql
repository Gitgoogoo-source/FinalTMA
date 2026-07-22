create table evolution.pity (
  user_id uuid not null references identity.users(id) on delete cascade,
  from_template_id text not null references catalog.templates(id),
  failures smallint not null default 0 check (failures >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, from_template_id)
);

create or replace function evolution.template_json(p_template catalog.templates)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'template_id', (p_template).id,
    'name', (p_template).name,
    'rarity', (p_template).rarity,
    'stage', (p_template).stage,
    'image_thumbnail_path', (p_template).image_thumbnail_path,
    'image_detail_path', (p_template).image_detail_path
  )
$$;

create or replace function evolution.rule(p_rarity text)
returns table (success_rate_percent integer, fgems_cost bigint, guarantee_attempt integer)
language sql
immutable
set search_path = ''
as $$
  select
    case p_rarity when 'rare' then 95 when 'epic' then 60 when 'legendary' then 35 when 'mythic' then 20 end,
    (case p_rarity when 'rare' then 30 when 'epic' then 120 when 'legendary' then 500 when 'mythic' then 2000 end)::bigint,
    case p_rarity when 'rare' then 2 when 'epic' then 3 when 'legendary' then 5 when 'mythic' then 8 end
  where p_rarity in ('rare', 'epic', 'legendary', 'mythic')
$$;

create or replace function api.inventory_evolution_preview(
  p_session_id uuid,
  p_template_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_source catalog.templates%rowtype;
  v_target catalog.templates%rowtype;
  v_available bigint;
  v_fgems bigint;
  v_rate integer;
  v_cost bigint;
  v_guarantee integer;
  v_failures integer := 0;
  v_reason text;
begin
  select t.* into v_source
  from catalog.templates t
  join inventory.holdings h on h.template_id = t.id
  where t.id = p_template_id and h.user_id = v_user_id and h.quantity > 0;
  if v_source.id is null then
    perform api.raise_business_error('INVENTORY_ITEM_NOT_FOUND', '藏品不存在');
  end if;

  v_available := inventory.available_quantity(v_user_id, v_source.id);
  select coalesce(b.available, 0) into v_fgems
  from economy.balances b
  where b.user_id = v_user_id and b.currency = 'FGEMS';
  v_fgems := coalesce(v_fgems, 0);

  if v_source.stage >= 3 then
    v_reason := 'final_stage';
  else
    select * into v_target
    from catalog.templates
    where chain_id = v_source.chain_id and stage = v_source.stage + 1;
    if v_target.id is null then
      v_reason := 'target_unavailable';
    else
      select * into v_rate, v_cost, v_guarantee from evolution.rule(v_target.rarity);
      select coalesce(p.failures, 0) into v_failures
      from evolution.pity p
      where p.user_id = v_user_id and p.from_template_id = v_source.id;
      v_failures := coalesce(v_failures, 0);
      if v_rate is null then
        v_reason := 'target_unavailable';
      elsif v_available < 3 then
        v_reason := 'insufficient_materials';
      elsif v_fgems < v_cost then
        v_reason := 'insufficient_fgems';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'source', evolution.template_json(v_source),
    'target', case when v_target.id is null then null else evolution.template_json(v_target) end,
    'materials', jsonb_build_object(
      'required', 3,
      'available', v_available,
      'failure_consumed', 2,
      'failure_retained', 1
    ),
    'success_rate_percent', v_rate,
    'fgems', jsonb_build_object('cost', v_cost, 'available', v_fgems),
    'pity', case when v_guarantee is null then null else jsonb_build_object(
      'failure_count', v_failures,
      'guarantee_attempt', v_guarantee,
      'failures_until_guaranteed', greatest(v_guarantee - v_failures - 1, 0),
      'guaranteed_this_attempt', v_failures + 1 >= v_guarantee
    ) end,
    'eligibility', jsonb_build_object('eligible', v_reason is null, 'reason', v_reason)
  );
end;
$$;

create or replace function api.inventory_evolution_recoverable_results(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at)
      from operations.operations o
      where o.user_id = v_user_id
        and o.use_case = 'inventory.evolve'
        and o.result_acknowledged_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.inventory_evolution_acknowledge_result(
  p_session_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_operation operations.operations%rowtype;
begin
  select * into v_operation
  from operations.operations o
  where o.id = p_operation_id
    and o.user_id = v_user_id
    and o.use_case = 'inventory.evolve'
  for update;
  if v_operation.id is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '进化操作记录不存在');
  end if;
  if v_operation.status not in ('succeeded', 'failed') then
    perform api.raise_business_error('OPERATION_NOT_ACKNOWLEDGEABLE', '进化结果尚未确定');
  end if;
  if v_operation.result_acknowledged_at is null then
    update operations.operations
    set result_acknowledged_at = now(), updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  end if;
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'acknowledged_at', v_operation.result_acknowledged_at
  );
end;
$$;

create or replace function api.inventory_evolve(
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
  v_source catalog.templates%rowtype;
  v_target catalog.templates%rowtype;
  v_rate integer;
  v_cost bigint;
  v_guarantee integer;
  v_previous_failures integer;
  v_current_failures integer;
  v_available bigint;
  v_fgems bigint;
  v_fgems_required bigint;
  v_attempts bigint;
  v_attempt bigint := 0;
  v_successes bigint := 0;
  v_failures bigint := 0;
  v_guaranteed_attempts bigint := 0;
  v_materials_consumed bigint;
  v_guaranteed boolean;
  v_success boolean;
  v_new_album boolean := false;
  v_result jsonb;
  v_error_code text;
begin
  v_operation := operations.begin_command(p_session_id, 'inventory.evolve', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_quantity <= 0 or p_quantity % 3 <> 0 then
      perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '进化材料数量必须是 3 的正整数倍');
    end if;
    v_attempts := p_quantity / 3;
    select * into v_source from catalog.templates where id = p_template_id;
    if v_source.id is null or v_source.stage >= 3 then perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '当前藏品不能进化'); end if;
    select * into v_target from catalog.templates where chain_id = v_source.chain_id and stage = v_source.stage + 1;
    if v_target.id is null then perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '当前藏品不能进化'); end if;
    select * into v_rate, v_cost, v_guarantee from evolution.rule(v_target.rarity);
    if v_rate is null then perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '当前藏品不能进化'); end if;
    perform 1
    from inventory.holdings
    where user_id = v_user_id and template_id = v_source.id
    for update;
    v_available := inventory.available_quantity(v_user_id, v_source.id);
    if v_available < p_quantity then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用进化材料数量不足'); end if;
    select coalesce(b.available, 0) into v_fgems
    from economy.balances b
    where b.user_id = v_user_id and b.currency = 'FGEMS';
    v_fgems := coalesce(v_fgems, 0);
    v_fgems_required := v_cost * v_attempts;
    if v_fgems < v_fgems_required then perform api.raise_business_error('INSUFFICIENT_BALANCE', 'Fgems 不足'); end if;
    insert into evolution.pity (user_id, from_template_id) values (v_user_id, v_source.id) on conflict do nothing;
    select failures into v_previous_failures from evolution.pity where user_id = v_user_id and from_template_id = v_source.id for update;
    v_current_failures := v_previous_failures;
    perform economy.change_balance(v_user_id, 'FGEMS', -v_fgems_required, 'evolution', p_operation_id, v_source.id);
    while v_attempt < v_attempts loop
      v_attempt := v_attempt + 1;
      v_guaranteed := v_current_failures + 1 >= v_guarantee;
      v_success := v_guaranteed or identity.random_basis_points() < v_rate * 100;
      if v_success then
        v_successes := v_successes + 1;
        if v_guaranteed then v_guaranteed_attempts := v_guaranteed_attempts + 1; end if;
        v_current_failures := 0;
      else
        v_failures := v_failures + 1;
        v_current_failures := v_current_failures + 1;
      end if;
    end loop;
    v_materials_consumed := v_successes * 3 + v_failures * 2;
    perform inventory.change_holding(v_user_id, v_source.id, -v_materials_consumed);
    if v_successes > 0 then
      perform inventory.change_holding(v_user_id, v_target.id, v_successes);
      v_new_album := album.unlock_template(v_user_id, v_target.id, p_operation_id);
      perform tasks.progress(v_user_id, 'evolution_success', v_successes);
    end if;
    update evolution.pity set failures = v_current_failures, updated_at = now() where user_id = v_user_id and from_template_id = v_source.id;
    perform tasks.progress(v_user_id, 'evolution_attempt', v_attempts);
    v_result := jsonb_build_object(
      'attempt_count', v_attempts,
      'success_count', v_successes,
      'failure_count', v_failures,
      'source', evolution.template_json(v_source),
      'target', evolution.template_json(v_target),
      'materials', jsonb_build_object(
        'selected', p_quantity,
        'consumed', v_materials_consumed,
        'retained', v_failures
      ),
      'success_rate_percent', v_rate,
      'fgems_cost_per_attempt', v_cost,
      'fgems_spent', v_fgems_required,
      'pity', jsonb_build_object(
        'previous_failure_count', v_previous_failures,
        'current_failure_count', v_current_failures,
        'guarantee_attempt', v_guarantee,
        'failures_until_guaranteed', greatest(v_guarantee - v_current_failures - 1, 0),
        'guaranteed_attempts', v_guaranteed_attempts
      ),
      'target_awarded', v_successes,
      'new_album', v_new_album,
      'assets', economy.assets(v_user_id)
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    v_error_code := case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end;
    return operations.fail_command(p_operation_id, v_error_code, jsonb_build_object(
      'outcome', 'rejected',
      'source_template_id', coalesce(v_source.id, p_template_id),
      'target_template_id', v_target.id,
      'available_quantity', v_available,
      'fgems_available', v_fgems,
      'fgems_cost', v_cost,
      'error_code', v_error_code
    ));
  end;
end;
$$;
