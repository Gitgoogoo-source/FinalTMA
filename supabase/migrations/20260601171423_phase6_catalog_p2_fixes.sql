-- Phase 6: catalog P2 fixes.
--
-- 1) Add stale-preview guards for inventory growth writes while keeping the
--    existing three-argument RPCs compatible for older callers and tests.

begin;

drop function if exists api.inventory_upgrade_item(
  uuid,
  uuid,
  text,
  integer,
  numeric,
  integer
);
drop function if exists api.inventory_evolve_item(
  uuid,
  uuid[],
  text,
  uuid,
  numeric,
  integer,
  uuid
);
drop function if exists api.inventory_decompose_items(uuid, uuid[], text, numeric);

create or replace function api.inventory_upgrade_item(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_idempotency_key text,
  p_target_level integer,
  p_expected_fgems_cost numeric,
  p_expected_item_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_rule inventory.upgrade_rules%rowtype;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if v_key is null then
    raise exception 'idempotency key is required';
  end if;

  if exists (
    select 1
    from inventory.upgrade_logs logs
    where logs.idempotency_key = v_key
  ) then
    return api.inventory_upgrade_item(p_user_id, p_item_instance_id, p_idempotency_key);
  end if;

  select
    ii.id,
    ii.owner_user_id,
    ii.status,
    ii.nft_mint_status,
    ii.level,
    ii.lock_version,
    ii.template_id,
    ii.form_id,
    ct.rarity_code,
    ct.upgradeable,
    ct.max_level,
    coalesce(cf.form_index, 1) as form_index
  into v_item
  from inventory.item_instances ii
  join catalog.collectible_templates ct on ct.id = ii.template_id
  left join catalog.collectible_forms cf on cf.id = ii.form_id
  where ii.id = p_item_instance_id
  for update of ii;

  if v_item.id is null then
    raise exception 'item not found';
  end if;

  if v_item.owner_user_id <> p_user_id then
    raise exception 'not item owner';
  end if;

  if v_item.status <> 'available'
     or v_item.nft_mint_status in ('queued', 'minting')
     or exists (
       select 1
       from inventory.inventory_locks il
       where il.item_instance_id = v_item.id
         and il.status = 'active'
     ) then
    raise exception 'item is not available';
  end if;

  if p_expected_item_version is not null
     and p_expected_item_version <> v_item.lock_version then
    raise exception 'item version mismatch';
  end if;

  if not v_item.upgradeable then
    raise exception 'item is not upgradeable';
  end if;

  if v_item.level >= v_item.max_level then
    raise exception 'item already at max level';
  end if;

  select *
  into v_rule
  from inventory.upgrade_rules
  where rarity_code = v_item.rarity_code
    and form_index = v_item.form_index
    and from_level = v_item.level
    and active = true
  order by created_at desc
  limit 1;

  if v_rule.id is null then
    raise exception 'upgrade rule not found';
  end if;

  if p_target_level is not null and p_target_level <> v_rule.to_level then
    raise exception 'upgrade preview mismatch';
  end if;

  if p_expected_fgems_cost is not null
     and p_expected_fgems_cost <> v_rule.cost_fgems then
    raise exception 'upgrade preview mismatch';
  end if;

  return api.inventory_upgrade_item(p_user_id, p_item_instance_id, p_idempotency_key);
end;
$$;

create or replace function api.inventory_evolve_item(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_idempotency_key text,
  p_target_form_id uuid,
  p_expected_kcoin_cost numeric,
  p_expected_success_rate_bps integer,
  p_expected_return_item_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_template_id uuid;
  v_form_id uuid;
  v_distinct_templates integer;
  v_distinct_forms integer;
  v_bad_count integer;
  v_rule inventory.evolution_rules%rowtype;
  v_main_item_id uuid;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if v_key is null then
    raise exception 'idempotency key is required';
  end if;

  if exists (
    select 1
    from inventory.evolution_attempts attempts
    where attempts.idempotency_key = v_key
  ) then
    return api.inventory_evolve_item(p_user_id, p_item_instance_ids, p_idempotency_key);
  end if;

  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_item_instance_ids is null or cardinality(p_item_instance_ids) <> 3 then
    raise exception 'exactly three item ids are required';
  end if;

  if (select count(*) from (select distinct unnest(p_item_instance_ids) as id) x) <> 3 then
    raise exception 'duplicate item ids are not allowed';
  end if;

  perform 1
  from inventory.item_instances ii
  where ii.id = any(p_item_instance_ids)
  order by ii.id
  for update;

  select
    count(*)::integer,
    (array_agg(distinct ii.template_id))[1],
    (array_agg(distinct ii.form_id))[1],
    count(distinct ii.template_id)::integer,
    count(distinct coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
    count(*) filter (
      where ii.owner_user_id <> p_user_id
         or ii.status <> 'available'
         or ii.nft_mint_status in ('queued', 'minting')
         or t.evolvable = false
         or exists (
           select 1
           from inventory.inventory_locks il
           where il.item_instance_id = ii.id
             and il.status = 'active'
         )
    )::integer
  into v_count, v_template_id, v_form_id, v_distinct_templates, v_distinct_forms, v_bad_count
  from inventory.item_instances ii
  join catalog.collectible_templates t on t.id = ii.template_id
  where ii.id = any(p_item_instance_ids);

  if v_count <> 3 then
    raise exception 'some items do not exist';
  end if;

  if v_bad_count > 0 then
    raise exception 'some items are not evolvable or not available';
  end if;

  if v_distinct_templates <> 1 or v_distinct_forms <> 1 then
    raise exception 'evolution requires three copies of the same collectible and form';
  end if;

  if v_form_id is null then
    raise exception 'source form is required for evolution';
  end if;

  select *
  into v_rule
  from inventory.evolution_rules
  where from_template_id = v_template_id
    and from_form_id = v_form_id
    and active = true
  order by created_at desc
  limit 1;

  if v_rule.id is null then
    raise exception 'evolution rule not found';
  end if;

  select ii.id
  into v_main_item_id
  from inventory.item_instances ii
  where ii.id = any(p_item_instance_ids)
  order by ii.level desc, ii.power desc, ii.acquired_at asc
  limit 1;

  if p_target_form_id is not null and p_target_form_id <> v_rule.to_form_id then
    raise exception 'evolution preview mismatch';
  end if;

  if p_expected_kcoin_cost is not null
     and p_expected_kcoin_cost <> v_rule.cost_kcoin then
    raise exception 'evolution preview mismatch';
  end if;

  if p_expected_success_rate_bps is not null
     and p_expected_success_rate_bps <> v_rule.success_rate_bps then
    raise exception 'evolution preview mismatch';
  end if;

  if p_expected_return_item_instance_id is not null
     and p_expected_return_item_instance_id <> v_main_item_id then
    raise exception 'evolution preview mismatch';
  end if;

  return api.inventory_evolve_item(p_user_id, p_item_instance_ids, p_idempotency_key);
end;
$$;

create or replace function api.inventory_decompose_items(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_idempotency_key text,
  p_expected_fgems_reward numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input_count integer;
  v_distinct_count integer;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_total_reward numeric(38,0);
  v_owned_count integer;
  v_bad_reason text;
begin
  if v_key is null then
    raise exception 'idempotency key is required';
  end if;

  if exists (
    select 1
    from inventory.decompose_logs logs
    where logs.idempotency_key = v_key
  ) then
    return api.inventory_decompose_items(p_user_id, p_item_instance_ids, p_idempotency_key);
  end if;

  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  v_input_count := coalesce(cardinality(p_item_instance_ids), 0);
  if v_input_count < 1 or v_input_count > 100 then
    raise exception 'one to one hundred item ids are required';
  end if;

  select count(distinct x.id)::integer
  into v_distinct_count
  from unnest(p_item_instance_ids) as x(id);

  if v_distinct_count <> v_input_count then
    raise exception 'duplicate item ids are not allowed';
  end if;

  perform 1
  from inventory.item_instances ii
  where ii.id = any(p_item_instance_ids)
  order by ii.id
  for update;

  select count(*)::integer
  into v_owned_count
  from inventory.item_instances ii
  where ii.id = any(p_item_instance_ids)
    and ii.owner_user_id = p_user_id;

  if v_owned_count <> v_input_count then
    raise exception 'item not found';
  end if;

  with input_items as (
    select x.id, x.ord
    from unnest(p_item_instance_ids) with ordinality as x(id, ord)
  ),
  item_rows as (
    select
      input_items.ord,
      ii.id as item_instance_id,
      ii.owner_user_id,
      ii.template_id,
      ii.form_id,
      ii.status,
      ii.nft_mint_status,
      ii.level,
      ct.decomposable,
      ct.rarity_code,
      coalesce(cf.form_index, 1) as form_index,
      exists (
        select 1
        from inventory.inventory_locks il
        where il.item_instance_id = ii.id
          and il.status = 'active'
          and (il.expires_at is null or il.expires_at > now())
      ) as has_active_lock
    from input_items
    join inventory.item_instances ii on ii.id = input_items.id
    join catalog.collectible_templates ct on ct.id = ii.template_id
    left join catalog.collectible_forms cf on cf.id = ii.form_id
  ),
  selected_counts as (
    select
      template_id,
      coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid) as form_key,
      count(*)::integer as selected_same_items
    from item_rows
    group by template_id, coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  available_counts as (
    select
      ii.template_id,
      coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) as form_key,
      count(*)::integer as available_same_items
    from inventory.item_instances ii
    where ii.owner_user_id = p_user_id
      and ii.status = 'available'
      and ii.nft_mint_status not in ('queued', 'minting')
      and not exists (
        select 1
        from inventory.inventory_locks il
        where il.item_instance_id = ii.id
          and il.status = 'active'
          and (il.expires_at is null or il.expires_at > now())
      )
    group by ii.template_id, coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  validated_rows as (
    select
      ir.*,
      coalesce(ac.available_same_items, 0) as duplicate_count,
      coalesce(sc.selected_same_items, 0) as selected_same_items,
      dr.id as rule_id,
      dr.reward_fgems,
      case
        when ir.owner_user_id <> p_user_id then 'item not found'
        when ir.status <> 'available' then 'item is not available'
        when ir.has_active_lock then 'item is locked'
        when ir.nft_mint_status in ('queued', 'minting') then 'item is minting'
        when not ir.decomposable then 'item is not decomposable'
        when coalesce(ac.available_same_items, 0) < 2 then 'only duplicate collectibles can be decomposed'
        when coalesce(sc.selected_same_items, 0) >= coalesce(ac.available_same_items, 0) then 'only duplicate collectibles can be decomposed'
        when dr.id is null then 'decompose rule not found'
        else null
      end as reason
    from item_rows ir
    join selected_counts sc
      on sc.template_id = ir.template_id
     and sc.form_key = coalesce(ir.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    left join available_counts ac
      on ac.template_id = ir.template_id
     and ac.form_key = coalesce(ir.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    left join lateral (
      select *
      from inventory.decompose_rules rule_row
      where rule_row.rarity_code = ir.rarity_code
        and rule_row.form_index = ir.form_index
        and rule_row.min_level <= ir.level
        and rule_row.active = true
      order by rule_row.min_level desc, rule_row.created_at desc
      limit 1
    ) dr on true
  )
  select
    min(reason) filter (where reason is not null),
    coalesce(sum(reward_fgems) filter (where reason is null), 0)::numeric
  into v_bad_reason, v_total_reward
  from validated_rows;

  if v_bad_reason is not null then
    raise exception '%', v_bad_reason;
  end if;

  if v_total_reward <= 0 then
    raise exception 'decompose reward must be positive';
  end if;

  if p_expected_fgems_reward is not null
     and p_expected_fgems_reward <> v_total_reward then
    raise exception 'decompose preview mismatch';
  end if;

  return api.inventory_decompose_items(p_user_id, p_item_instance_ids, p_idempotency_key);
end;
$$;

create or replace function api.admin_update_collectible_template_ops(
  p_admin_user_id uuid,
  p_template_id uuid,
  p_release_status text default null,
  p_tradeable boolean default null,
  p_upgradeable boolean default null,
  p_evolvable boolean default null,
  p_decomposable boolean default null,
  p_nft_mintable boolean default null,
  p_sort_order integer default null,
  p_metadata jsonb default null,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_idempotent jsonb;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'catalog.collectible_template.ops.update';
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_status text := nullif(trim(coalesce(p_release_status, '')), '');
  v_metadata jsonb;
  v_request_hash text;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['catalog:write', 'admin:write']);

  if p_template_id is null then
    raise exception 'ADMIN_CATALOG_TEMPLATE_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status is not null and v_status not in ('draft', 'active', 'hidden', 'retired') then
    raise exception 'ADMIN_CATALOG_TEMPLATE_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if p_sort_order is not null and p_sort_order < 0 then
    raise exception 'ADMIN_CATALOG_TEMPLATE_SORT_INVALID' using errcode = 'P0001';
  end if;

  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'ADMIN_CATALOG_TEMPLATE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  select *
  into v_template
  from catalog.collectible_templates
  where id = p_template_id
  for update;

  if not found then
    raise exception 'ADMIN_CATALOG_TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_template);
  v_metadata := case
    when p_metadata is null then v_template.metadata
    else p_metadata
  end;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'template_id', p_template_id,
    'release_status', coalesce(v_status, v_template.release_status),
    'tradeable', coalesce(p_tradeable, v_template.tradeable),
    'upgradeable', coalesce(p_upgradeable, v_template.upgradeable),
    'evolvable', coalesce(p_evolvable, v_template.evolvable),
    'decomposable', coalesce(p_decomposable, v_template.decomposable),
    'nft_mintable', coalesce(p_nft_mintable, v_template.nft_mintable),
    'sort_order', coalesce(p_sort_order, v_template.sort_order),
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  update catalog.collectible_templates
  set release_status = coalesce(v_status, release_status),
      tradeable = coalesce(p_tradeable, tradeable),
      upgradeable = coalesce(p_upgradeable, upgradeable),
      evolvable = coalesce(p_evolvable, evolvable),
      decomposable = coalesce(p_decomposable, decomposable),
      nft_mintable = coalesce(p_nft_mintable, nft_mintable),
      sort_order = coalesce(p_sort_order, sort_order),
      metadata = v_metadata,
      updated_at = v_now
  where id = p_template_id
  returning * into v_template;

  v_after := to_jsonb(v_template);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'catalog.collectible_template.ops.update',
    'catalog',
    'collectible_templates',
    v_template.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  v_response := jsonb_build_object(
    'template_id', v_template.id,
    'release_status', v_template.release_status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_update_album_milestone(
  p_admin_user_id uuid,
  p_milestone_id uuid,
  p_title text default null,
  p_required_count integer default null,
  p_reward jsonb default null,
  p_active boolean default null,
  p_sort_order integer default null,
  p_metadata jsonb default null,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_milestone album.milestones%rowtype;
  v_book album.books%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_idempotent jsonb;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'album.milestone.update';
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_reward jsonb;
  v_metadata jsonb;
  v_request_hash text;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['catalog:write', 'admin:write']);

  if p_milestone_id is null then
    raise exception 'ADMIN_ALBUM_MILESTONE_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_required_count is not null and p_required_count <= 0 then
    raise exception 'ADMIN_ALBUM_MILESTONE_REQUIRED_COUNT_INVALID' using errcode = 'P0001';
  end if;

  if p_sort_order is not null and p_sort_order < 0 then
    raise exception 'ADMIN_ALBUM_MILESTONE_SORT_INVALID' using errcode = 'P0001';
  end if;

  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'ADMIN_ALBUM_MILESTONE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  select *
  into v_milestone
  from album.milestones
  where id = p_milestone_id
  for update;

  if not found then
    raise exception 'ADMIN_ALBUM_MILESTONE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into v_book
  from album.books
  where id = v_milestone.book_id
  for update;

  v_reward := case
    when p_reward is null then v_milestone.reward
    else p_reward
  end;

  if jsonb_typeof(v_reward) <> 'array' then
    raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_reward) as reward_row(value)
    where jsonb_typeof(reward_row.value) <> 'object'
       or nullif(trim(coalesce(reward_row.value ->> 'currency', '')), '') is null
       or nullif(trim(coalesce(reward_row.value ->> 'currency', '')), '') not in ('KCOIN', 'FGEMS')
       or nullif(trim(coalesce(reward_row.value ->> 'amount', '')), '') is null
       or (reward_row.value ->> 'amount') !~ '^[0-9]+(\.[0-9]+)?$'
       or (reward_row.value ->> 'amount')::numeric <= 0
  ) then
    raise exception 'ADMIN_ALBUM_MILESTONE_REWARD_INVALID' using errcode = 'P0001';
  end if;

  if p_required_count is not null
     and exists (
       select 1
       from album.milestones other
       where other.book_id = v_milestone.book_id
         and other.required_count = p_required_count
         and other.id <> v_milestone.id
     ) then
    raise exception 'ADMIN_ALBUM_MILESTONE_REQUIRED_COUNT_CONFLICT' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_milestone);
  v_metadata := case
    when p_metadata is null then v_milestone.metadata
    else p_metadata
  end;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'milestone_id', p_milestone_id,
    'title', coalesce(v_title, v_milestone.title),
    'required_count', coalesce(p_required_count, v_milestone.required_count),
    'reward', v_reward,
    'active', coalesce(p_active, v_milestone.active),
    'sort_order', coalesce(p_sort_order, v_milestone.sort_order),
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  update album.milestones
  set title = coalesce(v_title, title),
      required_count = coalesce(p_required_count, required_count),
      reward = v_reward,
      active = coalesce(p_active, active),
      sort_order = coalesce(p_sort_order, sort_order),
      metadata = v_metadata,
      updated_at = v_now
  where id = p_milestone_id
  returning * into v_milestone;

  v_after := to_jsonb(v_milestone);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'album.milestone.update',
    'album',
    'milestones',
    v_milestone.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  v_response := jsonb_build_object(
    'book_id', v_book.id,
    'milestone_id', v_milestone.id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke execute on function api.inventory_upgrade_item(uuid, uuid, text, integer, numeric, integer)
  from public, anon, authenticated;
revoke execute on function api.inventory_evolve_item(uuid, uuid[], text, uuid, numeric, integer, uuid)
  from public, anon, authenticated;
revoke execute on function api.inventory_decompose_items(uuid, uuid[], text, numeric)
  from public, anon, authenticated;
revoke execute on function api.admin_update_collectible_template_ops(uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, integer, jsonb, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function api.admin_update_album_milestone(uuid, uuid, text, integer, jsonb, boolean, integer, jsonb, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function api.inventory_upgrade_item(uuid, uuid, text, integer, numeric, integer)
  to service_role;
grant execute on function api.inventory_evolve_item(uuid, uuid[], text, uuid, numeric, integer, uuid)
  to service_role;
grant execute on function api.inventory_decompose_items(uuid, uuid[], text, numeric)
  to service_role;
grant execute on function api.admin_update_collectible_template_ops(uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, integer, jsonb, text, text, jsonb)
  to service_role;
grant execute on function api.admin_update_album_milestone(uuid, uuid, text, integer, jsonb, boolean, integer, jsonb, text, text, jsonb)
  to service_role;

commit;
