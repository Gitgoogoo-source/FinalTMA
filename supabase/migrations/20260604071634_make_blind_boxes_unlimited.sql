-- Make blind boxes unlimited-supply at the box level.
--
-- Prize-pool item stock is intentionally left intact. This migration only
-- removes the supply/count rule for the blind box product itself.

begin;

update gacha.blind_boxes
set total_stock = null,
    remaining_stock = null,
    updated_at = now()
where total_stock is not null
   or remaining_stock is not null;

comment on column gacha.blind_boxes.total_stock is
  'Deprecated for blind-box supply. Blind boxes are unlimited; keep null.';

comment on column gacha.blind_boxes.remaining_stock is
  'Deprecated for blind-box supply. Blind boxes are unlimited; keep null.';

create or replace function api.gacha_list_boxes(
  p_user_id uuid,
  p_statuses text[] default null,
  p_tier text default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select
      p_user_id as user_id,
      coalesce(p_statuses, array['not_started', 'active', 'paused', 'ended', 'sold_out']::text[]) as statuses,
      nullif(p_tier, '') as tier,
      greatest(1, least(coalesce(p_limit, 20), 100)) as row_limit,
      now() as server_now
  ),
  selected_boxes as (
    select b.*
    from gacha.blind_boxes b, params p
    where b.status = any(p.statuses)
      and (p.tier is null or b.tier = p.tier)
    order by b.sort_order asc, b.created_at asc
    limit (select row_limit from params)
  ),
  box_items as (
    select
      b.id,
      b.slug,
      b.display_name,
      b.description,
      b.tier,
      b.status,
      b.price_stars,
      b.open_reward_kcoin,
      b.cover_image_url,
      b.hero_image_url,
      b.starts_at,
      b.ends_at,
      b.sort_order,
      b.updated_at,
      pr10.discount_bps as ten_discount_bps,
      coalesce(pr1.price_stars_override, b.price_stars) as single_unit_price,
      coalesce(pr10.price_stars_override, b.price_stars) as ten_unit_price,
      prule.id as pity_rule_id,
      prule.threshold as pity_threshold,
      prule.target_rarity_code as pity_target_rarity_code,
      ps.current_count as pity_current_count,
      ps.total_draws as pity_total_draws,
      ps.updated_at as pity_updated_at,
      p.server_now
    from selected_boxes b
    cross join params p
    left join lateral (
      select pr.price_stars_override, pr.discount_bps
      from gacha.box_price_rules pr
      where pr.box_id = b.id
        and pr.active = true
        and pr.quantity = 1
        and (pr.starts_at is null or pr.starts_at <= p.server_now)
        and (pr.ends_at is null or pr.ends_at > p.server_now)
      order by pr.created_at desc
      limit 1
    ) pr1 on true
    left join lateral (
      select pr.price_stars_override, pr.discount_bps
      from gacha.box_price_rules pr
      where pr.box_id = b.id
        and pr.active = true
        and pr.quantity = 10
        and (pr.starts_at is null or pr.starts_at <= p.server_now)
        and (pr.ends_at is null or pr.ends_at > p.server_now)
      order by pr.created_at desc
      limit 1
    ) pr10 on true
    left join lateral (
      select pr.id, pr.threshold, pr.target_rarity_code
      from gacha.pity_rules pr
      where pr.box_id = b.id
        and pr.active = true
      order by pr.priority asc, pr.created_at asc
      limit 1
    ) prule on true
    left join gacha.user_pity_states ps
      on ps.user_id = p.user_id
     and ps.box_id = b.id
     and ps.pity_rule_id = prule.id
  ),
  mapped_items as (
    select
      sort_order,
      id,
      jsonb_build_object(
        'box_id', id,
        'slug', slug,
        'name', display_name,
        'description', description,
        'tier', case when tier = 'ordinary' then 'normal' else tier end,
        'status', status,
        'single_star_price', ceil((single_unit_price::numeric * (10000 - 0)) / 10000)::integer,
        'ten_draw_price', ceil((ten_unit_price::numeric * 10 * (10000 - coalesce(ten_discount_bps, 1000))) / 10000)::integer,
        'discount_rate', round(((10000 - coalesce(ten_discount_bps, 1000))::numeric / 10000), 4),
        'discount_bps', coalesce(ten_discount_bps, 1000),
        'stock_status', 'unlimited',
        'total_stock', null,
        'remaining_stock', null,
        'pity_progress',
          case
            when pity_rule_id is null then null
            else jsonb_build_object(
              'rule_id', pity_rule_id,
              'threshold', pity_threshold,
              'current_count', coalesce(pity_current_count, 0),
              'total_draws', coalesce(pity_total_draws, 0),
              'remaining_to_guaranteed', greatest(pity_threshold - coalesce(pity_current_count, 0), 0),
              'target_rarity', pity_target_rarity_code,
              'guaranteed_next', greatest(pity_threshold - coalesce(pity_current_count, 0), 0) <= 0,
              'updated_at', pity_updated_at
            )
          end,
        'hero_image_url', coalesce(hero_image_url, cover_image_url),
        'cover_image_url', cover_image_url,
        'is_openable',
          status = 'active'
          and (starts_at is null or starts_at <= server_now)
          and (ends_at is null or ends_at > server_now),
        'disabled_reason',
          case
            when status = 'not_started' then '盲盒活动尚未开始。'
            when status = 'paused' then '盲盒活动已暂停。'
            when status = 'ended' then '盲盒活动已结束。'
            when status = 'sold_out' then '当前盲盒不可开启。'
            when status <> 'active' then '当前盲盒不可开启。'
            when starts_at is not null and starts_at > server_now then '盲盒活动尚未开始。'
            when ends_at is not null and ends_at <= server_now then '盲盒活动已结束。'
            else null
          end,
        'kcoin_return_per_draw', open_reward_kcoin,
        'sort_order', sort_order,
        'updated_at', updated_at
      ) as item
    from box_items
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(item order by sort_order asc, id asc), '[]'::jsonb),
    'next_cursor', null,
    'server_time', (select server_now from params)
  )
  from mapped_items;
$$;

revoke execute on function api.gacha_list_boxes(uuid, text[], text, integer)
  from public, anon, authenticated;
grant execute on function api.gacha_list_boxes(uuid, text[], text, integer)
  to service_role;

create or replace function api.gacha_create_order_checked(
  p_user_id uuid,
  p_box_id uuid,
  p_quantity integer,
  p_idempotency_key text,
  p_expected_price_stars integer,
  p_expected_pool_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_pool gacha.drop_pool_versions%rowtype;
  v_unit_price integer;
  v_discount_bps integer;
  v_total_price integer;
  v_draw_order_id uuid := pg_catalog.gen_random_uuid();
  v_star_order_id uuid := pg_catalog.gen_random_uuid();
  v_payload text;
  v_idempotency_key text;
  v_expires_at timestamptz;
begin
  if p_user_id is null or p_box_id is null then
    raise exception 'user_id and box_id are required';
  end if;
  if p_quantity not in (1, 10) then
    raise exception 'quantity must be 1 or 10';
  end if;

  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  if v_idempotency_key is null then
    raise exception 'idempotency_key is required';
  end if;

  if p_expected_price_stars is not null and p_expected_price_stars <= 0 then
    raise exception 'expected price stars must be positive';
  end if;

  select * into v_existing_order
  from gacha.draw_orders
  where idempotency_key = v_idempotency_key
  for update;

  if v_existing_order.id is not null then
    if v_existing_order.user_id <> p_user_id
      or v_existing_order.box_id <> p_box_id
      or v_existing_order.quantity <> p_quantity then
      raise exception 'idempotency key conflict';
    end if;

    if p_expected_price_stars is not null
      and v_existing_order.total_price_stars <> p_expected_price_stars then
      raise exception 'expected price changed';
    end if;

    if p_expected_pool_version_id is not null
      and v_existing_order.pool_version_id <> p_expected_pool_version_id then
      raise exception 'expected pool version changed';
    end if;

    select so.expires_at into v_expires_at
    from payments.star_orders so
    where so.id = v_existing_order.payment_star_order_id;

    return jsonb_build_object(
      'draw_order_id', v_existing_order.id,
      'star_order_id', v_existing_order.payment_star_order_id,
      'invoice_payload', v_existing_order.invoice_payload,
      'xtr_amount', v_existing_order.total_price_stars,
      'quantity', v_existing_order.quantity,
      'draw_count', coalesce(v_existing_order.draw_count, v_existing_order.quantity),
      'discount_bps', v_existing_order.discount_bps,
      'pool_version_id', v_existing_order.pool_version_id,
      'status', v_existing_order.status,
      'payment_status', v_existing_order.payment_status,
      'expires_at', v_expires_at,
      'idempotent', true
    );
  end if;

  select * into v_box
  from gacha.blind_boxes
  where id = p_box_id
  for update;

  if v_box.id is null then
    raise exception 'blind box not found';
  end if;
  if v_box.status <> 'active' then
    raise exception 'blind box is not active: %', v_box.status;
  end if;
  if v_box.starts_at is not null and v_box.starts_at > now() then
    raise exception 'blind box has not started';
  end if;
  if v_box.ends_at is not null and v_box.ends_at <= now() then
    raise exception 'blind box has ended';
  end if;

  select * into v_pool
  from gacha.drop_pool_versions
  where box_id = p_box_id
    and status = 'active'
    and (effective_from is null or effective_from <= now())
    and (effective_to is null or effective_to > now())
  order by version_no desc
  limit 1;

  if v_pool.id is null then
    raise exception 'active drop pool not found';
  end if;

  if p_expected_pool_version_id is not null
    and v_pool.id <> p_expected_pool_version_id then
    raise exception 'expected pool version changed';
  end if;

  select
    coalesce(price_stars_override, v_box.price_stars),
    discount_bps
  into v_unit_price, v_discount_bps
  from gacha.box_price_rules
  where box_id = p_box_id
    and quantity = p_quantity
    and active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_unit_price is null then
    v_unit_price := v_box.price_stars;
    v_discount_bps := case when p_quantity = 10 then 1000 else 0 end;
  end if;

  v_total_price := ceil((v_unit_price * p_quantity)::numeric * (10000 - v_discount_bps)::numeric / 10000)::integer;

  if p_expected_price_stars is not null
    and v_total_price <> p_expected_price_stars then
    raise exception 'expected price changed';
  end if;

  v_payload :=
    'gacha_' ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
    replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_expires_at := now() + interval '15 minutes';

  insert into payments.star_orders (
    id, user_id, business_type, business_id, status, xtr_amount,
    telegram_invoice_payload, title, description, idempotency_key, expires_at, metadata
  ) values (
    v_star_order_id, p_user_id, 'gacha_open', v_draw_order_id, 'created', v_total_price,
    v_payload, v_box.display_name, 'Open blind box x' || p_quantity::text, v_idempotency_key,
    v_expires_at,
    jsonb_build_object('box_id', p_box_id, 'quantity', p_quantity, 'pool_version_id', v_pool.id)
  );

  insert into gacha.draw_orders (
    id, user_id, box_id, pool_version_id, payment_star_order_id, status,
    quantity, unit_price_stars, discount_bps, total_price_stars,
    open_reward_kcoin, invoice_payload, idempotency_key, metadata
  ) values (
    v_draw_order_id, p_user_id, p_box_id, v_pool.id, v_star_order_id, 'invoice_created',
    p_quantity, v_unit_price, v_discount_bps, v_total_price,
    v_box.open_reward_kcoin, v_payload, v_idempotency_key,
    jsonb_build_object('box_slug', v_box.slug, 'box_tier', v_box.tier)
  );

  return jsonb_build_object(
    'draw_order_id', v_draw_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', v_total_price,
    'quantity', p_quantity,
    'draw_count', p_quantity,
    'discount_bps', v_discount_bps,
    'pool_version_id', v_pool.id,
    'status', 'invoice_created',
    'payment_status', 'pending',
    'expires_at', v_expires_at,
    'idempotent', false
  );
end;
$$;

revoke execute on function api.gacha_create_order_checked(uuid, uuid, integer, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function api.gacha_create_order_checked(uuid, uuid, integer, text, integer, uuid)
  to service_role;

do $$
declare
  v_function_def text;
  v_updated_function_def text;
begin
  select pg_get_functiondef(
    'api.gacha_process_paid_order_without_task_progress(uuid,text,text,jsonb)'::regprocedure
  )
  into v_function_def;

  v_updated_function_def := replace(
    v_function_def,
    E'\n    if v_box.remaining_stock is not null and v_box.remaining_stock < v_order.draw_count then\n      raise exception ''blind box stock is insufficient after payment'';\n    end if;\n\n    if v_box.remaining_stock is not null then\n      update gacha.blind_boxes\n      set remaining_stock = remaining_stock - v_order.draw_count,\n          status = case when remaining_stock - v_order.draw_count <= 0 then ''sold_out'' else status end,\n          updated_at = now()\n      where id = v_box.id\n        and remaining_stock >= v_order.draw_count;\n\n      get diagnostics v_rows = row_count;\n      if v_rows <> 1 then\n        raise exception ''blind box stock changed during fulfillment'';\n      end if;\n    end if;\n',
    E'\n'
  );

  if v_updated_function_def = v_function_def then
    raise notice 'api.gacha_process_paid_order_without_task_progress has no blind-box stock block to remove';
  else
    execute v_updated_function_def;
  end if;

  if position(
    'blind box stock is insufficient after payment'
    in pg_get_functiondef(
      'api.gacha_process_paid_order_without_task_progress(uuid,text,text,jsonb)'::regprocedure
    )
  ) > 0
     or position(
       'blind box stock changed during fulfillment'
       in pg_get_functiondef(
         'api.gacha_process_paid_order_without_task_progress(uuid,text,text,jsonb)'::regprocedure
       )
     ) > 0 then
    raise exception 'failed to remove blind-box stock checks from api.gacha_process_paid_order_without_task_progress';
  end if;
end;
$$;

revoke execute on function api.gacha_process_paid_order_without_task_progress(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;

do $$
declare
  v_function_def text;
  v_updated_function_def text;
begin
  select pg_get_functiondef(
    'api.payment_mark_precheckout_checked(bigint,text,text,text,integer,bigint,jsonb,text,text,boolean)'::regprocedure
  )
  into v_function_def;

  v_updated_function_def := replace(
    v_function_def,
    E'\n    elsif v_box.remaining_stock is not null\n       and v_box.remaining_stock < greatest(coalesce(v_draw_order.draw_count, v_draw_order.quantity, 1), 1) then\n      v_allowed := false;\n      v_reason_code := ''STOCK_INSUFFICIENT'';\n      v_error_message := ''盲盒库存不足，请重新选择。'';\n      v_target_payment_status := ''failed'';\n      v_target_draw_status := ''failed'';\n',
    E'\n'
  );

  if v_updated_function_def = v_function_def then
    raise notice 'api.payment_mark_precheckout_checked has no blind-box stock block to remove';
  else
    execute v_updated_function_def;
  end if;

  if position(
    'STOCK_INSUFFICIENT'
    in pg_get_functiondef(
      'api.payment_mark_precheckout_checked(bigint,text,text,text,integer,bigint,jsonb,text,text,boolean)'::regprocedure
    )
  ) > 0 then
    raise exception 'failed to remove blind-box stock checks from api.payment_mark_precheckout_checked';
  end if;
end;
$$;

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

  select coalesce(array_agg(b.id order by b.id), array[]::uuid[])
  into v_box_activation_blocked_ids
  from gacha.blind_boxes b
  where b.status = 'not_started'
    and b.starts_at is not null
    and b.starts_at <= v_now
    and (b.ends_at is null or b.ends_at > v_now)
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
is 'Cron-only lifecycle sync for phase 6 banner campaigns and unlimited blind boxes. Ends expired campaigns/boxes, activates due boxes with active pools, records job events, and flags blocked activations.';

commit;
