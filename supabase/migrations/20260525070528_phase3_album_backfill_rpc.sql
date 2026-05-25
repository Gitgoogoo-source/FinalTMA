begin;

create or replace function api.album_backfill_discoveries_from_inventory(
  p_dry_run boolean default true,
  p_source text default 'scripts.backfill_album_progress',
  p_statuses text[] default array['available', 'locked', 'listed', 'minting', 'minted']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed_statuses constant text[] := array['available', 'locked', 'listed', 'minting', 'minted']::text[];
  v_history_event_types constant text[] := array[
    'obtained_from_gacha',
    'created',
    'acquired',
    'bought',
    'evolved_success',
    'evolved_failed_returned',
    'consumed',
    'decomposed',
    'listed',
    'delisted',
    'sold',
    'upgraded',
    'mint_queued',
    'minted',
    'transferred',
    'admin_adjusted'
  ]::text[];
  v_statuses text[] := coalesce(p_statuses, v_allowed_statuses);
  v_source text := coalesce(nullif(trim(p_source), ''), 'scripts.backfill_album_progress');
  v_candidate_item_count integer := 0;
  v_current_item_candidate_count integer := 0;
  v_event_item_candidate_count integer := 0;
  v_candidate_user_template_count integer := 0;
  v_existing_discovery_count integer := 0;
  v_missing_discovery_count integer := 0;
  v_inserted_discovery_count integer := 0;
begin
  if cardinality(v_statuses) = 0 then
    raise exception 'album backfill statuses must not be empty';
  end if;

  if exists (
    select 1
    from unnest(v_statuses) as requested_status(value)
    where requested_status.value is null
       or requested_status.value <> all(v_allowed_statuses)
  ) then
    raise exception 'unsupported album backfill status';
  end if;

  with current_inventory_candidates as (
    select
      'current_inventory'::text as candidate_source,
      null::text as event_type,
      ii.id,
      ii.owner_user_id as user_id,
      ii.template_id,
      ii.source_type,
      ii.source_id,
      ii.acquired_at,
      ii.created_at
    from inventory.item_instances ii
    where ii.owner_user_id is not null
      and ii.status = any(v_statuses)
  ),
  event_history_candidates as (
    select
      'inventory_event'::text as candidate_source,
      e.event_type,
      ii.id,
      e.user_id,
      ii.template_id,
      coalesce(nullif(e.source_type, ''), ii.source_type) as source_type,
      coalesce(e.source_id, ii.source_id) as source_id,
      coalesce(e.created_at, ii.acquired_at, ii.created_at) as acquired_at,
      e.created_at
    from inventory.item_instance_events e
    join inventory.item_instances ii on ii.id = e.item_instance_id
    where e.user_id is not null
      and e.event_type = any(v_history_event_types)
  ),
  candidate_sources as (
    select * from current_inventory_candidates
    union all
    select * from event_history_candidates
  ),
  ranked_candidates as (
    select
      candidate_source,
      event_type,
      id,
      user_id,
      template_id,
      source_type,
      source_id,
      acquired_at,
      created_at,
      row_number() over (
        partition by user_id, template_id
        order by acquired_at asc, created_at asc, id asc, candidate_source asc
      ) as candidate_rank
    from candidate_sources
  ),
  candidates as (
    select *
    from ranked_candidates
    where candidate_rank = 1
  ),
  missing as (
    select c.*
    from candidates c
    left join album.user_discoveries ud
      on ud.user_id = c.user_id
     and ud.template_id = c.template_id
    where ud.id is null
  )
  select
    (select count(distinct id)::integer from candidate_sources),
    (select count(distinct id)::integer from current_inventory_candidates),
    (select count(distinct id)::integer from event_history_candidates),
    (select count(*)::integer from candidates),
    (select count(*)::integer from album.user_discoveries),
    (select count(*)::integer from missing)
  into
    v_candidate_item_count,
    v_current_item_candidate_count,
    v_event_item_candidate_count,
    v_candidate_user_template_count,
    v_existing_discovery_count,
    v_missing_discovery_count;

  if not p_dry_run and v_missing_discovery_count > 0 then
    with current_inventory_candidates as (
      select
        'current_inventory'::text as candidate_source,
        null::text as event_type,
        ii.id,
        ii.owner_user_id as user_id,
        ii.template_id,
        ii.source_type,
        ii.source_id,
        ii.acquired_at,
        ii.created_at
      from inventory.item_instances ii
      where ii.owner_user_id is not null
        and ii.status = any(v_statuses)
    ),
    event_history_candidates as (
      select
        'inventory_event'::text as candidate_source,
        e.event_type,
        ii.id,
        e.user_id,
        ii.template_id,
        coalesce(nullif(e.source_type, ''), ii.source_type) as source_type,
        coalesce(e.source_id, ii.source_id) as source_id,
        coalesce(e.created_at, ii.acquired_at, ii.created_at) as acquired_at,
        e.created_at
      from inventory.item_instance_events e
      join inventory.item_instances ii on ii.id = e.item_instance_id
      where e.user_id is not null
        and e.event_type = any(v_history_event_types)
    ),
    candidate_sources as (
      select * from current_inventory_candidates
      union all
      select * from event_history_candidates
    ),
    ranked_candidates as (
      select
        candidate_source,
        event_type,
        id,
        user_id,
        template_id,
        source_type,
        source_id,
        acquired_at,
        created_at,
        row_number() over (
          partition by user_id, template_id
          order by acquired_at asc, created_at asc, id asc, candidate_source asc
        ) as candidate_rank
      from candidate_sources
    ),
    candidates as (
      select *
      from ranked_candidates
      where candidate_rank = 1
    ),
    missing as (
      select c.*
      from candidates c
      left join album.user_discoveries ud
        on ud.user_id = c.user_id
       and ud.template_id = c.template_id
      where ud.id is null
    )
    insert into album.user_discoveries (
      user_id,
      template_id,
      first_item_instance_id,
      first_source_type,
      first_source_id,
      discovered_at,
      metadata
    )
    select
      m.user_id,
      m.template_id,
      m.id,
      m.source_type,
      m.source_id,
      coalesce(m.acquired_at, m.created_at, now()),
      jsonb_build_object(
        'backfilled_at', now(),
        'source', v_source,
        'candidate_source', m.candidate_source,
        'event_type', m.event_type
      )
    from missing m
    on conflict (user_id, template_id) do nothing;

    get diagnostics v_inserted_discovery_count = row_count;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'source', v_source,
    'statuses', to_jsonb(v_statuses),
    'candidate_item_count', v_candidate_item_count,
    'current_item_candidate_count', v_current_item_candidate_count,
    'event_item_candidate_count', v_event_item_candidate_count,
    'candidate_user_template_count', v_candidate_user_template_count,
    'existing_discovery_count', v_existing_discovery_count,
    'missing_discovery_count', v_missing_discovery_count,
    'inserted_discovery_count', v_inserted_discovery_count
  );
end;
$$;

revoke execute on function api.album_backfill_discoveries_from_inventory(boolean, text, text[])
  from public, anon, authenticated;
grant execute on function api.album_backfill_discoveries_from_inventory(boolean, text, text[])
  to service_role;

commit;
