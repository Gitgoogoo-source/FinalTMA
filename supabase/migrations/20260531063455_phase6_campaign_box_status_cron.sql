-- Phase 6: cron RPC for campaign and blind-box lifecycle status sync.
--
-- This function is called only by the Vercel cron API through service_role.
-- It keeps scheduled lifecycle changes and the job event record in one
-- database transaction.

begin;

create or replace function api.sync_campaign_box_statuses(
  p_request_context jsonb default '{}'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_started_at timestamptz := clock_timestamp();
  v_context jsonb := coalesce(p_request_context, '{}'::jsonb);
  v_campaign_ended_ids uuid[] := array[]::uuid[];
  v_box_activated_ids uuid[] := array[]::uuid[];
  v_box_ended_ids uuid[] := array[]::uuid[];
  v_box_sold_out_ids uuid[] := array[]::uuid[];
  v_box_activation_blocked_ids uuid[] := array[]::uuid[];
  v_app_event_id uuid;
  v_result jsonb;
begin
  if jsonb_typeof(v_context) <> 'object' then
    raise exception 'CRON_REQUEST_CONTEXT_INVALID' using errcode = 'P0001';
  end if;

  with updated_campaigns as (
    update catalog.banner_campaigns c
    set status = 'ended',
        updated_at = v_now
    where c.status = 'active'
      and c.ends_at is not null
      and c.ends_at <= v_now
    returning c.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_campaign_ended_ids
  from updated_campaigns;

  with updated_boxes as (
    update gacha.blind_boxes b
    set status = 'ended',
        updated_at = v_now
    where b.status in ('not_started', 'active', 'paused')
      and b.ends_at is not null
      and b.ends_at <= v_now
    returning b.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_box_ended_ids
  from updated_boxes;

  with updated_boxes as (
    update gacha.blind_boxes b
    set status = 'sold_out',
        updated_at = v_now
    where b.status in ('not_started', 'active', 'paused')
      and b.remaining_stock = 0
      and (b.ends_at is null or b.ends_at > v_now)
    returning b.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_box_sold_out_ids
  from updated_boxes;

  select coalesce(array_agg(b.id order by b.id), array[]::uuid[])
  into v_box_activation_blocked_ids
  from gacha.blind_boxes b
  where b.status = 'not_started'
    and b.starts_at is not null
    and b.starts_at <= v_now
    and (b.ends_at is null or b.ends_at > v_now)
    and (b.remaining_stock is null or b.remaining_stock > 0)
    and not exists (
      select 1
      from gacha.drop_pool_versions dpv
      where dpv.box_id = b.id
        and dpv.status = 'active'
        and (dpv.effective_from is null or dpv.effective_from <= v_now)
        and (dpv.effective_to is null or dpv.effective_to > v_now)
    );

  insert into ops.risk_events (
    user_id,
    event_type,
    severity,
    status,
    source_type,
    source_id,
    score_delta,
    detail
  )
  select
    null,
    'cron_box_activation_blocked',
    'medium',
    'open',
    'blind_box',
    blocked.id,
    0,
    jsonb_build_object(
      'reason', 'ACTIVE_DROP_POOL_REQUIRED',
      'job', 'cron.sync_campaign_box_statuses',
      'request_context', v_context,
      'checked_at', v_now
    )
  from unnest(v_box_activation_blocked_ids) as blocked(id)
  where not exists (
    select 1
    from ops.risk_events existing
    where existing.event_type = 'cron_box_activation_blocked'
      and existing.source_type = 'blind_box'
      and existing.source_id = blocked.id
      and existing.status in ('open', 'reviewing')
  );

  with updated_boxes as (
    update gacha.blind_boxes b
    set status = 'active',
        updated_at = v_now
    where b.status = 'not_started'
      and b.starts_at is not null
      and b.starts_at <= v_now
      and (b.ends_at is null or b.ends_at > v_now)
      and (b.remaining_stock is null or b.remaining_stock > 0)
      and exists (
        select 1
        from gacha.drop_pool_versions dpv
        where dpv.box_id = b.id
          and dpv.status = 'active'
          and (dpv.effective_from is null or dpv.effective_from <= v_now)
          and (dpv.effective_to is null or dpv.effective_to > v_now)
      )
    returning b.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_box_activated_ids
  from updated_boxes;

  v_result := jsonb_build_object(
    'campaigns_ended_count', cardinality(v_campaign_ended_ids),
    'boxes_activated_count', cardinality(v_box_activated_ids),
    'boxes_ended_count', cardinality(v_box_ended_ids),
    'boxes_sold_out_count', cardinality(v_box_sold_out_ids),
    'box_activation_blocked_count', cardinality(v_box_activation_blocked_ids),
    'campaign_ended_ids', to_jsonb(v_campaign_ended_ids),
    'box_activated_ids', to_jsonb(v_box_activated_ids),
    'box_ended_ids', to_jsonb(v_box_ended_ids),
    'box_sold_out_ids', to_jsonb(v_box_sold_out_ids),
    'box_activation_blocked_ids', to_jsonb(v_box_activation_blocked_ids),
    'server_time', v_now,
    'duration_ms', greatest(
      0,
      floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer
    )
  );

  insert into ops.app_events (user_id, event_name, event_source, payload)
  values (
    null,
    'cron.sync_campaign_box_statuses.completed',
    'cron.sync_campaign_box_statuses',
    v_result || jsonb_build_object('request_context', v_context)
  )
  returning id into v_app_event_id;

  return v_result || jsonb_build_object('app_event_id', v_app_event_id);
end;
$$;

revoke all on function api.sync_campaign_box_statuses(jsonb, timestamptz)
from public, anon, authenticated;

grant execute on function api.sync_campaign_box_statuses(jsonb, timestamptz)
to service_role;

comment on function api.sync_campaign_box_statuses(jsonb, timestamptz)
is 'Cron-only lifecycle sync for phase 6 banner campaigns and blind boxes. Ends expired campaigns/boxes, activates due boxes with active pools, marks zero-stock boxes sold_out, records job events, and flags blocked activations.';

commit;
