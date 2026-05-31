-- Phase 6 risk center read RPCs.
-- Keeps private schemas out of direct PostgREST reads used by admin risk APIs.

begin;

create or replace function api.admin_list_risk_events(
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'severity',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_sort text := lower(nullif(trim(coalesce(p_sort, '')), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_severity text := nullif(trim(v_filters ->> 'severity'), '');
  v_status text := nullif(trim(v_filters ->> 'status'), '');
  v_event_type text := nullif(trim(v_filters ->> 'eventType'), '');
  v_user_id uuid := nullif(trim(v_filters ->> 'userId'), '')::uuid;
  v_source_id uuid := nullif(trim(v_filters ->> 'sourceId'), '')::uuid;
  v_source_type text := nullif(trim(v_filters ->> 'sourceType'), '');
  v_from timestamptz := nullif(trim(v_filters ->> 'from'), '')::timestamptz;
  v_to timestamptz := nullif(trim(v_filters ->> 'to'), '')::timestamptz;
  v_rows jsonb;
  v_total_count integer;
begin
  if v_sort is null then
    v_sort := 'severity';
  end if;

  if v_sort not in ('severity', 'created_at') then
    raise exception 'ADMIN_RISK_EVENTS_SORT_INVALID' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_total_count
  from ops.risk_events re
  where (v_severity is null or re.severity = v_severity)
    and (v_status is null or re.status = v_status)
    and (v_event_type is null or re.event_type = v_event_type)
    and (v_user_id is null or re.user_id = v_user_id)
    and (v_source_id is null or re.source_id = v_source_id)
    and (v_source_type is null or re.source_type = v_source_type)
    and (v_from is null or re.created_at >= v_from)
    and (v_to is null or re.created_at <= v_to);

  select coalesce(jsonb_agg(to_jsonb(page_rows) - 'sort_index' order by page_rows.sort_index), '[]'::jsonb)
  into v_rows
  from (
    select
      row_number() over () as sort_index,
      ordered.id,
      ordered.user_id,
      ordered.event_type,
      ordered.severity,
      ordered.status,
      ordered.source_type,
      ordered.source_id,
      ordered.score_delta,
      ordered.detail,
      ordered.resolved_by_admin_id,
      ordered.resolved_at,
      ordered.created_at
    from (
      select
        re.id,
        re.user_id,
        re.event_type,
        re.severity,
        re.status,
        re.source_type,
        re.source_id,
        re.score_delta,
        re.detail,
        re.resolved_by_admin_id,
        re.resolved_at,
        re.created_at
      from ops.risk_events re
      where (v_severity is null or re.severity = v_severity)
        and (v_status is null or re.status = v_status)
        and (v_event_type is null or re.event_type = v_event_type)
        and (v_user_id is null or re.user_id = v_user_id)
        and (v_source_id is null or re.source_id = v_source_id)
        and (v_source_type is null or re.source_type = v_source_type)
        and (v_from is null or re.created_at >= v_from)
        and (v_to is null or re.created_at <= v_to)
      order by
        case
          when v_sort = 'severity' then
            case re.severity
              when 'critical' then 1
              when 'high' then 2
              when 'medium' then 3
              when 'low' then 4
              else 5
            end
          else 0
        end asc,
        re.created_at desc,
        re.id desc
      limit v_limit + 1
      offset v_offset
    ) ordered
  ) page_rows;

  return jsonb_build_object(
    'total_count', coalesce(v_total_count, 0),
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

create or replace function api.admin_get_risk_association_summaries(
  p_associations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_associations jsonb := case
    when jsonb_typeof(coalesce(p_associations, '[]'::jsonb)) = 'array'
      then coalesce(p_associations, '[]'::jsonb)
    else '[]'::jsonb
  end;
  v_summaries jsonb;
begin
  with requested as (
    select distinct
      left(nullif(trim(value ->> 'kind'), ''), 64) as kind,
      left(nullif(trim(value ->> 'source_id'), ''), 128) as source_id
    from jsonb_array_elements(v_associations) as input(value)
    where nullif(trim(value ->> 'kind'), '') is not null
      and nullif(trim(value ->> 'source_id'), '') is not null
    limit 800
  ),
  summary_rows as (
    select
      'payment_order'::text as kind,
      so.id::text as source_id,
      jsonb_strip_nulls(jsonb_build_object(
        'status', so.status,
        'business_type', so.business_type,
        'business_id', so.business_id,
        'xtr_amount', so.xtr_amount,
        'paid_at', so.paid_at,
        'fulfilled_at', so.fulfilled_at,
        'created_at', so.created_at
      )) as summary
    from payments.star_orders so
    where exists (
      select 1
      from requested r
      where r.kind = 'payment_order'
        and r.source_id = so.id::text
    )
    union all
    select
      'gacha_order'::text,
      go.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'status', go.status,
        'user_id', go.user_id,
        'box_id', go.box_id,
        'draw_count', go.draw_count,
        'total_price_stars', go.total_price_stars,
        'payment_status', go.payment_status,
        'payment_star_order_id', go.payment_star_order_id,
        'created_at', go.created_at,
        'paid_at', go.paid_at,
        'opened_at', go.opened_at
      ))
    from gacha.draw_orders go
    where exists (
      select 1
      from requested r
      where r.kind = 'gacha_order'
        and r.source_id = go.id::text
    )
    union all
    select
      'wallet'::text,
      uw.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'status', uw.status,
        'chain', uw.chain,
        'network', uw.network,
        'wallet_app_name', uw.wallet_app_name,
        'wallet_device', uw.wallet_device,
        'verified_at', uw.verified_at,
        'last_sync_at', uw.last_sync_at,
        'created_at', uw.created_at,
        'address_short', case
          when length(trim(uw.address)) <= 10 then trim(uw.address)
          else substr(trim(uw.address), 1, 6) || '...' || right(trim(uw.address), 4)
        end,
        'address_last4', right(trim(uw.address), 4),
        'address_hash', encode(extensions.digest(trim(uw.address), 'sha256'), 'hex')
      ))
    from core.user_wallets uw
    where exists (
      select 1
      from requested r
      where r.kind = 'wallet'
        and r.source_id = uw.id::text
    )
    union all
    select
      'market_listing'::text,
      ml.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'status', ml.status,
        'seller_user_id', ml.seller_user_id,
        'item_count', ml.item_count,
        'remaining_count', ml.remaining_count,
        'unit_price_kcoin', ml.unit_price_kcoin,
        'price_health', ml.price_health,
        'created_at', ml.created_at,
        'updated_at', ml.updated_at
      ))
    from market.listings ml
    where exists (
      select 1
      from requested r
      where r.kind = 'market_listing'
        and r.source_id = ml.id::text
    )
    union all
    select
      'market_order'::text,
      mo.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'status', mo.status,
        'buyer_user_id', mo.buyer_user_id,
        'seller_user_id', mo.seller_user_id,
        'listing_id', mo.listing_id,
        'item_count', mo.item_count,
        'total_price_kcoin', mo.total_price_kcoin,
        'unit_price_kcoin', mo.unit_price_kcoin,
        'completed_at', mo.completed_at,
        'created_at', mo.created_at
      ))
    from market.orders mo
    where exists (
      select 1
      from requested r
      where r.kind = 'market_order'
        and r.source_id = mo.id::text
    )
    union all
    select
      'reconciliation_run'::text,
      rr.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'run_type', rr.run_type,
        'status', rr.status,
        'started_at', rr.started_at,
        'finished_at', rr.finished_at,
        'error_message', rr.error_message
      ))
    from economy.reconciliation_runs rr
    where exists (
      select 1
      from requested r
      where r.kind = 'reconciliation_run'
        and r.source_id = rr.id::text
    )
    union all
    select
      'mint_queue'::text,
      mq.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'status', mq.status,
        'user_id', mq.user_id,
        'item_instance_id', mq.item_instance_id,
        'attempt_count', mq.attempt_count,
        'max_attempts', mq.max_attempts,
        'tx_hash', mq.tx_hash,
        'created_at', mq.created_at,
        'updated_at', mq.updated_at,
        'completed_at', mq.completed_at
      ))
    from onchain.mint_queue mq
    where exists (
      select 1
      from requested r
      where r.kind = 'mint_queue'
        and r.source_id = mq.id::text
    )
    union all
    select
      'referral'::text,
      tr.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'status', tr.status,
        'inviter_user_id', tr.inviter_user_id,
        'invitee_user_id', tr.invitee_user_id,
        'first_open_order_id', tr.first_open_order_id,
        'qualified_at', tr.qualified_at,
        'rewarded_at', tr.rewarded_at,
        'created_at', tr.created_at
      ))
    from tasks.referrals tr
    where exists (
      select 1
      from requested r
      where r.kind = 'referral'
        and r.source_id = tr.id::text
    )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', sr.kind,
        'source_id', sr.source_id,
        'summary', sr.summary
      )
      order by sr.kind, sr.source_id
    ),
    '[]'::jsonb
  )
  into v_summaries
  from summary_rows sr;

  return jsonb_build_object('summaries', coalesce(v_summaries, '[]'::jsonb));
end;
$$;

create or replace function api.admin_get_risk_user_profile(
  p_user_id uuid,
  p_section text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section text := nullif(trim(coalesce(p_section, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_user jsonb;
begin
  if p_user_id is null then
    raise exception 'ADMIN_RISK_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if v_section is not null and v_section not in (
    'flags',
    'devices',
    'payments',
    'market',
    'referrals',
    'wallets',
    'riskEvents'
  ) then
    raise exception 'ADMIN_RISK_PROFILE_SECTION_INVALID' using errcode = 'P0001';
  end if;

  select to_jsonb(user_row)
  into v_user
  from (
    select
      u.id,
      u.telegram_user_id,
      u.username::text as username,
      u.first_name,
      u.last_name,
      u.language_code,
      u.is_premium,
      u.is_bot,
      u.invite_code,
      u.referred_by_user_id,
      u.status,
      u.risk_score,
      u.first_seen_at,
      u.last_seen_at,
      u.last_auth_at,
      u.metadata,
      u.created_at,
      u.updated_at
    from core.users u
    where u.id = p_user_id
  ) user_row;

  if v_user is null then
    return jsonb_build_object('user', null);
  end if;

  return jsonb_build_object(
    'user', v_user,
    'flags', jsonb_build_object(
      'total_count', (
        select count(*)::integer
        from core.user_flags uf
        where uf.user_id = p_user_id
      ),
      'rows', coalesce(
        (
          select jsonb_agg(to_jsonb(flag_rows) order by flag_rows.active desc, flag_rows.created_at desc, flag_rows.id desc)
          from (
            select
              uf.id,
              uf.user_id,
              uf.flag_code,
              uf.flag_level,
              uf.reason,
              uf.active,
              uf.starts_at,
              uf.ends_at,
              uf.created_by_admin_id,
              uf.metadata,
              uf.created_at,
              uf.updated_at
            from core.user_flags uf
            where uf.user_id = p_user_id
            order by uf.active desc, uf.created_at desc, uf.id desc
            limit v_limit + 1
            offset case when v_section is null or v_section = 'flags' then v_offset else 0 end
          ) flag_rows
        ),
        '[]'::jsonb
      )
    ),
    'payments', jsonb_build_object(
      'total_count', (
        select count(*)::integer
        from payments.star_orders so
        where so.user_id = p_user_id
      ),
      'success_count', (
        select count(*)::integer
        from payments.star_orders so
        where so.user_id = p_user_id
          and so.status in ('paid', 'fulfilled', 'completed')
      ),
      'failed_count', (
        select count(*)::integer
        from payments.star_orders so
        where so.user_id = p_user_id
          and so.status in ('failed', 'expired', 'cancelled')
      ),
      'disputed_count', (
        select count(*)::integer
        from payments.star_orders so
        where so.user_id = p_user_id
          and so.status in ('disputed', 'refunded', 'chargeback')
      ),
      'rows', coalesce(
        (
          select jsonb_agg(to_jsonb(payment_rows) order by payment_rows.created_at desc, payment_rows.id desc)
          from (
            select
              so.id,
              so.user_id,
              so.business_type,
              so.business_id,
              so.status,
              so.xtr_amount,
              so.paid_at,
              so.fulfilled_at,
              so.created_at
            from payments.star_orders so
            where so.user_id = p_user_id
            order by so.created_at desc, so.id desc
            limit v_limit + 1
            offset case when v_section is null or v_section = 'payments' then v_offset else 0 end
          ) payment_rows
        ),
        '[]'::jsonb
      )
    ),
    'market', jsonb_build_object(
      'buyer_count', (
        select count(*)::integer
        from market.orders mo
        where mo.buyer_user_id = p_user_id
      ),
      'seller_count', (
        select count(*)::integer
        from market.orders mo
        where mo.seller_user_id = p_user_id
      ),
      'rows', coalesce(
        (
          select jsonb_agg(to_jsonb(market_rows) order by market_rows.created_at desc, market_rows.id desc)
          from (
            select
              mo.id,
              mo.buyer_user_id,
              mo.seller_user_id,
              mo.status,
              mo.item_count,
              mo.total_price_kcoin,
              mo.completed_at,
              mo.created_at
            from market.orders mo
            where mo.buyer_user_id = p_user_id
               or mo.seller_user_id = p_user_id
            order by mo.created_at desc, mo.id desc
            limit v_limit + 1
            offset case when v_section is null or v_section = 'market' then v_offset else 0 end
          ) market_rows
        ),
        '[]'::jsonb
      ),
      'counterparty_rows', coalesce(
        (
          select jsonb_agg(to_jsonb(counterparty_rows) order by counterparty_rows.created_at desc, counterparty_rows.id desc)
          from (
            select
              mo.id,
              mo.buyer_user_id,
              mo.seller_user_id,
              mo.status,
              mo.item_count,
              mo.total_price_kcoin,
              mo.completed_at,
              mo.created_at
            from market.orders mo
            where mo.buyer_user_id = p_user_id
               or mo.seller_user_id = p_user_id
            order by mo.created_at desc, mo.id desc
            limit 500
          ) counterparty_rows
        ),
        '[]'::jsonb
      )
    ),
    'referrals', jsonb_build_object(
      'invited_count', (
        select count(*)::integer
        from tasks.referrals tr
        where tr.inviter_user_id = p_user_id
      ),
      'invited_by_count', (
        select count(*)::integer
        from tasks.referrals tr
        where tr.invitee_user_id = p_user_id
      ),
      'first_open_count', (
        select count(*)::integer
        from tasks.referrals tr
        where tr.inviter_user_id = p_user_id
          and tr.first_open_order_id is not null
      ),
      'qualified_count', (
        select count(*)::integer
        from tasks.referrals tr
        where tr.inviter_user_id = p_user_id
          and tr.qualified_at is not null
      ),
      'rewarded_count', (
        select count(*)::integer
        from tasks.referrals tr
        where tr.inviter_user_id = p_user_id
          and tr.rewarded_at is not null
      ),
      'rows', coalesce(
        (
          select jsonb_agg(to_jsonb(referral_rows) order by referral_rows.created_at desc, referral_rows.id desc)
          from (
            select
              tr.id,
              tr.inviter_user_id,
              tr.invitee_user_id,
              tr.status,
              tr.first_open_order_id,
              tr.qualified_at,
              tr.rewarded_at,
              tr.created_at
            from tasks.referrals tr
            where tr.inviter_user_id = p_user_id
               or tr.invitee_user_id = p_user_id
            order by tr.created_at desc, tr.id desc
            limit v_limit + 1
            offset case when v_section is null or v_section = 'referrals' then v_offset else 0 end
          ) referral_rows
        ),
        '[]'::jsonb
      )
    ),
    'wallets', jsonb_build_object(
      'total_count', (
        select count(*)::integer
        from core.user_wallets uw
        where uw.user_id = p_user_id
      ),
      'rows', coalesce(
        (
          select jsonb_agg(to_jsonb(wallet_rows) order by wallet_rows.created_at desc, wallet_rows.id desc)
          from (
            select
              uw.id,
              uw.user_id,
              uw.chain,
              uw.network,
              uw.address,
              uw.wallet_app_name,
              uw.wallet_device,
              uw.is_primary,
              uw.status,
              uw.verified_at,
              uw.disconnected_at,
              uw.last_sync_at,
              uw.metadata,
              uw.created_at,
              uw.updated_at
            from core.user_wallets uw
            where uw.user_id = p_user_id
            order by uw.created_at desc, uw.id desc
            limit v_limit + 1
            offset case when v_section is null or v_section = 'wallets' then v_offset else 0 end
          ) wallet_rows
        ),
        '[]'::jsonb
      ),
      'reuse_counts', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'address', reuse.address,
              'reuse_user_count', reuse.reuse_user_count
            )
            order by reuse.address
          )
          from (
            select
              other.address,
              count(distinct other.user_id)::integer as reuse_user_count
            from core.user_wallets mine
            join core.user_wallets other
              on other.address = mine.address
             and other.user_id <> p_user_id
            where mine.user_id = p_user_id
            group by other.address
          ) reuse
        ),
        '[]'::jsonb
      )
    ),
    'devices', jsonb_build_object(
      'device_count', (
        select count(*)::integer
        from core.user_devices ud
        where ud.user_id = p_user_id
      ),
      'session_count', (
        select count(*)::integer
        from core.app_sessions s
        where s.user_id = p_user_id
      ),
      'device_rows', coalesce(
        (
          select jsonb_agg(to_jsonb(device_rows) order by device_rows.last_seen_at desc nulls last, device_rows.first_seen_at desc, device_rows.id desc)
          from (
            select
              ud.id,
              ud.user_id,
              ud.device_key,
              ud.platform,
              ud.user_agent,
              ud.first_seen_at,
              ud.last_seen_at,
              ud.metadata
            from core.user_devices ud
            where ud.user_id = p_user_id
            order by ud.last_seen_at desc nulls last, ud.first_seen_at desc, ud.id desc
            limit v_limit + 1
            offset case when v_section is null or v_section = 'devices' then v_offset else 0 end
          ) device_rows
        ),
        '[]'::jsonb
      ),
      'session_rows', coalesce(
        (
          select jsonb_agg(to_jsonb(session_rows) order by session_rows.created_at desc, session_rows.id desc)
          from (
            select
              s.id,
              s.user_id,
              s.ip_hash,
              s.device_id,
              s.platform,
              s.user_agent,
              s.expires_at,
              s.revoked_at,
              s.last_seen_at,
              s.created_at
            from core.app_sessions s
            where s.user_id = p_user_id
            order by s.created_at desc, s.id desc
            limit v_limit + 1
            offset case when v_section is null or v_section = 'devices' then v_offset else 0 end
          ) session_rows
        ),
        '[]'::jsonb
      )
    ),
    'risk_events', jsonb_build_object(
      'total_count', (
        select count(*)::integer
        from ops.risk_events re
        where re.user_id = p_user_id
      ),
      'rows', coalesce(
        (
          select jsonb_agg(to_jsonb(risk_rows) order by risk_rows.created_at desc, risk_rows.id desc)
          from (
            select
              re.id,
              re.user_id,
              re.event_type,
              re.severity,
              re.status,
              re.source_type,
              re.source_id,
              re.score_delta,
              re.detail,
              re.resolved_by_admin_id,
              re.resolved_at,
              re.created_at
            from ops.risk_events re
            where re.user_id = p_user_id
            order by re.created_at desc, re.id desc
            limit v_limit + 1
            offset case when v_section is null or v_section = 'riskEvents' then v_offset else 0 end
          ) risk_rows
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

revoke all on function api.admin_list_risk_events(jsonb, text, integer, integer)
from public, anon, authenticated;

revoke all on function api.admin_get_risk_association_summaries(jsonb)
from public, anon, authenticated;

revoke all on function api.admin_get_risk_user_profile(uuid, text, integer, integer)
from public, anon, authenticated;

grant execute on function api.admin_list_risk_events(jsonb, text, integer, integer)
to service_role;

grant execute on function api.admin_get_risk_association_summaries(jsonb)
to service_role;

grant execute on function api.admin_get_risk_user_profile(uuid, text, integer, integer)
to service_role;

comment on function api.admin_list_risk_events(jsonb, text, integer, integer) is
  'Phase 6 risk center: service-role read facade for paginated risk event rows.';

comment on function api.admin_get_risk_association_summaries(jsonb) is
  'Phase 6 risk center: service-role read facade for private-schema risk event association summaries.';

comment on function api.admin_get_risk_user_profile(uuid, text, integer, integer) is
  'Phase 6 risk center: service-role read facade for risk user profile data across private schemas.';

commit;
