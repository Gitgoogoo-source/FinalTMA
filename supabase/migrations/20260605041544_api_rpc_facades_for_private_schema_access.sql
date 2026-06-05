-- API RPC facades for private schema access.
--
-- Vercel Functions should only call the exposed api schema through Supabase
-- Data API. These facades keep payments, gacha and catalog table access behind
-- service-role-only RPCs, so private schemas do not need to be exposed.

begin;

create or replace function api.payment_get_star_order_for_invoice(
  p_star_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order payments.star_orders%rowtype;
begin
  if p_star_order_id is null then
    raise exception 'star_order_id is required';
  end if;

  select *
    into v_order
  from payments.star_orders
  where id = p_star_order_id;

  if v_order.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'user_id', v_order.user_id,
    'business_type', v_order.business_type,
    'business_id', v_order.business_id,
    'status', v_order.status,
    'xtr_amount', v_order.xtr_amount,
    'telegram_invoice_payload', v_order.telegram_invoice_payload,
    'title', v_order.title,
    'description', v_order.description,
    'expires_at', v_order.expires_at
  );
end;
$$;

create or replace function api.payment_get_star_invoice_by_payload(
  p_payload text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice payments.star_invoices%rowtype;
  v_payload text := nullif(trim(p_payload), '');
begin
  if v_payload is null then
    raise exception 'invoice payload is required';
  end if;

  select *
    into v_invoice
  from payments.star_invoices
  where payload = v_payload;

  if v_invoice.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'star_order_id', v_invoice.star_order_id,
    'invoice_link', v_invoice.invoice_link,
    'payload', v_invoice.payload,
    'status', v_invoice.status,
    'open_mode', v_invoice.open_mode,
    'bot_api_method', v_invoice.bot_api_method,
    'expires_at', v_invoice.expires_at
  );
end;
$$;

create or replace function api.payment_upsert_star_invoice_success(
  p_star_order_id uuid,
  p_payload text,
  p_invoice_link text,
  p_open_mode text,
  p_expires_at timestamptz,
  p_raw_request jsonb,
  p_raw_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice payments.star_invoices%rowtype;
  v_payload text := nullif(trim(p_payload), '');
  v_invoice_link text := nullif(trim(p_invoice_link), '');
  v_open_mode text := coalesce(nullif(trim(p_open_mode), ''), 'web_app_open_invoice');
begin
  if p_star_order_id is null then
    raise exception 'star_order_id is required';
  end if;
  if v_payload is null then
    raise exception 'invoice payload is required';
  end if;
  if v_invoice_link is null then
    raise exception 'invoice link is required';
  end if;
  if v_open_mode not in ('telegram_link', 'web_app_open_invoice', 'bot_api', 'unknown') then
    raise exception 'invoice open_mode is invalid';
  end if;

  insert into payments.star_invoices (
    star_order_id,
    invoice_link,
    payload,
    status,
    open_mode,
    bot_api_method,
    expires_at,
    raw_request,
    raw_response
  ) values (
    p_star_order_id,
    v_invoice_link,
    v_payload,
    'created',
    v_open_mode,
    'createInvoiceLink',
    p_expires_at,
    coalesce(p_raw_request, '{}'::jsonb),
    coalesce(p_raw_response, '{}'::jsonb)
  )
  on conflict (payload) do update
  set star_order_id = excluded.star_order_id,
      invoice_link = excluded.invoice_link,
      status = excluded.status,
      open_mode = excluded.open_mode,
      bot_api_method = excluded.bot_api_method,
      expires_at = excluded.expires_at,
      raw_request = excluded.raw_request,
      raw_response = excluded.raw_response,
      updated_at = now()
  returning * into v_invoice;

  return jsonb_build_object(
    'star_order_id', v_invoice.star_order_id,
    'invoice_link', v_invoice.invoice_link,
    'payload', v_invoice.payload,
    'status', v_invoice.status,
    'open_mode', v_invoice.open_mode,
    'bot_api_method', v_invoice.bot_api_method,
    'expires_at', v_invoice.expires_at
  );
end;
$$;

create or replace function api.payment_record_star_invoice_failure(
  p_star_order_id uuid,
  p_draw_order_id uuid,
  p_payload text,
  p_open_mode text,
  p_expires_at timestamptz,
  p_raw_request jsonb,
  p_raw_response jsonb,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice payments.star_invoices%rowtype;
  v_payload text := nullif(trim(p_payload), '');
  v_open_mode text := coalesce(nullif(trim(p_open_mode), ''), 'web_app_open_invoice');
  v_error_message text := left(trim(coalesce(p_error_message, 'Telegram Stars invoice failed.')), 500);
begin
  if p_star_order_id is null then
    raise exception 'star_order_id is required';
  end if;
  if p_draw_order_id is null then
    raise exception 'draw_order_id is required';
  end if;
  if v_payload is null then
    raise exception 'invoice payload is required';
  end if;
  if v_open_mode not in ('telegram_link', 'web_app_open_invoice', 'bot_api', 'unknown') then
    raise exception 'invoice open_mode is invalid';
  end if;

  insert into payments.star_invoices (
    star_order_id,
    invoice_link,
    payload,
    status,
    open_mode,
    bot_api_method,
    expires_at,
    raw_request,
    raw_response
  ) values (
    p_star_order_id,
    null,
    v_payload,
    'failed',
    v_open_mode,
    'createInvoiceLink',
    p_expires_at,
    coalesce(p_raw_request, '{}'::jsonb),
    coalesce(p_raw_response, '{}'::jsonb)
  )
  on conflict (payload) do update
  set star_order_id = excluded.star_order_id,
      invoice_link = null,
      status = excluded.status,
      open_mode = excluded.open_mode,
      bot_api_method = excluded.bot_api_method,
      expires_at = excluded.expires_at,
      raw_request = excluded.raw_request,
      raw_response = excluded.raw_response,
      updated_at = now()
  returning * into v_invoice;

  update payments.star_orders
  set status = 'failed',
      error_message = v_error_message,
      updated_at = now()
  where id = p_star_order_id;

  update gacha.draw_orders
  set status = 'failed',
      payment_status = 'failed',
      telegram_invoice_payload = v_payload,
      error_message = v_error_message,
      updated_at = now()
  where id = p_draw_order_id;

  return jsonb_build_object(
    'star_order_id', v_invoice.star_order_id,
    'payload', v_invoice.payload,
    'status', v_invoice.status,
    'open_mode', v_invoice.open_mode,
    'bot_api_method', v_invoice.bot_api_method,
    'expires_at', v_invoice.expires_at
  );
end;
$$;

create or replace function api.payment_mark_order_invoice_created(
  p_star_order_id uuid,
  p_draw_order_id uuid,
  p_invoice_payload text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload text := nullif(trim(p_invoice_payload), '');
begin
  if p_star_order_id is null then
    raise exception 'star_order_id is required';
  end if;
  if p_draw_order_id is null then
    raise exception 'draw_order_id is required';
  end if;
  if v_payload is null then
    raise exception 'invoice payload is required';
  end if;

  update payments.star_orders
  set error_message = null,
      updated_at = now()
  where id = p_star_order_id;

  update gacha.draw_orders
  set status = 'invoice_created',
      payment_status = 'pending',
      telegram_invoice_payload = v_payload,
      error_message = null,
      updated_at = now()
  where id = p_draw_order_id;

  return jsonb_build_object(
    'star_order_id', p_star_order_id,
    'draw_order_id', p_draw_order_id,
    'invoice_payload', v_payload
  );
end;
$$;

create or replace function api.payment_mark_webhook_event_failed(
  p_event_id uuid,
  p_error_message text,
  p_processed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event payments.telegram_webhook_events%rowtype;
  v_error_message text := left(trim(coalesce(p_error_message, 'Telegram webhook processing failed.')), 500);
begin
  if p_event_id is null then
    raise exception 'event_id is required';
  end if;

  update payments.telegram_webhook_events
  set process_status = 'failed',
      error_message = v_error_message,
      processed_at = coalesce(p_processed_at, now())
  where id = p_event_id
  returning * into v_event;

  if v_event.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'event_id', v_event.id,
    'process_status', v_event.process_status,
    'processed_at', v_event.processed_at
  );
end;
$$;

create or replace function api.gacha_count_recent_draw_orders(
  p_user_id uuid,
  p_since timestamptz
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*)::integer
  )
  from gacha.draw_orders
  where user_id = p_user_id
    and created_at >= p_since;
$$;

create or replace function api.catalog_list_banner_campaigns(
  p_placement text,
  p_limit integer default 20
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', row_data.id,
      'code', row_data.code,
      'title', row_data.title,
      'description', row_data.description,
      'image_url', row_data.image_url,
      'placement', row_data.placement,
      'target_type', row_data.target_type,
      'target_ref', row_data.target_ref,
      'target_payload', row_data.target_payload,
      'sort_order', row_data.sort_order,
      'starts_at', row_data.starts_at,
      'ends_at', row_data.ends_at,
      'created_at', row_data.created_at,
      'updated_at', row_data.updated_at
    )
    order by row_data.sort_order asc, row_data.created_at desc
  ), '[]'::jsonb)
  from (
    select
      id,
      code,
      title,
      description,
      image_url,
      placement,
      target_type,
      target_ref,
      target_payload,
      sort_order,
      starts_at,
      ends_at,
      created_at,
      updated_at
    from catalog.banner_campaigns
    where placement = p_placement
      and status = 'active'
    order by sort_order asc, created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) as row_data;
$$;

revoke all on function api.payment_get_star_order_for_invoice(uuid)
  from public, anon, authenticated;
revoke all on function api.payment_get_star_invoice_by_payload(text)
  from public, anon, authenticated;
revoke all on function api.payment_upsert_star_invoice_success(uuid, text, text, text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function api.payment_record_star_invoice_failure(uuid, uuid, text, text, timestamptz, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function api.payment_mark_order_invoice_created(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function api.payment_mark_webhook_event_failed(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function api.gacha_count_recent_draw_orders(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function api.catalog_list_banner_campaigns(text, integer)
  from public, anon, authenticated;

grant execute on function api.payment_get_star_order_for_invoice(uuid)
  to service_role;
grant execute on function api.payment_get_star_invoice_by_payload(text)
  to service_role;
grant execute on function api.payment_upsert_star_invoice_success(uuid, text, text, text, timestamptz, jsonb, jsonb)
  to service_role;
grant execute on function api.payment_record_star_invoice_failure(uuid, uuid, text, text, timestamptz, jsonb, jsonb, text)
  to service_role;
grant execute on function api.payment_mark_order_invoice_created(uuid, uuid, text)
  to service_role;
grant execute on function api.payment_mark_webhook_event_failed(uuid, text, timestamptz)
  to service_role;
grant execute on function api.gacha_count_recent_draw_orders(uuid, timestamptz)
  to service_role;
grant execute on function api.catalog_list_banner_campaigns(text, integer)
  to service_role;

comment on function api.payment_get_star_order_for_invoice(uuid) is
  'Service-role facade for reading a Stars payment order before creating a Telegram invoice.';
comment on function api.payment_get_star_invoice_by_payload(text) is
  'Service-role facade for idempotent Stars invoice lookup by payload.';
comment on function api.payment_upsert_star_invoice_success(uuid, text, text, text, timestamptz, jsonb, jsonb) is
  'Service-role facade for saving a successfully created Telegram Stars invoice.';
comment on function api.payment_record_star_invoice_failure(uuid, uuid, text, text, timestamptz, jsonb, jsonb, text) is
  'Service-role facade for saving invoice creation failure and marking the draw/payment orders failed.';
comment on function api.payment_mark_order_invoice_created(uuid, uuid, text) is
  'Service-role facade for marking a draw order invoice-created after an invoice link exists.';
comment on function api.payment_mark_webhook_event_failed(uuid, text, timestamptz) is
  'Service-role facade for marking Telegram webhook processing failures.';
comment on function api.gacha_count_recent_draw_orders(uuid, timestamptz) is
  'Service-role facade for high-frequency gacha order risk checks.';
comment on function api.catalog_list_banner_campaigns(text, integer) is
  'Service-role facade for listing active banner campaigns without exposing catalog schema through Data API.';

commit;
