-- Phase 6 payment ops: record every Telegram webhook before business handling.
--
-- This RPC is intentionally narrow: it stores the raw Telegram update and
-- lifecycle metadata, while existing payment RPCs keep owning payment
-- validation, idempotency and fulfillment.

begin;

create or replace function api.payment_record_telegram_webhook_received(
  p_update_id bigint,
  p_event_type text,
  p_telegram_user_id bigint default null,
  p_invoice_payload text default null,
  p_raw_update jsonb default '{}'::jsonb,
  p_request_headers_hash text default null,
  p_request_id text default null,
  p_webhook_secret_verified boolean default false,
  p_process_status text default 'received',
  p_error_message text default null,
  p_status_context jsonb default '{}'::jsonb,
  p_next_retry_at timestamptz default null,
  p_increment_retry_count boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event payments.telegram_webhook_events%rowtype;
  v_event_type text := nullif(trim(coalesce(p_event_type, '')), '');
  v_invoice_payload text := nullif(trim(coalesce(p_invoice_payload, '')), '');
  v_request_headers_hash text := nullif(trim(coalesce(p_request_headers_hash, '')), '');
  v_request_id text := nullif(trim(coalesce(p_request_id, '')), '');
  v_process_status text := lower(nullif(trim(coalesce(p_process_status, '')), ''));
  v_error_message text := nullif(left(trim(coalesce(p_error_message, '')), 500), '');
  v_status_context jsonb;
  v_inserted boolean := false;
  v_duplicate_update boolean := false;
  v_event_type_conflict boolean := false;
  v_reason_code text := null;
begin
  if v_event_type is null then
    raise exception 'event_type is required';
  end if;

  if v_process_status is null then
    v_process_status := 'received';
  end if;

  if v_process_status not in ('received', 'processing', 'processed', 'ignored', 'failed') then
    raise exception 'invalid webhook process_status: %', v_process_status;
  end if;

  v_status_context :=
    jsonb_strip_nulls(
      jsonb_build_object(
        'request_id', v_request_id,
        'source', 'api.payment_record_telegram_webhook_received',
        'event_type', v_event_type
      )
    )
    || coalesce(p_status_context, '{}'::jsonb);

  if p_update_id is null then
    insert into payments.telegram_webhook_events (
      update_id,
      event_type,
      telegram_user_id,
      invoice_payload,
      payload,
      process_status,
      processed_at,
      error_message,
      request_headers_hash,
      webhook_secret_verified,
      status_context,
      next_retry_at
    )
    values (
      null,
      v_event_type,
      p_telegram_user_id,
      v_invoice_payload,
      coalesce(p_raw_update, '{}'::jsonb),
      v_process_status,
      case when v_process_status in ('processed', 'ignored', 'failed') then now() else null end,
      v_error_message,
      v_request_headers_hash,
      p_webhook_secret_verified,
      v_status_context,
      p_next_retry_at
    )
    returning * into v_event;

    v_inserted := true;
  else
    insert into payments.telegram_webhook_events (
      update_id,
      event_type,
      telegram_user_id,
      invoice_payload,
      payload,
      process_status,
      processed_at,
      error_message,
      request_headers_hash,
      webhook_secret_verified,
      status_context,
      next_retry_at
    )
    values (
      p_update_id,
      v_event_type,
      p_telegram_user_id,
      v_invoice_payload,
      coalesce(p_raw_update, '{}'::jsonb),
      v_process_status,
      case when v_process_status in ('processed', 'ignored', 'failed') then now() else null end,
      v_error_message,
      v_request_headers_hash,
      p_webhook_secret_verified,
      v_status_context,
      p_next_retry_at
    )
    on conflict (update_id) do nothing
    returning * into v_event;

    v_inserted := v_event.id is not null;

    if not v_inserted then
      v_duplicate_update := true;

      select * into v_event
      from payments.telegram_webhook_events
      where update_id = p_update_id
      for update;

      if v_event.id is null then
        raise exception 'telegram webhook event not found after update_id conflict';
      end if;

      v_event_type_conflict := v_event.event_type <> v_event_type;

      if v_event_type_conflict then
        v_reason_code := 'UPDATE_ID_EVENT_TYPE_CONFLICT';
      end if;

      update payments.telegram_webhook_events
      set telegram_user_id = coalesce(p_telegram_user_id, telegram_user_id),
          invoice_payload = coalesce(v_invoice_payload, invoice_payload),
          payload = case
            when v_event_type_conflict then payload
            else coalesce(p_raw_update, payload)
          end,
          process_status = case
            when v_event_type_conflict then process_status
            when process_status in ('processed', 'processing') then process_status
            when v_process_status in ('ignored', 'failed') then v_process_status
            when process_status = 'ignored' and v_process_status = 'received' then process_status
            when process_status = 'failed' and v_process_status = 'received' then process_status
            else v_process_status
          end,
          processed_at = case
            when v_event_type_conflict then processed_at
            when process_status in ('processed', 'processing') then processed_at
            when v_process_status in ('ignored', 'failed') then now()
            else processed_at
          end,
          error_message = case
            when v_event_type_conflict then coalesce(error_message, 'Telegram update_id event type conflict.')
            when v_error_message is not null then v_error_message
            when v_process_status = 'received' then error_message
            else null
          end,
          request_headers_hash = coalesce(v_request_headers_hash, request_headers_hash),
          webhook_secret_verified = webhook_secret_verified or p_webhook_secret_verified,
          status_context = coalesce(status_context, '{}'::jsonb)
            || v_status_context
            || jsonb_strip_nulls(
              jsonb_build_object(
                'duplicate_update', true,
                'event_type_conflict', nullif(v_event_type_conflict, false),
                'last_seen_at', now()
              )
            ),
          next_retry_at = case
            when v_event_type_conflict then next_retry_at
            when v_process_status = 'failed' then p_next_retry_at
            when v_process_status in ('received', 'ignored', 'processed') then null
            else next_retry_at
          end,
          retry_count = retry_count + case when p_increment_retry_count then 1 else 0 end
      where id = v_event.id
      returning * into v_event;
    end if;
  end if;

  return jsonb_build_object(
    'event_id', v_event.id,
    'update_id', v_event.update_id,
    'event_type', v_event.event_type,
    'process_status', v_event.process_status,
    'telegram_user_id', v_event.telegram_user_id,
    'invoice_payload', v_event.invoice_payload,
    'webhook_secret_verified', v_event.webhook_secret_verified,
    'duplicate_update', v_duplicate_update,
    'event_type_conflict', v_event_type_conflict,
    'retry_count', v_event.retry_count,
    'reason_code', v_reason_code,
    'error_message', v_event.error_message
  );
end;
$$;

comment on function api.payment_record_telegram_webhook_received(
  bigint,
  text,
  bigint,
  text,
  jsonb,
  text,
  text,
  boolean,
  text,
  text,
  jsonb,
  timestamptz,
  boolean
) is 'Records a raw Telegram webhook event before payment business handling and updates retry/status metadata idempotently by update_id.';

revoke execute on function api.payment_record_telegram_webhook_received(
  bigint,
  text,
  bigint,
  text,
  jsonb,
  text,
  text,
  boolean,
  text,
  text,
  jsonb,
  timestamptz,
  boolean
) from public, anon, authenticated;

grant execute on function api.payment_record_telegram_webhook_received(
  bigint,
  text,
  bigint,
  text,
  jsonb,
  text,
  text,
  boolean,
  text,
  text,
  jsonb,
  timestamptz,
  boolean
) to service_role;

commit;
