create table gacha.boxes (
  tier text primary key check (tier in ('normal', 'rare', 'legendary')),
  display_name text not null,
  image_path text not null unique,
  single_price bigint not null check (single_price > 0),
  ten_price bigint not null check (ten_price = single_price * 9),
  pity_limit smallint not null check (pity_limit > 0),
  pity_rarity text not null check (pity_rarity in ('rare', 'epic', 'legendary')),
  rarity_weights jsonb not null
);

create table gacha.pity (
  user_id uuid not null references identity.users(id) on delete cascade,
  tier text not null references gacha.boxes(tier),
  progress smallint not null default 0 check (progress >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tier)
);

create or replace function gacha.rules_complete()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    (select count(*) = 1 from catalog.versions where id = 'v1')
    and (select
      count(*) = 70
      and count(*) filter (where chain_type = 'normal') = 40
      and count(*) filter (where chain_type = 'advanced') = 20
      and count(*) filter (where chain_type = 'top') = 10
      from catalog.chains where catalog_version = 'v1'
    )
    and (select
      count(*) = 210
      and count(*) filter (where rarity = 'common') = 40
      and count(*) filter (where rarity = 'rare') = 60
      and count(*) filter (where rarity = 'epic') = 70
      and count(*) filter (where rarity = 'legendary') = 30
      and count(*) filter (where rarity = 'mythic') = 10
      from catalog.templates where catalog_version = 'v1'
    )
    and not exists (
      select 1
      from catalog.chains c
      left join catalog.templates t on t.chain_id = c.id
      group by c.id
      having count(t.id) <> 3
    )
    and not exists (
      select 1
      from catalog.templates t
      join catalog.chains c on c.id = t.chain_id
      where t.draw_weight <> 1
        or not case c.chain_type
          when 'normal' then (t.stage = 1 and t.rarity = 'common') or (t.stage = 2 and t.rarity = 'rare') or (t.stage = 3 and t.rarity = 'epic')
          when 'advanced' then (t.stage = 1 and t.rarity = 'rare') or (t.stage = 2 and t.rarity = 'epic') or (t.stage = 3 and t.rarity = 'legendary')
          when 'top' then (t.stage = 1 and t.rarity = 'epic') or (t.stage = 2 and t.rarity = 'legendary') or (t.stage = 3 and t.rarity = 'mythic')
          else false
        end
    )
    and (select count(*) = 3 from gacha.boxes)
    and not exists (
      select 1
      from (values
        ('normal'::text, '普通盲盒'::text, '/assets/boxes/normal.webp'::text, 9::bigint, 81::bigint, 50::smallint, 'rare'::text, '{"common":7200,"rare":2500,"epic":300,"legendary":0,"mythic":0}'::jsonb),
        ('rare', '稀有盲盒', '/assets/boxes/rare.webp', 40, 360, 30, 'epic', '{"common":2000,"rare":5500,"epic":2200,"legendary":300,"mythic":0}'::jsonb),
        ('legendary', '传说盲盒', '/assets/boxes/legendary.webp', 120, 1080, 15, 'legendary', '{"common":0,"rare":1800,"epic":5500,"legendary":2400,"mythic":300}'::jsonb)
      ) expected(tier, display_name, image_path, single_price, ten_price, pity_limit, pity_rarity, rarity_weights)
      left join gacha.boxes b on b.tier = expected.tier
      where b.tier is null
        or b.display_name is distinct from expected.display_name
        or b.image_path is distinct from expected.image_path
        or b.single_price is distinct from expected.single_price
        or b.ten_price is distinct from expected.ten_price
        or b.pity_limit is distinct from expected.pity_limit
        or b.pity_rarity is distinct from expected.pity_rarity
        or b.rarity_weights is distinct from expected.rarity_weights
    )
$$;

create or replace function api.gacha_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'boxes', coalesce((
      select jsonb_agg(to_jsonb(b) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end)
      from gacha.boxes b
    ), '[]'::jsonb),
    'pity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tier', b.tier,
        'progress', coalesce(p.progress, 0),
        'limit', b.pity_limit,
        'target_rarity', b.pity_rarity
      ) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end)
      from gacha.boxes b
      left join gacha.pity p on p.user_id = v_user_id and p.tier = b.tier
    ), '[]'::jsonb),
    'entitlements', jsonb_build_object(
      'free_normal_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_normal_box' and status = 'unused'),
      'free_rare_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused')
    ),
    'rules_complete', gacha.rules_complete()
  );
end;
$$;

create or replace function api.gacha_pool(p_session_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_box gacha.boxes%rowtype;
  v_rarities jsonb;
begin
  perform api.session_user(p_session_id);
  select * into v_box from gacha.boxes where tier = p_tier;
  if v_box.tier is null then perform api.raise_business_error('BOX_TIER_INVALID', '盲盒档次无效'); end if;
  if not gacha.rules_complete() then perform api.raise_business_error('CATALOG_INVALID', '奖池加载失败，请重试'); end if;

  with candidates as (
    select
      t.*,
      (v_box.rarity_weights->>t.rarity)::integer as rarity_probability_basis_points,
      sum(t.draw_weight) over (partition by t.rarity) as catalog_total_weight
    from catalog.templates t
    where t.catalog_version = 'v1'
      and (v_box.rarity_weights->>t.rarity)::integer > 0
  ), rarity_groups as (
    select
      c.rarity,
      max(c.rarity_probability_basis_points) as rarity_probability_basis_points,
      max(c.catalog_total_weight) as catalog_total_weight,
      jsonb_agg(jsonb_build_object(
        'template_id', c.id,
        'name', c.name,
        'rarity', c.rarity,
        'stage', c.stage,
        'image_thumbnail_path', c.image_thumbnail_path,
        'catalog_weight', c.draw_weight,
        'single_probability_percent', round(c.rarity_probability_basis_points::numeric * c.draw_weight / (c.catalog_total_weight * 100), 6)
      ) order by c.sort_order) as items
    from candidates c
    group by c.rarity
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'rarity', rarity,
    'rarity_probability_basis_points', rarity_probability_basis_points,
    'rarity_probability_percent', round(rarity_probability_basis_points::numeric / 100, 2),
    'catalog_total_weight', catalog_total_weight,
    'items', items
  ) order by catalog.rarity_rank(rarity)), '[]'::jsonb)
  into v_rarities
  from rarity_groups;

  return jsonb_build_object(
    'tier', v_box.tier,
    'display_name', v_box.display_name,
    'catalog_version', 'v1',
    'pity', jsonb_build_object('limit', v_box.pity_limit, 'target_rarity', v_box.pity_rarity),
    'rarities', v_rarities
  );
end;
$$;

create or replace function api.gacha_recoverable_results(p_session_id uuid)
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
        and o.use_case = 'gacha.open'
        and o.result_acknowledged_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.gacha_acknowledge_result(
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
    and o.use_case = 'gacha.open'
  for update;
  if v_operation.id is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '开盒操作记录不存在');
  end if;
  if v_operation.status not in ('succeeded', 'failed') then
    perform api.raise_business_error('OPERATION_NOT_ACKNOWLEDGEABLE', '开盒结果尚未确定');
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

create or replace function api.gacha_open(
  p_session_id uuid,
  p_operation_id uuid,
  p_tier text,
  p_draw_count integer
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
  v_box gacha.boxes%rowtype;
  v_template catalog.templates%rowtype;
  v_entitlement_id uuid;
  v_entitlement_kind text;
  v_price bigint := 0;
  v_progress integer := 0;
  v_random integer;
  v_rarity text;
  v_results jsonb := '[]'::jsonb;
  v_new_album boolean;
  v_triggered boolean;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(
    p_session_id, 'gacha.open', p_operation_id,
    jsonb_build_object('tier', p_tier, 'draw_count', p_draw_count)
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;

  begin
    if p_draw_count not in (1, 10) then
      perform api.raise_business_error('DRAW_COUNT_INVALID', '开盒次数无效');
    end if;
    lock table catalog.versions, catalog.chains, catalog.templates, gacha.boxes in share mode;
    select * into v_box from gacha.boxes where tier = p_tier;
    if v_box.tier is null then perform api.raise_business_error('BOX_TIER_INVALID', '盲盒档次无效'); end if;
    if not gacha.rules_complete() then perform api.raise_business_error('CATALOG_INVALID', '开盒规则加载失败，请重新加载'); end if;

    if p_draw_count = 1 and p_tier in ('normal', 'rare') then
      v_entitlement_kind := case p_tier when 'normal' then 'free_normal_box' else 'free_rare_box' end;
      select id into v_entitlement_id
      from economy.entitlements
      where user_id = v_user_id and kind = v_entitlement_kind and status = 'unused'
      order by obtained_at, id limit 1 for update;
    end if;

    if v_entitlement_id is not null then
      update economy.entitlements set status = 'used', used_at = now() where id = v_entitlement_id;
    else
      v_price := case when p_draw_count = 10 then v_box.ten_price else v_box.single_price end;
      perform economy.change_balance(v_user_id, 'KCOIN', -v_price, 'gacha', p_operation_id, p_tier);
      insert into gacha.pity (user_id, tier) values (v_user_id, p_tier) on conflict do nothing;
      select progress into v_progress from gacha.pity where user_id = v_user_id and tier = p_tier for update;
    end if;

    for v_i in 1..p_draw_count loop
      v_random := identity.random_basis_points();
      if v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) then v_rarity := 'common';
      elsif v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) + coalesce((v_box.rarity_weights->>'rare')::integer, 0) then v_rarity := 'rare';
      elsif v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) + coalesce((v_box.rarity_weights->>'rare')::integer, 0) + coalesce((v_box.rarity_weights->>'epic')::integer, 0) then v_rarity := 'epic';
      elsif v_random < 10000 - coalesce((v_box.rarity_weights->>'mythic')::integer, 0) then v_rarity := 'legendary';
      else v_rarity := 'mythic';
      end if;

      v_triggered := false;
      if v_entitlement_id is null then
        if catalog.rarity_rank(v_rarity) >= catalog.rarity_rank(v_box.pity_rarity) then
          v_progress := 0;
        elsif v_progress + 1 >= v_box.pity_limit then
          v_rarity := v_box.pity_rarity;
          v_progress := 0;
          v_triggered := true;
        else
          v_progress := v_progress + 1;
        end if;
      end if;

      select * into v_template from catalog.templates
      where catalog_version = 'v1' and rarity = v_rarity
      order by extensions.gen_random_uuid() limit 1;
      if v_template.id is null then perform api.raise_business_error('CATALOG_INVALID', '目录缺少抽取候选'); end if;
      perform inventory.change_holding(v_user_id, v_template.id, 1);
      v_new_album := album.unlock_template(v_user_id, v_template.id, p_operation_id);
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order', v_i, 'template_id', v_template.id, 'name', v_template.name,
        'rarity', v_template.rarity, 'stage', v_template.stage, 'quantity', 1,
        'image_thumbnail_path', v_template.image_thumbnail_path,
        'image_detail_path', v_template.image_detail_path,
        'new_album', v_new_album, 'pity_triggered', v_triggered
      ));
    end loop;

    if v_entitlement_id is null then
      update gacha.pity set progress = v_progress, updated_at = now()
      where user_id = v_user_id and tier = p_tier;
    else
      select p.progress into v_progress from gacha.pity p
      where p.user_id = v_user_id and p.tier = p_tier for share;
      v_progress := coalesce(v_progress, 0);
    end if;
    if p_draw_count = 1 then
      perform tasks.progress(v_user_id, 'gacha_1');
      perform tasks.progress(v_user_id, 'gacha_10');
    else
      perform tasks.progress(v_user_id, 'gacha_ten');
    end if;

    v_result := jsonb_build_object(
      'tier', p_tier,
      'draw_count', p_draw_count,
      'paid_kcoin', v_price,
      'entitlement_used', case when v_entitlement_id is null then null else v_entitlement_kind end,
      'results', v_results,
      'pity', jsonb_build_object('tier', p_tier, 'progress', v_progress, 'limit', v_box.pity_limit, 'target_rarity', v_box.pity_rarity),
      'assets', economy.assets(v_user_id)
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
