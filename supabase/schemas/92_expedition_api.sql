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
