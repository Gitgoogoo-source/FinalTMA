create or replace function tasks.checkin_json(p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row tasks.checkins%rowtype;
begin
  select * into v_row from tasks.checkins where user_id = p_user_id;
  return jsonb_build_object(
    'next_day', case when coalesce(v_row.current_day, 0) = 7 then 1 else coalesce(v_row.current_day, 0) + 1 end,
    'claimed_today', coalesce(v_row.last_claim_date = identity.utc_day(), false),
    'cycle_progress', coalesce(v_row.current_day, 0)
  );
end;
$$;

create or replace function api.tasks_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', d.code,
        'order', d.sort_order,
        'category', d.category,
        'name', d.display_name,
        'target', d.target,
        'progress', least(coalesce(p.progress, 0), d.target),
        'reward_fgems', d.reward_fgems,
        'claimed', p.claimed_at is not null
      ) order by d.sort_order)
      from tasks.definitions d
      left join tasks.daily_progress p
        on p.user_id = v_user_id and p.business_date = identity.utc_day() and p.task_code = d.code
    ), '[]'::jsonb),
    'checkin', tasks.checkin_json(v_user_id)
  );
end;
$$;
