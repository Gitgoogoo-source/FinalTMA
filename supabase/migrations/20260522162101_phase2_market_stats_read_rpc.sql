-- Phase 2 market stats read RPC.

create or replace function api.market_get_stats(
  p_user_id uuid,
  p_template_id uuid default null,
  p_form_id uuid default null,
  p_series_id uuid default null,
  p_rarity text default null,
  p_type_code text default null,
  p_period text default '7d',
  p_include_depth boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price jsonb;
  v_depth jsonb := '[]'::jsonb;
  v_price_template_id uuid;
  v_price_form_id uuid;
  v_min_snapshot_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_template_id is null
     and p_series_id is null
     and p_rarity is null
     and p_type_code is null then
    raise exception 'at least one filter is required';
  end if;

  if coalesce(p_period, '7d') not in ('1h', '24h', '7d', '30d', 'all') then
    raise exception 'invalid stats period';
  end if;

  v_min_snapshot_at := case coalesce(p_period, '7d')
    when '1h' then now() - interval '1 hour'
    when '24h' then now() - interval '24 hours'
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    else null
  end;

  select
    ps.template_id,
    ps.form_id,
    jsonb_build_object(
      'template_id', ps.template_id,
      'form_id', ps.form_id,
      'floor_price_kcoin', ps.floor_price_kcoin,
      'avg_price_kcoin', ps.avg_price_kcoin,
      'last_sale_price_kcoin', ps.last_sale_price_kcoin,
      'active_listing_count', ps.active_listing_count,
      'sale_count_24h', ps.sale_count_24h,
      'volume_24h_kcoin', ps.volume_24h_kcoin,
      'snapshot_at', ps.snapshot_at
    )
  into v_price_template_id, v_price_form_id, v_price
  from market.price_snapshots ps
  join catalog.collectible_templates t on t.id = ps.template_id
  where (p_template_id is null or ps.template_id = p_template_id)
    and (p_form_id is null or ps.form_id is not distinct from p_form_id)
    and (p_series_id is null or t.series_id = p_series_id)
    and (p_rarity is null or lower(ps.rarity_code) = lower(p_rarity))
    and (p_type_code is null or lower(t.type_code) = lower(p_type_code))
    and (v_min_snapshot_at is null or ps.snapshot_at >= v_min_snapshot_at)
  order by ps.snapshot_at desc, ps.active_listing_count desc, ps.template_id desc
  limit 1;

  if coalesce(p_include_depth, true)
     and coalesce(v_price_template_id, p_template_id) is not null then
    with latest_depth_at as (
      select max(d.snapshot_at) as snapshot_at
      from market.depth_snapshots d
      where d.template_id = coalesce(v_price_template_id, p_template_id)
        and (
          coalesce(v_price_form_id, p_form_id) is null
          or d.form_id is not distinct from coalesce(v_price_form_id, p_form_id)
        )
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'price_kcoin', d.price_bucket_kcoin,
          'listing_count', d.listing_count,
          'item_count', d.item_count
        )
        order by d.price_bucket_kcoin asc
      ),
      '[]'::jsonb
    )
    into v_depth
    from market.depth_snapshots d
    join latest_depth_at latest on latest.snapshot_at = d.snapshot_at
    where d.template_id = coalesce(v_price_template_id, p_template_id)
      and (
        coalesce(v_price_form_id, p_form_id) is null
        or d.form_id is not distinct from coalesce(v_price_form_id, p_form_id)
      );
  end if;

  return jsonb_build_object(
    'price', v_price,
    'depth', coalesce(v_depth, '[]'::jsonb),
    'price_health', case
      when v_price is null or v_price ->> 'floor_price_kcoin' is null then 'unknown'
      else 'healthy'
    end
  );
end;
$$;

grant execute on function api.market_get_stats(uuid, uuid, uuid, uuid, text, text, text, boolean) to service_role;
revoke execute on function api.market_get_stats(uuid, uuid, uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
