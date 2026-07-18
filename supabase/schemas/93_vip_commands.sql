create or replace function api.vip_claim(
  p_session_id uuid,
  p_operation_id uuid,
  p_benefit text
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
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'vip.claim.' || p_benefit, p_operation_id, '{}'::jsonb);
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_benefit not in ('fgems', 'free_rare_box') then perform api.raise_business_error('VIP_BENEFIT_INVALID', '月卡权益无效'); end if;
    if not exists (select 1 from vip.subscriptions where user_id = v_user_id and identity.utc_day() between starts_on and ends_on) then perform api.raise_business_error('VIP_INACTIVE', '月卡未生效'); end if;
    insert into vip.claims (user_id, benefit_date, benefit, operation_id)
    values (v_user_id, identity.utc_day(), p_benefit, p_operation_id)
    on conflict do nothing;
    if not found then perform api.raise_business_error('VIP_ALREADY_CLAIMED', '今日权益已领取'); end if;
    if p_benefit = 'fgems' then
      perform economy.change_balance(v_user_id, 'FGEMS', 100, 'vip_daily', p_operation_id, identity.utc_day()::text);
      v_result := jsonb_build_object('kind', 'fgems', 'amount', 100, 'claimed', true);
    else
      insert into economy.entitlements (user_id, kind, source, operation_id) values (v_user_id, 'free_rare_box', 'vip_daily', p_operation_id);
      v_result := jsonb_build_object('kind', 'free_rare_box', 'amount', 1, 'claimed', true);
    end if;
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;
