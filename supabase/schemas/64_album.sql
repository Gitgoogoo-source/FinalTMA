create table album.nodes (
  user_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  first_operation_id uuid references operations.operations(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

create index album_nodes_template_idx on album.nodes (template_id, user_id);

create table album.rewards (
  user_id uuid not null references identity.users(id) on delete cascade,
  chain_id text not null references catalog.chains(id),
  operation_id uuid not null references operations.operations(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, chain_id)
);

create or replace function album.unlock_template(p_user_id uuid, p_template_id text, p_operation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
  v_chain_id text;
begin
  insert into album.nodes (user_id, template_id, first_operation_id)
  values (p_user_id, p_template_id, p_operation_id)
  on conflict (user_id, template_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    select chain_id into v_chain_id from catalog.templates where id = p_template_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || v_chain_id, 0));
    perform tasks.progress(p_user_id, 'album_unlock');
    if (select count(*) from album.nodes n join catalog.templates t on t.id = n.template_id where n.user_id = p_user_id and t.chain_id = v_chain_id) = 3 then
      perform tasks.progress(p_user_id, 'album_chain');
    end if;
  end if;
  return v_rows = 1;
end;
$$;

create or replace function api.album_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return (
    with chain_rows as (
      select
        c.id,
        c.global_order,
        c.chain_type,
        c.theme,
        case c.chain_type when 'normal' then 100 when 'advanced' then 300 else 800 end reward_fgems,
        count(n.template_id)::integer unlocked_count,
        exists(select 1 from album.rewards r where r.user_id = v_user_id and r.chain_id = c.id) claimed,
        jsonb_agg(jsonb_build_object(
          'template_id', t.id,
          'name', t.name,
          'image_thumbnail_path', t.image_thumbnail_path,
          'image_detail_path', t.image_detail_path,
          'rarity', t.rarity,
          'stage', t.stage,
          'unlocked', n.template_id is not null,
          'owned_count', coalesce(h.quantity, 0)
        ) order by t.stage) nodes
      from catalog.chains c
      join catalog.templates t on t.chain_id = c.id
      left join album.nodes n on n.user_id = v_user_id and n.template_id = t.id
      left join inventory.holdings h on h.user_id = v_user_id and h.template_id = t.id
      group by c.id, c.global_order, c.chain_type, c.theme
    )
    select jsonb_build_object(
      'unlocked_count', coalesce(sum(unlocked_count), 0),
      'total_count', 210,
      'completed_chain_count', count(*) filter (where unlocked_count = 3),
      'total_chain_count', 70,
      'claimable_count', count(*) filter (where unlocked_count = 3 and not claimed),
      'chains', coalesce(jsonb_agg(jsonb_build_object(
        'chain_id', id,
        'chain_type', chain_type,
        'theme', theme,
        'unlocked_count', unlocked_count,
        'completed', unlocked_count = 3,
        'claimable', unlocked_count = 3 and not claimed,
        'claimed', claimed,
        'reward_fgems', reward_fgems,
        'nodes', nodes
      ) order by global_order), '[]'::jsonb)
    )
    from chain_rows
  );
end;
$$;

create or replace function api.album_claim(
  p_session_id uuid,
  p_operation_id uuid,
  p_chain_id text
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
  v_chain catalog.chains%rowtype;
  v_reward bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'album.claim', p_operation_id, jsonb_build_object('chain_id', p_chain_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_chain from catalog.chains where id = p_chain_id;
    v_reward := case v_chain.chain_type when 'normal' then 100 when 'advanced' then 300 when 'top' then 800 end;
    if v_reward is null or (select count(*) from album.nodes n join catalog.templates t on t.id = n.template_id where n.user_id = v_user_id and t.chain_id = p_chain_id) <> 3 then perform api.raise_business_error('ALBUM_CHAIN_INCOMPLETE', '进化链尚未完成'); end if;
    insert into album.rewards (user_id, chain_id, operation_id) values (v_user_id, p_chain_id, p_operation_id) on conflict do nothing;
    if not found then perform api.raise_business_error('ALBUM_REWARD_ALREADY_CLAIMED', '图鉴奖励已领取'); end if;
    perform economy.change_balance(v_user_id, 'FGEMS', v_reward, 'album_reward', p_operation_id, p_chain_id);
    v_result := jsonb_build_object('chain_id', p_chain_id, 'chain_type', v_chain.chain_type, 'theme', v_chain.theme, 'reward_fgems', v_reward, 'claimed', true);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
