-- Phase 4 / 4.4: keep internal referral and source UUIDs out of commission history responses.

begin;

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
      c.source_type,
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
      'invitee_username', invitee_username,
      'invitee_display_name', invitee_display_name,
      'source_type', source_type,
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

revoke execute on function api.referral_get_commission_history(uuid, timestamptz, text, integer)
  from public, anon, authenticated;

grant execute on function api.referral_get_commission_history(uuid, timestamptz, text, integer)
  to service_role;

commit;
