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
      from catalog.boxes b
    ), '[]'::jsonb),
    'pity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tier', b.tier,
        'progress', coalesce(p.progress, 0),
        'limit', b.pity_limit,
        'target_rarity', b.pity_rarity
      ) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end)
      from catalog.boxes b
      left join gacha.pity p on p.user_id = v_user_id and p.tier = b.tier
    ), '[]'::jsonb),
    'entitlements', jsonb_build_object(
      'free_normal_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_normal_box' and status = 'unused'),
      'free_rare_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused')
    )
  );
end;
$$;
