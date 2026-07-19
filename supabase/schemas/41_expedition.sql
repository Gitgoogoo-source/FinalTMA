create table expedition.expeditions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  operation_id uuid not null unique references operations.operations(id),
  tier text not null check (tier in ('normal', 'intermediate', 'advanced')),
  status text not null default 'running' check (status in ('running', 'claimable', 'claimed')),
  reward_fgems bigint not null check (reward_fgems > 0),
  started_at timestamptz not null default now(),
  completes_at timestamptz not null,
  claimed_at timestamptz,
  check (completes_at > started_at)
);

create unique index expeditions_user_tier_active_idx on expedition.expeditions (user_id, tier) where status in ('running', 'claimable');
create index expeditions_due_idx on expedition.expeditions (completes_at) where status = 'running';

create table expedition.items (
  expedition_id uuid not null references expedition.expeditions(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  primary key (expedition_id, template_id)
);

create index expedition_items_template_idx on expedition.items (template_id, expedition_id);

create or replace function api.expedition_list(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'rules', jsonb_build_array(
      jsonb_build_object('tier', 'normal', 'duration_minutes', 30, 'daily_limit', 2, 'allowed_rarities', jsonb_build_array('common', 'rare', 'epic')),
      jsonb_build_object('tier', 'intermediate', 'duration_minutes', 60, 'daily_limit', 1, 'allowed_rarities', jsonb_build_array('rare', 'epic', 'legendary')),
      jsonb_build_object('tier', 'advanced', 'duration_minutes', 180, 'daily_limit', 1, 'allowed_rarities', jsonb_build_array('epic', 'legendary', 'mythic'))
    ),
    'active', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'tier', e.tier,
        'status', case when e.status = 'running' and e.completes_at <= now() then 'claimable' else e.status end,
        'reward_fgems', e.reward_fgems,
        'started_at', e.started_at,
        'completes_at', e.completes_at,
        'claimed_at', e.claimed_at
      ) order by e.started_at)
      from expedition.expeditions e
      where e.user_id = v_user_id and e.status in ('running', 'claimable')
    ), '[]'::jsonb),
    'used_today', jsonb_build_object(
      'normal', (select count(*) from expedition.expeditions where user_id = v_user_id and tier = 'normal' and (started_at at time zone 'utc')::date = identity.utc_day()),
      'intermediate', (select count(*) from expedition.expeditions where user_id = v_user_id and tier = 'intermediate' and (started_at at time zone 'utc')::date = identity.utc_day()),
      'advanced', (select count(*) from expedition.expeditions where user_id = v_user_id and tier = 'advanced' and (started_at at time zone 'utc')::date = identity.utc_day())
    ),
    'server_time', now()
  );
end;
$$;

create or replace function api.expedition_eligible_items(p_session_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  if p_tier not in ('normal', 'intermediate', 'advanced') then
    perform api.raise_business_error('EXPEDITION_TIER_INVALID', '远征档次无效');
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(inventory.item_json(v_user_id, t.id) || jsonb_build_object('unit_reward_fgems', t.expedition_fgems) order by t.sort_order)
    from inventory.holdings h
    join catalog.templates t on t.id = h.template_id
    where h.user_id = v_user_id and inventory.available_quantity(v_user_id, t.id) > 0
      and ((p_tier = 'normal' and catalog.rarity_rank(t.rarity) between 1 and 3)
        or (p_tier = 'intermediate' and catalog.rarity_rank(t.rarity) between 2 and 4)
        or (p_tier = 'advanced' and catalog.rarity_rank(t.rarity) between 3 and 5))
  ), '[]'::jsonb));
end;
$$;

create or replace function api.expedition_create(
  p_session_id uuid,
  p_operation_id uuid,
  p_tier text,
  p_items jsonb
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
  v_expedition expedition.expeditions%rowtype;
  v_template catalog.templates%rowtype;
  v_item record;
  v_units bigint;
  v_reward bigint := 0;
  v_limit integer;
  v_duration interval;
  v_used integer;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'expedition.create', p_operation_id, jsonb_build_object('tier', p_tier, 'items', p_items));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select case p_tier when 'normal' then 2 when 'intermediate' then 1 when 'advanced' then 1 end,
           case p_tier when 'normal' then interval '30 minutes' when 'intermediate' then interval '1 hour' when 'advanced' then interval '3 hours' end
    into v_limit, v_duration;
    if v_limit is null then perform api.raise_business_error('EXPEDITION_TIER_INVALID', '远征档次无效'); end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_tier || ':' || identity.utc_day()::text, 0));
    select count(*) into v_used from expedition.expeditions where user_id = v_user_id and tier = p_tier and (started_at at time zone 'utc')::date = identity.utc_day();
    if v_used >= v_limit then perform api.raise_business_error('EXPEDITION_LIMIT_REACHED', '今日远征次数已用完'); end if;
    if exists (select 1 from expedition.expeditions where user_id = v_user_id and tier = p_tier and status in ('running', 'claimable')) then
      perform api.raise_business_error('EXPEDITION_ALREADY_ACTIVE', '同档远征尚未领取');
    end if;
    select coalesce(sum((item->>'quantity')::bigint), 0) into v_units from jsonb_array_elements(p_items) item;
    if v_units <> 3 then perform api.raise_business_error('EXPEDITION_ITEMS_INVALID', '每次必须派遣三个藏品单位'); end if;

    for v_item in
      select item->>'template_id' template_id, sum((item->>'quantity')::bigint) quantity
      from jsonb_array_elements(p_items) item group by item->>'template_id' order by item->>'template_id'
    loop
      select * into v_template from catalog.templates where id = v_item.template_id;
      if v_template.id is null
        or (p_tier = 'normal' and catalog.rarity_rank(v_template.rarity) not between 1 and 3)
        or (p_tier = 'intermediate' and catalog.rarity_rank(v_template.rarity) not between 2 and 4)
        or (p_tier = 'advanced' and catalog.rarity_rank(v_template.rarity) not between 3 and 5) then
        perform api.raise_business_error('EXPEDITION_ITEMS_INVALID', '藏品不符合远征要求');
      end if;
      v_reward := v_reward + v_template.expedition_fgems * v_item.quantity;
    end loop;

    insert into expedition.expeditions (user_id, operation_id, tier, reward_fgems, completes_at)
    values (v_user_id, p_operation_id, p_tier, v_reward, now() + v_duration) returning * into v_expedition;
    for v_item in
      select item->>'template_id' template_id, sum((item->>'quantity')::bigint) quantity
      from jsonb_array_elements(p_items) item group by item->>'template_id' order by item->>'template_id'
    loop
      insert into expedition.items (expedition_id, template_id, quantity) values (v_expedition.id, v_item.template_id, v_item.quantity);
      perform inventory.reserve(v_user_id, v_item.template_id, v_item.quantity::bigint, 'expedition', v_expedition.id);
    end loop;
    v_result := jsonb_build_object(
      'expedition', jsonb_build_object('id', v_expedition.id, 'tier', v_expedition.tier, 'status', 'running', 'reward_fgems', v_expedition.reward_fgems, 'started_at', v_expedition.started_at, 'completes_at', v_expedition.completes_at, 'claimed_at', null),
      'items', p_items, 'total_units', 3
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.expedition_claim(
  p_session_id uuid,
  p_operation_id uuid,
  p_expedition_id uuid
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
  v_expedition expedition.expeditions%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'expedition.claim', p_operation_id, jsonb_build_object('expedition_id', p_expedition_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_expedition from expedition.expeditions where id = p_expedition_id and user_id = v_user_id for update;
    if v_expedition.id is null then perform api.raise_business_error('EXPEDITION_NOT_FOUND', '远征不存在'); end if;
    if v_expedition.status = 'claimed' or v_expedition.completes_at > now() then perform api.raise_business_error('EXPEDITION_NOT_READY', '远征尚不可领取'); end if;
    update expedition.expeditions set status = 'claimed', claimed_at = now() where id = p_expedition_id returning * into v_expedition;
    update inventory.reservations set status = 'released', released_at = now() where kind = 'expedition' and reference_id = p_expedition_id and status = 'active';
    perform economy.change_balance(v_user_id, 'FGEMS', v_expedition.reward_fgems, 'expedition', p_operation_id, p_expedition_id::text);
    perform tasks.progress(v_user_id, 'expedition_' || v_expedition.tier);
    v_result := jsonb_build_object('expedition_id', p_expedition_id, 'reward_fgems', v_expedition.reward_fgems, 'status', 'claimed', 'claimed_at', v_expedition.claimed_at);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
