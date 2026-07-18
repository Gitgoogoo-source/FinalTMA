create or replace function api.album_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'unlocked_count', (select count(*) from album.nodes where user_id = v_user_id),
    'total_count', 210,
    'chains', coalesce((
      select jsonb_agg(jsonb_build_object(
        'chain_id', c.id,
        'chain_type', c.chain_type,
        'theme', c.theme,
        'unlocked', (select count(*) from album.nodes n join catalog.templates t on t.id = n.template_id where n.user_id = v_user_id and t.chain_id = c.id),
        'claimed', exists(select 1 from album.rewards r where r.user_id = v_user_id and r.chain_id = c.id)
      ) order by c.global_order)
      from catalog.chains c
    ), '[]'::jsonb)
  );
end;
$$;
