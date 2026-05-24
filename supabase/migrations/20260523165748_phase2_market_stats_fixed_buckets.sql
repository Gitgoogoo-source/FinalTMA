-- Phase 2 stage 13 market stats fixed depth buckets.
-- Local migration only until reviewed and pushed.

create or replace function api._market_depth_bucket_kcoin(
  p_unit_price_kcoin numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_unit_price_kcoin is null or p_unit_price_kcoin < 0 then 0::numeric
    when p_unit_price_kcoin < 100 then 0::numeric
    when p_unit_price_kcoin < 500 then 100::numeric
    when p_unit_price_kcoin < 1000 then 500::numeric
    when p_unit_price_kcoin < 5000 then 1000::numeric
    else 5000::numeric
  end;
$$;

revoke execute on function api._market_depth_bucket_kcoin(numeric) from public, anon, authenticated;

create or replace function api.market_refresh_price_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price_rows integer := 0;
  v_depth_rows integer := 0;
  v_price_health_rows integer := 0;
  v_snapshot_at timestamptz := clock_timestamp();
begin
  with active_stats as (
    select
      l.template_id,
      l.form_id,
      max(l.rarity_code) as rarity_code,
      min(l.unit_price_kcoin) as floor_price_kcoin,
      count(*)::integer as active_listing_count
    from market.listings l
    where l.status in ('active', 'partially_sold')
      and l.remaining_count > 0
    group by l.template_id, l.form_id
  ),
  sale_stats as (
    select
      l.template_id,
      l.form_id,
      max(l.rarity_code) as rarity_code,
      avg(o.unit_price_kcoin)::numeric(38,0) as avg_price_kcoin,
      (
        array_agg(o.unit_price_kcoin order by o.completed_at desc, o.created_at desc)
      )[1] as last_sale_price_kcoin,
      count(*) filter (where o.completed_at >= v_snapshot_at - interval '24 hours')::integer as sale_count_24h,
      coalesce(sum(o.total_price_kcoin) filter (where o.completed_at >= v_snapshot_at - interval '24 hours'), 0) as volume_24h_kcoin
    from market.orders o
    join market.listings l on l.id = o.listing_id
    where o.status = 'completed'
    group by l.template_id, l.form_id
  ),
  combined as (
    select
      coalesce(a.template_id, s.template_id) as template_id,
      coalesce(a.form_id, s.form_id) as form_id,
      coalesce(a.rarity_code, s.rarity_code) as rarity_code,
      a.floor_price_kcoin,
      s.avg_price_kcoin,
      s.last_sale_price_kcoin,
      coalesce(a.active_listing_count, 0) as active_listing_count,
      coalesce(s.sale_count_24h, 0) as sale_count_24h,
      coalesce(s.volume_24h_kcoin, 0) as volume_24h_kcoin
    from active_stats a
    full join sale_stats s
      on s.template_id = a.template_id
     and s.form_id is not distinct from a.form_id
  ),
  inserted as (
    insert into market.price_snapshots (
      template_id, form_id, rarity_code, floor_price_kcoin, avg_price_kcoin,
      last_sale_price_kcoin, active_listing_count, sale_count_24h,
      volume_24h_kcoin, snapshot_at
    )
    select
      template_id, form_id, rarity_code, floor_price_kcoin, avg_price_kcoin,
      last_sale_price_kcoin, active_listing_count, sale_count_24h,
      volume_24h_kcoin, v_snapshot_at
    from combined
    returning 1
  )
  select count(*)::integer into v_price_rows
  from inserted;

  with depth as (
    select
      l.template_id,
      l.form_id,
      api._market_depth_bucket_kcoin(l.unit_price_kcoin) as price_bucket_kcoin,
      count(*)::integer as listing_count,
      coalesce(sum(l.remaining_count), 0)::integer as item_count
    from market.listings l
    where l.status in ('active', 'partially_sold')
      and l.remaining_count > 0
    group by
      l.template_id,
      l.form_id,
      api._market_depth_bucket_kcoin(l.unit_price_kcoin)
  ),
  inserted as (
    insert into market.depth_snapshots (
      template_id, form_id, price_bucket_kcoin, listing_count, item_count, snapshot_at
    )
    select
      template_id, form_id, price_bucket_kcoin, listing_count, item_count, v_snapshot_at
    from depth
    returning 1
  )
  select count(*)::integer into v_depth_rows
  from inserted;

  update market.listings l
  set price_health = api._market_price_health(l.template_id, l.form_id, l.rarity_code, l.unit_price_kcoin),
      updated_at = now()
  where l.status in ('active', 'partially_sold')
    and l.remaining_count > 0;

  get diagnostics v_price_health_rows = row_count;

  return jsonb_build_object(
    'snapshot_at', v_snapshot_at,
    'price_snapshot_count', v_price_rows,
    'depth_snapshot_count', v_depth_rows,
    'price_health_update_count', v_price_health_rows
  );
end;
$$;

grant execute on function api.market_refresh_price_stats() to service_role;
revoke execute on function api.market_refresh_price_stats() from public, anon, authenticated;
