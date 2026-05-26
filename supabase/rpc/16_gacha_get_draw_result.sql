-- gacha_get_draw_result.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Returns a user's draw order and detailed draw results for result pages and history.
-- This function never creates rewards. It only reads results already produced by gacha_process_paid_order.

create or replace function api.gacha_get_draw_result(
  p_user_id uuid,
  p_draw_order_id uuid default null,
  p_invoice_payload text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order gacha.draw_orders%rowtype;
  v_results jsonb;
  v_box jsonb;
  v_payment jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_draw_order_id is null and (p_invoice_payload is null or length(trim(p_invoice_payload)) = 0) then
    raise exception 'draw_order_id or invoice_payload is required';
  end if;

  select * into v_order
  from gacha.draw_orders
  where user_id = p_user_id
    and (
      (p_draw_order_id is not null and id = p_draw_order_id)
      or
      (p_invoice_payload is not null and invoice_payload = p_invoice_payload)
    )
  limit 1;

  if v_order.id is null then
    raise exception 'draw order not found';
  end if;

  select jsonb_build_object(
    'id', b.id,
    'slug', b.slug,
    'display_name', b.display_name,
    'tier', b.tier,
    'cover_image_url', b.cover_image_url,
    'hero_image_url', b.hero_image_url
  ) into v_box
  from gacha.blind_boxes b
  where b.id = v_order.box_id;

  select jsonb_build_object(
    'star_order_id', so.id,
    'status', so.status,
    'xtr_amount', so.xtr_amount,
    'paid_at', so.paid_at,
    'fulfilled_at', so.fulfilled_at
  ) into v_payment
  from payments.star_orders so
  where so.id = v_order.payment_star_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_index', dr.draw_index,
    'was_pity', dr.was_pity,
    'random_roll', dr.random_roll,
    'item_instance_id', dr.item_instance_id,
    'template_id', dr.template_id,
    'template_slug', ct.slug,
    'display_name', ct.display_name,
    'subtitle', ct.subtitle,
    'description', ct.description,
    'rarity_code', dr.rarity_code,
    'rarity_display_name', r.display_name,
    'type_code', ct.type_code,
    'form_id', dr.form_id,
    'form_index', cf.form_index,
    'form_name', cf.display_name,
    'serial_no', ii.serial_no,
    'level', ii.level,
    'power', ii.power,
    'image_url', coalesce(cf.image_url, cm_hero.url, cm_card.url),
    'thumbnail_url', coalesce(cf.thumbnail_url, cm_thumb.url, cm_card.url),
    'avatar_url', coalesce(cf.avatar_url, cm_avatar.url, cm_thumb.url)
  ) order by dr.draw_index), '[]'::jsonb)
  into v_results
  from gacha.draw_results dr
  join catalog.collectible_templates ct on ct.id = dr.template_id
  join catalog.rarities r on r.code = dr.rarity_code
  left join catalog.collectible_forms cf on cf.id = dr.form_id
  left join inventory.item_instances ii on ii.id = dr.item_instance_id
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'hero'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_hero on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'card'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_card on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'thumb'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_thumb on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'avatar'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_avatar on true
  where dr.draw_order_id = v_order.id;

  return jsonb_build_object(
    'draw_order_id', v_order.id,
    'status', case when v_order.status = 'opened' then 'completed' else v_order.status end,
    'draw_count', v_order.draw_count,
    'quantity', v_order.quantity,
    'unit_price_stars', v_order.unit_price_stars,
    'discount_bps', v_order.discount_bps,
    'total_price_stars', v_order.total_price_stars,
    'open_reward_kcoin', v_order.open_reward_kcoin,
    'invoice_payload', v_order.invoice_payload,
    'paid_at', v_order.paid_at,
    'opened_at', v_order.opened_at,
    'completed_at', v_order.opened_at,
    'box', v_box,
    'payment', v_payment,
    'results', v_results,
    'server_time', now()
  );
end;
$$;


-- ============================================================
