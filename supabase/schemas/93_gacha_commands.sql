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
  v_box catalog.boxes%rowtype;
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
  v_i integer;
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
    select * into v_box from catalog.boxes where tier = p_tier;
    if v_box.tier is null then perform api.raise_business_error('BOX_TIER_INVALID', '盲盒档次无效'); end if;

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
      where rarity = v_rarity order by extensions.gen_random_uuid() limit 1;
      if v_template.id is null then perform api.raise_business_error('CATALOG_INVALID', '目录缺少抽取候选'); end if;
      perform inventory.change_holding(v_user_id, v_template.id, 1);
      v_new_album := album.unlock_template(v_user_id, v_template.id, p_operation_id);
      if v_new_album then perform tasks.progress(v_user_id, 'album_unlock'); end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order', v_i, 'template_id', v_template.id, 'name', v_template.name,
        'rarity', v_template.rarity, 'image_path', v_template.image_path,
        'new_album', v_new_album
      ));
    end loop;

    if v_entitlement_id is null then
      update gacha.pity set progress = v_progress, updated_at = now()
      where user_id = v_user_id and tier = p_tier;
    end if;
    perform tasks.progress(v_user_id, 'gacha_1', p_draw_count);
    perform tasks.progress(v_user_id, 'gacha_10', p_draw_count);
    if p_draw_count = 10 then perform tasks.progress(v_user_id, 'gacha_ten'); end if;

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
