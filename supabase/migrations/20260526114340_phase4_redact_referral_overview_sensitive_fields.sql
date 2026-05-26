-- Phase 4 frontend-sensitive referral response redaction.
-- Keep internal user/order UUIDs in trusted tables, but do not return them in
-- referral record and commission history RPC payloads consumed by task overview.

begin;

create or replace function api.referral_get_records(
  p_user_id uuid,
  p_cursor timestamptz default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(btrim(p_status), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_records jsonb;
  v_next_cursor timestamptz;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_status is not null
     and v_status not in ('pending', 'qualified', 'rewarded', 'cancelled') then
    raise exception 'invalid referral status';
  end if;

  with rows as (
    select
      r.id,
      r.invite_code,
      r.status,
      r.qualified_at,
      r.rewarded_at,
      r.created_at,
      r.updated_at,
      u.username as invitee_username,
      p.display_name as invitee_display_name
    from tasks.referrals r
    join core.users u on u.id = r.invitee_user_id
    left join core.user_profiles p on p.user_id = r.invitee_user_id
    where r.inviter_user_id = p_user_id
      and (v_status is null or r.status = v_status)
      and (p_cursor is null or r.created_at < p_cursor)
    order by r.created_at desc, r.id desc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'referral_id', id,
      'invitee_username', invitee_username,
      'invitee_display_name', invitee_display_name,
      'invite_code', invite_code,
      'status', status,
      'qualified_at', qualified_at,
      'rewarded_at', rewarded_at,
      'created_at', created_at,
      'updated_at', updated_at
    ) order by created_at desc, id desc), '[]'::jsonb),
    case when count(*) = v_limit then min(created_at) else null end
  into v_records, v_next_cursor
  from rows;

  return jsonb_build_object(
    'records', v_records,
    'count', jsonb_array_length(v_records),
    'next_cursor', v_next_cursor,
    'server_time', now()
  );
end;
$$;

create or replace function api.referral_get_commission_history(
  p_user_id uuid,
  p_cursor timestamptz default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(btrim(p_status), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_records jsonb;
  v_next_cursor timestamptz;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_status is not null
     and v_status not in ('pending', 'granted', 'reversed') then
    raise exception 'invalid commission status';
  end if;

  with rows as (
    select
      c.id,
      c.referral_id,
      c.source_type,
      c.source_id,
      c.base_amount_kcoin,
      c.commission_bps,
      c.commission_amount_kcoin,
      c.ledger_id,
      c.status,
      c.created_at,
      c.claimed_at,
      u.username as invitee_username,
      p.display_name as invitee_display_name
    from tasks.referral_commissions c
    join core.users u on u.id = c.invitee_user_id
    left join core.user_profiles p on p.user_id = c.invitee_user_id
    where c.inviter_user_id = p_user_id
      and (v_status is null or c.status = v_status)
      and (p_cursor is null or c.created_at < p_cursor)
    order by c.created_at desc, c.id desc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'commission_id', id,
      'referral_id', referral_id,
      'invitee_username', invitee_username,
      'invitee_display_name', invitee_display_name,
      'source_type', source_type,
      'source_id', source_id,
      'base_amount_kcoin', base_amount_kcoin,
      'commission_bps', commission_bps,
      'commission_amount_kcoin', commission_amount_kcoin,
      'ledger_id', ledger_id,
      'status', status,
      'created_at', created_at,
      'claimed_at', claimed_at
    ) order by created_at desc, id desc), '[]'::jsonb),
    case when count(*) = v_limit then min(created_at) else null end
  into v_records, v_next_cursor
  from rows;

  return jsonb_build_object(
    'commissions', v_records,
    'count', jsonb_array_length(v_records),
    'next_cursor', v_next_cursor,
    'server_time', now()
  );
end;
$$;

revoke execute on function api.referral_get_records(uuid, timestamptz, text, integer)
  from public, anon, authenticated;
revoke execute on function api.referral_get_commission_history(uuid, timestamptz, text, integer)
  from public, anon, authenticated;

grant execute on function api.referral_get_records(uuid, timestamptz, text, integer)
  to service_role;
grant execute on function api.referral_get_commission_history(uuid, timestamptz, text, integer)
  to service_role;

commit;
