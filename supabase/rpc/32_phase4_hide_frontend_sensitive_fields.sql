-- phase4_hide_frontend_sensitive_fields.sql
-- ============================================================
-- Redact frontend-sensitive fields from Phase 4 referral response RPCs.

update ops.idempotency_keys
set response = response - 'invitee_user_id',
    updated_at = now()
where scope = 'referral_bind_inviter'
  and response ? 'invitee_user_id';

create or replace function api.referral_bind_inviter(
  p_invitee_user_id uuid,
  p_invite_code text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite_code text := upper(nullif(btrim(p_invite_code), ''));
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_scoped_key text;
  v_request_hash text;
  v_existing_idempotency ops.idempotency_keys%rowtype;
  v_invitee core.users%rowtype;
  v_inviter core.users%rowtype;
  v_referral tasks.referrals%rowtype;
  v_response jsonb;
begin
  if p_invitee_user_id is null then
    raise exception 'invitee_user_id is required';
  end if;
  if v_invite_code is null then
    raise exception 'invite_code is required';
  end if;
  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata must be a json object';
  end if;

  v_scoped_key := 'referral_bind_inviter:' || v_idempotency_key;
  v_request_hash := md5(jsonb_build_object(
    'invitee_user_id', p_invitee_user_id,
    'invite_code', v_invite_code
  )::text);

  perform pg_advisory_xact_lock(hashtext('referral_bind_inviter'), hashtext(v_scoped_key));

  select *
  into v_existing_idempotency
  from ops.idempotency_keys
  where key = v_scoped_key
  for update;

  if v_existing_idempotency.key is not null then
    if v_existing_idempotency.scope <> 'referral_bind_inviter'
       or v_existing_idempotency.user_id is distinct from p_invitee_user_id
       or v_existing_idempotency.request_hash is distinct from v_request_hash then
      raise exception 'idempotency conflict';
    end if;

    if v_existing_idempotency.status = 'completed'
       and v_existing_idempotency.response is not null then
      return (v_existing_idempotency.response - 'invitee_user_id')
        || jsonb_build_object('idempotent', true);
    end if;

    raise exception 'idempotency request is still in progress';
  end if;

  insert into ops.idempotency_keys (
    key,
    user_id,
    scope,
    request_hash,
    status,
    locked_until
  ) values (
    v_scoped_key,
    p_invitee_user_id,
    'referral_bind_inviter',
    v_request_hash,
    'started',
    now() + interval '5 minutes'
  );

  select *
  into v_invitee
  from core.users
  where id = p_invitee_user_id
  for update;

  if v_invitee.id is null then
    raise exception 'invitee user not found';
  end if;
  if v_invitee.status <> 'active' then
    raise exception 'invitee user is not active';
  end if;

  select *
  into v_inviter
  from core.users
  where invite_code = v_invite_code
  limit 1;

  if v_inviter.id is null or v_inviter.status <> 'active' then
    v_response := jsonb_build_object(
      'bound', false,
      'status', 'rejected',
      'reason', 'invite_code_not_found',
      'invite_code', v_invite_code,
      'idempotent', false
    );
  elsif v_inviter.id = p_invitee_user_id then
    insert into ops.risk_events (
      user_id,
      event_type,
      severity,
      source_type,
      detail
    ) values (
      p_invitee_user_id,
      'referral_self_invite',
      'medium',
      'referral_bind_inviter',
      jsonb_build_object('invite_code', v_invite_code, 'metadata', v_metadata)
    );

    v_response := jsonb_build_object(
      'bound', false,
      'status', 'rejected',
      'reason', 'self_invite_not_allowed',
      'invite_code', v_invite_code,
      'idempotent', false
    );
  else
    select *
    into v_referral
    from tasks.referrals
    where invitee_user_id = p_invitee_user_id
    for update;

    if v_referral.id is not null
       and v_referral.inviter_user_id <> v_inviter.id then
      insert into ops.risk_events (
        user_id,
        event_type,
        severity,
        source_type,
        source_id,
        detail
      ) values (
        p_invitee_user_id,
        'referral_rebind_attempt',
        'medium',
        'referral_bind_inviter',
        v_referral.id,
        jsonb_build_object(
          'existing_inviter_user_id', v_referral.inviter_user_id,
          'attempted_inviter_user_id', v_inviter.id,
          'invite_code', v_invite_code,
          'metadata', v_metadata
        )
      );

      v_response := jsonb_build_object(
        'bound', false,
        'status', 'conflict',
        'reason', 'referral_already_bound',
        'referral_id', v_referral.id,
        'idempotent', false
      );
    else
      if v_referral.id is null then
        update core.users
        set referred_by_user_id = v_inviter.id,
            updated_at = now()
        where id = p_invitee_user_id
          and referred_by_user_id is null;

        insert into tasks.referrals (
          inviter_user_id,
          invitee_user_id,
          invite_code,
          status,
          metadata
        ) values (
          v_inviter.id,
          p_invitee_user_id,
          v_invite_code,
          'pending',
          v_metadata
        )
        returning * into v_referral;
      end if;

      v_response := jsonb_build_object(
        'bound', true,
        'status', v_referral.status,
        'referral_id', v_referral.id,
        'inviter_user_id', v_referral.inviter_user_id,
        'invite_code', v_referral.invite_code,
        'created_at', v_referral.created_at,
        'idempotent', v_referral.created_at < now() - interval '1 millisecond'
      );
    end if;
  end if;

  update ops.idempotency_keys
  set response = v_response,
      status = 'completed',
      locked_until = null,
      updated_at = now()
  where key = v_scoped_key;

  return v_response;
end;
$$;

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

revoke execute on function api.referral_bind_inviter(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function api.referral_get_records(uuid, timestamptz, text, integer)
  from public, anon, authenticated;
revoke execute on function api.referral_get_commission_history(uuid, timestamptz, text, integer)
  from public, anon, authenticated;

grant execute on function api.referral_bind_inviter(uuid, text, text, jsonb)
  to service_role;
grant execute on function api.referral_get_records(uuid, timestamptz, text, integer)
  to service_role;
grant execute on function api.referral_get_commission_history(uuid, timestamptz, text, integer)
  to service_role;


-- ============================================================
