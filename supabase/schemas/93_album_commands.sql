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
  v_reward bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'album.claim', p_operation_id, jsonb_build_object('chain_id', p_chain_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select case chain_type when 'normal' then 100 when 'advanced' then 300 else 800 end into v_reward from catalog.chains where id = p_chain_id;
    if v_reward is null or (select count(*) from album.nodes n join catalog.templates t on t.id = n.template_id where n.user_id = v_user_id and t.chain_id = p_chain_id) <> 3 then perform api.raise_business_error('ALBUM_CHAIN_INCOMPLETE', '进化链尚未完成'); end if;
    insert into album.rewards (user_id, chain_id, operation_id) values (v_user_id, p_chain_id, p_operation_id) on conflict do nothing;
    if not found then perform api.raise_business_error('ALBUM_REWARD_ALREADY_CLAIMED', '图鉴奖励已领取'); end if;
    perform economy.change_balance(v_user_id, 'FGEMS', v_reward, 'album_reward', p_operation_id, p_chain_id);
    perform tasks.progress(v_user_id, 'album_chain');
    v_result := jsonb_build_object('chain_id', p_chain_id, 'reward_fgems', v_reward, 'claimed', true);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
