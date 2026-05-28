-- Phase 5 step 07: fulfill Telegram Stars successful_payment orders.
--
-- This keeps api.gacha_process_paid_order as the public service-role entrypoint
-- and hardens the internal fulfillment transaction used by the existing task
-- progress wrapper. The function is intentionally retryable: duplicate calls
-- with the same successful_payment charge return the existing draw result,
-- while failed fulfillment attempts leave the paid order in a retryable failed
-- state and write an ops.risk_events row.

begin;

alter table payments.telegram_webhook_events
  add column if not exists status_context jsonb;

update payments.telegram_webhook_events
set status_context = '{}'::jsonb
where status_context is null;

alter table payments.telegram_webhook_events
  alter column status_context set default '{}'::jsonb,
  alter column status_context set not null;

comment on column payments.telegram_webhook_events.status_context is
  'Structured backend processing context, including fulfillment result details for successful_payment events.';

create or replace function api.gacha_process_paid_order_without_task_progress(
  p_star_order_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_raw_update jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_star_order payments.star_orders%rowtype;
  v_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_existing_payment payments.star_payments%rowtype;
  v_pity record;
  v_use_pity boolean;
  v_reward record;
  v_total_weight numeric(38,8);
  v_roll numeric(38,8);
  v_form_id uuid;
  v_power integer;
  v_item_id uuid;
  v_should_reset boolean;
  v_reward_kcoin numeric(38,0);
  v_results jsonb := '[]'::jsonb;
  v_credit jsonb;
  v_referral_first_open jsonb;
  v_referral_commission jsonb;
  v_referral_commission_setting jsonb;
  v_referral_commission_bps integer;
  v_draw_i integer;
  v_rows integer;
  v_existing_results_count integer := 0;
  v_charge_id text := nullif(trim(coalesce(p_telegram_payment_charge_id, '')), '');
  v_provider_charge_id text := nullif(trim(coalesce(p_provider_payment_charge_id, '')), '');
  v_raw_update jsonb := coalesce(p_raw_update, '{}'::jsonb);
  v_update_id bigint;
  v_failure_reason text;
  v_failure_message text;
  v_failure_detail text;
  v_failure_hint text;
  v_mark_order_failed boolean := true;
  v_duration_ms integer := 0;
begin
  if jsonb_typeof(v_raw_update) = 'object'
     and (v_raw_update ->> 'update_id') ~ '^[0-9]+$' then
    v_update_id := (v_raw_update ->> 'update_id')::bigint;
  end if;

  if p_star_order_id is null or v_charge_id is null then
    raise exception 'star_order_id and telegram_payment_charge_id are required';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  if v_star_order.id is null then
    insert into ops.risk_events (
      user_id,
      event_type,
      severity,
      status,
      source_type,
      source_id,
      detail
    ) values (
      null,
      'gacha_fulfillment_star_order_missing',
      'high',
      'open',
      'star_order',
      p_star_order_id,
      jsonb_build_object(
        'reason_code', 'STAR_ORDER_NOT_FOUND',
        'telegram_payment_charge_id', v_charge_id,
        'update_id', v_update_id
      )
    );

    if v_update_id is not null then
      v_duration_ms := greatest(
        floor(extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000)::integer,
        0
      );

      update payments.telegram_webhook_events
      set process_status = 'failed',
          processed_at = now(),
          processing_duration_ms = v_duration_ms,
          retry_count = retry_count + 1,
          next_retry_at = coalesce(next_retry_at, now() + interval '5 minutes'),
          error_message = 'STAR_ORDER_NOT_FOUND: Stars order not found for fulfillment.',
          status_context = coalesce(status_context, '{}'::jsonb) || jsonb_build_object(
            'fulfillment',
            jsonb_strip_nulls(jsonb_build_object(
              'status', 'failed',
              'reason_code', 'STAR_ORDER_NOT_FOUND',
              'error_message', 'Stars order not found for fulfillment.',
              'retryable', true,
              'star_order_id', p_star_order_id,
              'telegram_payment_charge_id', v_charge_id,
              'processed_at', now()
            ))
          )
      where update_id = v_update_id
        and event_type = 'successful_payment';
    end if;

    return jsonb_build_object(
      'fulfilled', false,
      'idempotent', false,
      'retryable', true,
      'status', 'failed',
      'reason_code', 'STAR_ORDER_NOT_FOUND',
      'error_message', 'Stars order not found for fulfillment.',
      'star_order_id', p_star_order_id,
      'draw_order_id', null,
      'telegram_payment_charge_id', v_charge_id,
      'payment_order_status', null
    );
  end if;

  select * into v_order
  from gacha.draw_orders
  where payment_star_order_id = p_star_order_id
  for update;

  if v_order.id is null then
    v_failure_reason := 'DRAW_ORDER_NOT_FOUND';
    v_failure_message := 'Draw order not found for Stars order.';
  end if;

  if v_order.id is not null then
    select count(*)::integer
    into v_existing_results_count
    from gacha.draw_results
    where draw_order_id = v_order.id;
  end if;

  if v_order.status in ('opened', 'completed') then
    select * into v_existing_payment
    from payments.star_payments
    where telegram_payment_charge_id = v_charge_id
    for update;

    if v_existing_payment.id is null
       or v_existing_payment.star_order_id <> p_star_order_id then
      insert into ops.risk_events (
        user_id,
        event_type,
        severity,
        status,
        source_type,
        source_id,
        detail
      ) values (
        v_star_order.user_id,
        'gacha_fulfillment_duplicate_or_conflicting_charge',
        'medium',
        'open',
        'star_order',
        p_star_order_id,
        jsonb_build_object(
          'reason_code', 'ORDER_ALREADY_FULFILLED',
          'telegram_payment_charge_id', v_charge_id,
          'existing_star_payment_id', v_existing_payment.id,
          'existing_star_order_id', v_existing_payment.star_order_id,
          'draw_order_id', v_order.id,
          'update_id', v_update_id
        )
      );

      if v_update_id is not null then
        v_duration_ms := greatest(
          floor(extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000)::integer,
          0
        );

        update payments.telegram_webhook_events
        set process_status = 'failed',
            processed_at = now(),
            processing_duration_ms = v_duration_ms,
            next_retry_at = null,
            error_message = 'ORDER_ALREADY_FULFILLED: fulfilled order received a different payment charge.',
            status_context = coalesce(status_context, '{}'::jsonb) || jsonb_build_object(
              'fulfillment',
              jsonb_strip_nulls(jsonb_build_object(
                'status', 'failed',
                'reason_code', 'ORDER_ALREADY_FULFILLED',
                'error_message', 'Fulfilled order cannot accept a different payment charge.',
                'retryable', false,
                'star_order_id', p_star_order_id,
                'draw_order_id', v_order.id,
                'telegram_payment_charge_id', v_charge_id,
                'processed_at', now()
              ))
            )
        where update_id = v_update_id
          and event_type = 'successful_payment';
      end if;

      return jsonb_build_object(
        'fulfilled', false,
        'idempotent', false,
        'retryable', false,
        'status', 'failed',
        'reason_code', 'ORDER_ALREADY_FULFILLED',
        'error_message', 'Fulfilled order cannot accept a different payment charge.',
        'star_order_id', p_star_order_id,
        'draw_order_id', v_order.id,
        'telegram_payment_charge_id', v_charge_id,
        'payment_order_status', v_star_order.status,
        'result_count', v_existing_results_count
      );
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'draw_index', dr.draw_index,
      'template_id', dr.template_id,
      'form_id', dr.form_id,
      'rarity_code', dr.rarity_code,
      'item_instance_id', dr.item_instance_id,
      'was_pity', dr.was_pity
    ) order by dr.draw_index), '[]'::jsonb)
    into v_results
    from gacha.draw_results dr
    where dr.draw_order_id = v_order.id;

    update payments.star_orders
    set status = 'fulfilled',
        fulfilled_at = coalesce(fulfilled_at, now()),
        error_message = null,
        updated_at = now()
    where id = p_star_order_id
    returning * into v_star_order;

    if v_update_id is not null then
      v_duration_ms := greatest(
        floor(extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000)::integer,
        0
      );

      update payments.telegram_webhook_events
      set process_status = 'processed',
          processed_at = coalesce(processed_at, now()),
          processing_duration_ms = v_duration_ms,
          next_retry_at = null,
          error_message = null,
          status_context = coalesce(status_context, '{}'::jsonb) || jsonb_build_object(
            'fulfillment',
            jsonb_strip_nulls(jsonb_build_object(
              'status', 'fulfilled',
              'idempotent', true,
              'retryable', false,
              'star_order_id', p_star_order_id,
              'draw_order_id', v_order.id,
              'result_count', v_existing_results_count,
              'telegram_payment_charge_id', v_charge_id,
              'processed_at', now()
            ))
          )
      where update_id = v_update_id
        and event_type = 'successful_payment';
    end if;

    return jsonb_build_object(
      'fulfilled', true,
      'idempotent', true,
      'retryable', false,
      'star_order_id', p_star_order_id,
      'draw_order_id', v_order.id,
      'status', 'completed',
      'draw_count', v_order.draw_count,
      'quantity', v_order.quantity,
      'results', v_results,
      'result_count', jsonb_array_length(v_results),
      'telegram_payment_charge_id', v_charge_id,
      'payment_order_status', v_star_order.status
    );
  end if;

  if v_failure_reason is null and v_star_order.business_type <> 'gacha_open' then
    v_failure_reason := 'BUSINESS_TYPE_INVALID';
    v_failure_message := 'Stars order business type is not gacha_open.';
  end if;

  if v_failure_reason is null
     and v_star_order.business_id is not null
     and v_order.id is not null
     and v_star_order.business_id <> v_order.id then
    v_failure_reason := 'BUSINESS_ORDER_MISMATCH';
    v_failure_message := 'Stars order business_id does not match draw order.';
  end if;

  if v_failure_reason is null
     and v_order.id is not null
     and v_star_order.user_id <> v_order.user_id then
    v_failure_reason := 'ORDER_USER_MISMATCH';
    v_failure_message := 'Stars order user does not match draw order user.';
  end if;

  if v_failure_reason is null
     and v_order.id is not null
     and v_star_order.xtr_amount <> v_order.total_price_stars then
    v_failure_reason := 'AMOUNT_MISMATCH';
    v_failure_message := 'Stars order amount does not match draw order amount.';
  end if;

  if v_failure_reason is null
     and v_order.id is not null
     and v_star_order.telegram_invoice_payload is distinct from v_order.invoice_payload then
    v_failure_reason := 'INVOICE_PAYLOAD_MISMATCH';
    v_failure_message := 'Stars order invoice payload does not match draw order payload.';
  end if;

  if v_failure_reason is null
     and v_order.id is not null
     and not exists (
       select 1
       from gacha.drop_pool_versions dpv
       where dpv.id = v_order.pool_version_id
         and dpv.box_id = v_order.box_id
     ) then
    v_failure_reason := 'DROP_POOL_VERSION_MISMATCH';
    v_failure_message := 'Draw order drop pool version does not belong to the blind box.';
  end if;

  if v_failure_reason is null
     and v_star_order.status not in (
       'created',
       'invoice_created',
       'precheckout_ok',
       'precheckout_checked',
       'paid',
       'fulfilling',
       'failed'
     ) then
    v_failure_reason := 'ORDER_STATUS_NOT_FULFILLABLE';
    v_failure_message := 'Stars order status is not fulfillable.';
    v_mark_order_failed := false;
  end if;

  if v_failure_reason is null
     and v_order.status not in ('created', 'invoice_created', 'paid', 'opening', 'failed') then
    v_failure_reason := 'DRAW_ORDER_STATUS_NOT_FULFILLABLE';
    v_failure_message := 'Draw order status is not fulfillable.';
    v_mark_order_failed := false;
  end if;

  if v_failure_reason is null and v_existing_results_count > 0 then
    v_failure_reason := 'PARTIAL_FULFILLMENT_STATE';
    v_failure_message := 'Draw order has results but is not completed.';
  end if;

  if v_failure_reason is null then
    select * into v_existing_payment
    from payments.star_payments
    where telegram_payment_charge_id = v_charge_id
    for update;

    if v_existing_payment.id is not null
       and v_existing_payment.star_order_id <> p_star_order_id then
      v_failure_reason := 'PAYMENT_CHARGE_CONFLICT';
      v_failure_message := 'Telegram payment charge id is already bound to another Stars order.';
      v_mark_order_failed := false;
    elsif v_existing_payment.id is not null
       and v_existing_payment.invoice_payload is distinct from v_star_order.telegram_invoice_payload then
      v_failure_reason := 'PAYMENT_PAYLOAD_MISMATCH';
      v_failure_message := 'Recorded Stars payment payload does not match the order payload.';
    end if;
  end if;

  if v_failure_reason is not null then
    if v_mark_order_failed then
      update payments.star_orders
      set status = 'failed',
          error_message = left(v_failure_message, 1000),
          updated_at = now()
      where id = p_star_order_id
        and status not in ('fulfilled', 'refunded', 'disputed')
      returning * into v_star_order;

      if v_order.id is not null then
        update gacha.draw_orders
        set status = 'failed',
            payment_status = case
              when payment_status in ('paid', 'dev_paid') then payment_status
              else 'failed'
            end,
            error_message = left(v_failure_message, 1000),
            updated_at = now()
        where id = v_order.id
          and status not in ('opened', 'completed');
      end if;
    end if;

    insert into ops.risk_events (
      user_id,
      event_type,
      severity,
      status,
      source_type,
      source_id,
      detail
    ) values (
      v_star_order.user_id,
      'gacha_fulfillment_validation_failed',
      case
        when v_failure_reason in ('PAYMENT_CHARGE_CONFLICT', 'PARTIAL_FULFILLMENT_STATE') then 'high'
        else 'medium'
      end,
      'open',
      'star_order',
      p_star_order_id,
      jsonb_build_object(
        'reason_code', v_failure_reason,
        'error_message', v_failure_message,
        'telegram_payment_charge_id', v_charge_id,
        'existing_star_payment_id', v_existing_payment.id,
        'existing_payment_star_order_id', v_existing_payment.star_order_id,
        'draw_order_id', v_order.id,
        'draw_order_status', v_order.status,
        'star_order_status', v_star_order.status,
        'update_id', v_update_id
      )
    );

    if v_update_id is not null then
      v_duration_ms := greatest(
        floor(extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000)::integer,
        0
      );

      update payments.telegram_webhook_events
      set user_id = coalesce(v_star_order.user_id, user_id),
          process_status = 'failed',
          processed_at = now(),
          processing_duration_ms = v_duration_ms,
          retry_count = case when v_mark_order_failed then retry_count + 1 else retry_count end,
          next_retry_at = case
            when v_mark_order_failed then coalesce(next_retry_at, now() + interval '5 minutes')
            else null
          end,
          error_message = left(v_failure_reason || ': ' || v_failure_message, 1000),
          status_context = coalesce(status_context, '{}'::jsonb) || jsonb_build_object(
            'fulfillment',
            jsonb_strip_nulls(jsonb_build_object(
              'status', 'failed',
              'reason_code', v_failure_reason,
              'error_message', v_failure_message,
              'retryable', v_mark_order_failed,
              'star_order_id', p_star_order_id,
              'draw_order_id', v_order.id,
              'result_count', v_existing_results_count,
              'telegram_payment_charge_id', v_charge_id,
              'processed_at', now()
            ))
          )
      where update_id = v_update_id
        and event_type = 'successful_payment';
    end if;

    return jsonb_build_object(
      'fulfilled', false,
      'idempotent', false,
      'retryable', v_mark_order_failed,
      'status', 'failed',
      'reason_code', v_failure_reason,
      'error_message', v_failure_message,
      'star_order_id', p_star_order_id,
      'draw_order_id', v_order.id,
      'telegram_payment_charge_id', v_charge_id,
      'payment_order_status', v_star_order.status,
      'result_count', v_existing_results_count
    );
  end if;

  if v_existing_payment.id is null then
    insert into payments.star_payments (
      star_order_id,
      user_id,
      telegram_payment_charge_id,
      provider_payment_charge_id,
      xtr_amount,
      currency,
      invoice_payload,
      raw_update
    ) values (
      p_star_order_id,
      v_order.user_id,
      v_charge_id,
      v_provider_charge_id,
      v_star_order.xtr_amount,
      'XTR',
      v_star_order.telegram_invoice_payload,
      v_raw_update
    )
    on conflict (telegram_payment_charge_id) do nothing
    returning * into v_existing_payment;

    if v_existing_payment.id is null then
      select * into v_existing_payment
      from payments.star_payments
      where telegram_payment_charge_id = v_charge_id
      for update;
    end if;

    if v_existing_payment.id is null
       or v_existing_payment.star_order_id <> p_star_order_id then
      insert into ops.risk_events (
        user_id,
        event_type,
        severity,
        status,
        source_type,
        source_id,
        detail
      ) values (
        v_star_order.user_id,
        'gacha_fulfillment_payment_insert_conflict',
        'high',
        'open',
        'star_order',
        p_star_order_id,
        jsonb_build_object(
          'reason_code', 'PAYMENT_INSERT_CONFLICT',
          'telegram_payment_charge_id', v_charge_id,
          'existing_star_payment_id', v_existing_payment.id,
          'existing_payment_star_order_id', v_existing_payment.star_order_id,
          'draw_order_id', v_order.id,
          'update_id', v_update_id
        )
      );

      if v_update_id is not null then
        v_duration_ms := greatest(
          floor(extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000)::integer,
          0
        );

        update payments.telegram_webhook_events
        set process_status = 'failed',
            processed_at = now(),
            processing_duration_ms = v_duration_ms,
            retry_count = retry_count + 1,
            next_retry_at = coalesce(next_retry_at, now() + interval '5 minutes'),
            error_message = 'PAYMENT_INSERT_CONFLICT: successful payment row conflicted during fulfillment.',
            status_context = coalesce(status_context, '{}'::jsonb) || jsonb_build_object(
              'fulfillment',
              jsonb_strip_nulls(jsonb_build_object(
                'status', 'failed',
                'reason_code', 'PAYMENT_INSERT_CONFLICT',
                'error_message', 'Successful payment row conflicted during fulfillment.',
                'retryable', true,
                'star_order_id', p_star_order_id,
                'draw_order_id', v_order.id,
                'telegram_payment_charge_id', v_charge_id,
                'processed_at', now()
              ))
            )
        where update_id = v_update_id
          and event_type = 'successful_payment';
      end if;

      return jsonb_build_object(
        'fulfilled', false,
        'idempotent', false,
        'retryable', true,
        'status', 'failed',
        'reason_code', 'PAYMENT_INSERT_CONFLICT',
        'error_message', 'Successful payment row conflicted during fulfillment.',
        'star_order_id', p_star_order_id,
        'draw_order_id', v_order.id,
        'telegram_payment_charge_id', v_charge_id,
        'payment_order_status', v_star_order.status,
        'result_count', v_existing_results_count
      );
    end if;
  end if;

  update payments.star_orders
  set status = 'fulfilling',
      paid_at = coalesce(paid_at, v_existing_payment.paid_at, now()),
      error_message = null,
      updated_at = now()
  where id = p_star_order_id
  returning * into v_star_order;

  update gacha.draw_orders
  set status = 'opening',
      paid_at = coalesce(paid_at, v_existing_payment.paid_at, now()),
      telegram_payment_charge_id = coalesce(telegram_payment_charge_id, v_charge_id),
      payment_provider = case
        when v_provider_charge_id = 'dev-paid' or v_charge_id like 'dev:%' then 'dev'
        else 'telegram_stars'
      end,
      payment_status = case
        when v_provider_charge_id = 'dev-paid' or v_charge_id like 'dev:%' then 'dev_paid'
        else 'paid'
      end,
      error_message = null,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  if v_update_id is not null then
    update payments.telegram_webhook_events
    set user_id = coalesce(v_star_order.user_id, user_id),
        invoice_payload = coalesce(invoice_payload, v_star_order.telegram_invoice_payload),
        process_status = 'processing',
        processed_at = null,
        error_message = null,
        status_context = coalesce(status_context, '{}'::jsonb) || jsonb_build_object(
          'fulfillment',
          jsonb_strip_nulls(jsonb_build_object(
            'status', 'fulfilling',
            'star_order_id', p_star_order_id,
            'draw_order_id', v_order.id,
            'telegram_payment_charge_id', v_charge_id,
            'started_at', now()
          ))
        )
    where update_id = v_update_id
      and event_type = 'successful_payment';
  end if;

  begin
    select * into v_box
    from gacha.blind_boxes
    where id = v_order.box_id
    for update;

    if v_box.id is null then
      raise exception 'blind box not found for paid draw order';
    end if;

    if v_box.remaining_stock is not null and v_box.remaining_stock < v_order.draw_count then
      raise exception 'blind box stock is insufficient after payment';
    end if;

    if v_box.remaining_stock is not null then
      update gacha.blind_boxes
      set remaining_stock = remaining_stock - v_order.draw_count,
          status = case when remaining_stock - v_order.draw_count <= 0 then 'sold_out' else status end,
          updated_at = now()
      where id = v_box.id
        and remaining_stock >= v_order.draw_count;

      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'blind box stock changed during fulfillment';
      end if;
    end if;

    for v_draw_i in 1..v_order.draw_count loop
      select null::uuid as id into v_reward;
      select null::uuid as id, 0::integer as current_count into v_pity;
      v_use_pity := false;

      select pr.*, coalesce(ups.current_count, 0) as current_count
      into v_pity
      from gacha.pity_rules pr
      left join gacha.user_pity_states ups
        on ups.pity_rule_id = pr.id and ups.user_id = v_order.user_id and ups.box_id = v_order.box_id
      where pr.box_id = v_order.box_id
        and pr.active = true
        and (pr.pool_version_id is null or pr.pool_version_id = v_order.pool_version_id)
      order by pr.priority asc, pr.created_at asc
      limit 1;

      if v_pity.id is not null then
        insert into gacha.user_pity_states (user_id, box_id, pity_rule_id, current_count, total_draws)
        values (v_order.user_id, v_order.box_id, v_pity.id, 0, 0)
        on conflict (user_id, box_id, pity_rule_id) do nothing;

        select pr.*, ups.current_count
        into v_pity
        from gacha.pity_rules pr
        join gacha.user_pity_states ups
          on ups.pity_rule_id = pr.id and ups.user_id = v_order.user_id and ups.box_id = v_order.box_id
        where pr.id = v_pity.id
        for update of ups;

        v_use_pity := (v_pity.current_count + 1 >= v_pity.threshold);
      end if;

      if v_use_pity and v_pity.guaranteed_template_id is not null then
        select dpi.* into v_reward
        from gacha.drop_pool_items dpi
        where dpi.pool_version_id = v_order.pool_version_id
          and dpi.template_id = v_pity.guaranteed_template_id
          and (v_pity.guaranteed_form_id is null or dpi.form_id = v_pity.guaranteed_form_id)
          and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
        order by dpi.sort_order asc, random()
        limit 1
        for update of dpi;
      elsif v_use_pity then
        select dpi.* into v_reward
        from gacha.drop_pool_items dpi
        join catalog.rarities rr on rr.code = dpi.rarity_code
        join catalog.rarities target on target.code = v_pity.target_rarity_code
        where dpi.pool_version_id = v_order.pool_version_id
          and dpi.is_pity_eligible = true
          and rr.sort_order >= target.sort_order
          and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
        order by rr.sort_order desc, dpi.drop_weight desc, random()
        limit 1
        for update of dpi;
      end if;

      if v_reward.id is null then
        select coalesce(sum(drop_weight), 0) into v_total_weight
        from gacha.drop_pool_items
        where pool_version_id = v_order.pool_version_id
          and (stock_remaining is null or stock_remaining > 0);

        if v_total_weight <= 0 then
          raise exception 'drop pool has no available rewards';
        end if;

        v_roll := (random()::numeric * v_total_weight);

        select x.* into v_reward
        from (
          select dpi.*,
                 sum(dpi.drop_weight) over (order by dpi.sort_order asc, dpi.id asc) as running_weight
          from gacha.drop_pool_items dpi
          where dpi.pool_version_id = v_order.pool_version_id
            and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
        ) x
        where x.running_weight >= v_roll
        order by x.running_weight asc
        limit 1;

        if v_reward.id is not null then
          perform 1
          from gacha.drop_pool_items dpi
          where dpi.id = v_reward.id
          for update;
        end if;
      else
        v_roll := null;
      end if;

      if v_reward.id is null then
        raise exception 'failed to select reward';
      end if;

      if v_reward.stock_remaining is not null then
        update gacha.drop_pool_items
        set stock_remaining = stock_remaining - 1,
            updated_at = now()
        where id = v_reward.id
          and stock_remaining > 0;

        get diagnostics v_rows = row_count;
        if v_rows <> 1 then
          raise exception 'drop pool item stock changed during fulfillment';
        end if;
      end if;

      v_form_id := v_reward.form_id;
      if v_form_id is null then
        select id into v_form_id
        from catalog.collectible_forms
        where template_id = v_reward.template_id
        order by is_default desc, form_index asc
        limit 1;
      end if;

      select ct.base_power + coalesce(cf.base_power_bonus, 0)
      into v_power
      from catalog.collectible_templates ct
      left join catalog.collectible_forms cf on cf.id = v_form_id
      where ct.id = v_reward.template_id;

      insert into inventory.item_instances (
        owner_user_id, template_id, form_id, level, power, status,
        source_type, source_id, metadata
      ) values (
        v_order.user_id, v_reward.template_id, v_form_id, 1, coalesce(v_power, 0), 'available',
        'gacha', v_order.id,
        jsonb_build_object('box_id', v_order.box_id, 'draw_order_id', v_order.id, 'drop_pool_item_id', v_reward.id)
      ) returning id into v_item_id;

      insert into inventory.item_instance_events (
        item_instance_id, user_id, event_type, source_type, source_id, after_state
      ) values (
        v_item_id, v_order.user_id, 'obtained_from_gacha', 'gacha', v_order.id,
        jsonb_build_object('template_id', v_reward.template_id, 'form_id', v_form_id, 'rarity_code', v_reward.rarity_code)
      );

      insert into album.user_discoveries (
        user_id, template_id, first_item_instance_id, first_source_type, first_source_id
      ) values (
        v_order.user_id, v_reward.template_id, v_item_id, 'gacha', v_order.id
      ) on conflict (user_id, template_id) do nothing;

      insert into gacha.draw_results (
        draw_order_id, user_id, box_id, pool_version_id, draw_index,
        drop_pool_item_id, item_instance_id, template_id, form_id, rarity_code,
        was_pity, random_roll, metadata
      ) values (
        v_order.id, v_order.user_id, v_order.box_id, v_order.pool_version_id, v_draw_i,
        v_reward.id, v_item_id, v_reward.template_id, v_form_id, v_reward.rarity_code,
        v_use_pity, v_roll,
        jsonb_build_object('serial_item_id', v_item_id)
      );

      if v_pity.id is not null then
        select exists (
          select 1
          from catalog.rarities got
          join catalog.rarities target on target.code = coalesce(v_pity.reset_on_rarity_code, v_pity.target_rarity_code)
          where got.code = v_reward.rarity_code and got.sort_order >= target.sort_order
        ) into v_should_reset;

        update gacha.user_pity_states
        set current_count = case when v_should_reset then 0 else current_count + 1 end,
            total_draws = total_draws + 1,
            last_hit_at = case when v_should_reset then now() else last_hit_at end,
            updated_at = now()
        where user_id = v_order.user_id and box_id = v_order.box_id and pity_rule_id = v_pity.id;
      end if;
    end loop;

    v_reward_kcoin := v_order.open_reward_kcoin * v_order.draw_count;
    if v_reward_kcoin > 0 then
      v_credit := api._credit_balance(
        v_order.user_id,
        'KCOIN',
        v_reward_kcoin,
        'open_box_rebate',
        v_order.id,
        null,
        'open_box_rebate:' || v_order.id::text,
        'Open box rebate',
        jsonb_build_object('draw_order_id', v_order.id, 'draw_count', v_order.draw_count, 'quantity', v_order.quantity)
      );
    end if;

    select value
    into v_referral_commission_setting
    from ops.system_settings
    where key = 'REFERRAL_COMMISSION_BPS';

    if v_referral_commission_setting is null then
      raise exception 'referral commission bps setting is required';
    elsif jsonb_typeof(v_referral_commission_setting) = 'object'
       and v_referral_commission_setting ? 'commission_bps'
       and (v_referral_commission_setting ->> 'commission_bps') ~ '^[0-9]+$' then
      v_referral_commission_bps := (v_referral_commission_setting ->> 'commission_bps')::integer;
    else
      raise exception 'invalid referral commission bps setting';
    end if;

    if v_referral_commission_bps < 0 or v_referral_commission_bps > 10000 then
      raise exception 'referral commission bps setting must be between 0 and 10000';
    end if;

    v_referral_first_open := api.referral_process_first_open(v_order.user_id, v_order.id);
    if v_reward_kcoin > 0
       and not coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
      v_referral_commission := api.referral_create_commission(
        v_order.user_id,
        v_order.id,
        v_reward_kcoin,
        v_referral_commission_bps
      );
    elsif coalesce((v_referral_first_open ->> 'processed')::boolean, false) then
      v_referral_commission := jsonb_build_object(
        'processed', false,
        'reason', 'first_open_order_not_commissionable',
        'draw_order_id', v_order.id
      );
    end if;

    insert into gacha.draw_audit (draw_order_id, user_id, pool_version_id, rules_snapshot)
    values (
      v_order.id,
      v_order.user_id,
      v_order.pool_version_id,
      jsonb_build_object(
        'box_id', v_order.box_id,
        'draw_count', v_order.draw_count,
        'quantity', v_order.quantity,
        'open_reward_kcoin', v_order.open_reward_kcoin,
        'referral_commission_bps', v_referral_commission_bps
      )
    );

    update gacha.draw_orders
    set status = 'completed',
        opened_at = now(),
        error_message = null,
        updated_at = now()
    where id = v_order.id
    returning * into v_order;

    update payments.star_orders
    set status = 'fulfilled',
        fulfilled_at = coalesce(fulfilled_at, now()),
        error_message = null,
        updated_at = now()
    where id = p_star_order_id
    returning * into v_star_order;

    select coalesce(jsonb_agg(jsonb_build_object(
      'draw_index', dr.draw_index,
      'template_id', dr.template_id,
      'form_id', dr.form_id,
      'rarity_code', dr.rarity_code,
      'item_instance_id', dr.item_instance_id,
      'was_pity', dr.was_pity
    ) order by dr.draw_index), '[]'::jsonb)
    into v_results
    from gacha.draw_results dr
    where dr.draw_order_id = v_order.id;

    if v_update_id is not null then
      v_duration_ms := greatest(
        floor(extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000)::integer,
        0
      );

      update payments.telegram_webhook_events
      set user_id = v_star_order.user_id,
          invoice_payload = coalesce(invoice_payload, v_star_order.telegram_invoice_payload),
          process_status = 'processed',
          processed_at = coalesce(processed_at, now()),
          processing_duration_ms = v_duration_ms,
          next_retry_at = null,
          error_message = null,
          status_context = coalesce(status_context, '{}'::jsonb) || jsonb_build_object(
            'fulfillment',
            jsonb_strip_nulls(jsonb_build_object(
              'status', 'fulfilled',
              'idempotent', false,
              'retryable', false,
              'star_order_id', p_star_order_id,
              'draw_order_id', v_order.id,
              'result_count', jsonb_array_length(v_results),
              'telegram_payment_charge_id', v_charge_id,
              'processed_at', now()
            ))
          )
      where update_id = v_update_id
        and event_type = 'successful_payment';
    end if;

    return jsonb_build_object(
      'fulfilled', true,
      'idempotent', false,
      'retryable', false,
      'star_order_id', p_star_order_id,
      'draw_order_id', v_order.id,
      'status', 'completed',
      'draw_count', v_order.draw_count,
      'quantity', v_order.quantity,
      'results', v_results,
      'result_count', jsonb_array_length(v_results),
      'kcoin_reward', v_reward_kcoin,
      'kcoin_ledger', v_credit,
      'referral_first_open', coalesce(v_referral_first_open, '{}'::jsonb),
      'referral_commission', coalesce(v_referral_commission, '{}'::jsonb),
      'telegram_payment_charge_id', v_charge_id,
      'payment_order_status', v_star_order.status
    );
  exception when others then
    get stacked diagnostics
      v_failure_message = message_text,
      v_failure_detail = pg_exception_detail,
      v_failure_hint = pg_exception_hint;

    v_failure_reason := case
      when v_failure_message ilike '%stock%' then 'STOCK_INSUFFICIENT'
      when v_failure_message ilike '%drop pool%' then 'DROP_POOL_UNAVAILABLE'
      when v_failure_message ilike '%referral commission bps%' then 'REFERRAL_CONFIG_INVALID'
      else 'FULFILLMENT_FAILED'
    end;

    update payments.star_orders
    set status = 'failed',
        error_message = left(v_failure_message, 1000),
        updated_at = now()
    where id = p_star_order_id
      and status not in ('fulfilled', 'refunded', 'disputed')
    returning * into v_star_order;

    update gacha.draw_orders
    set status = 'failed',
        payment_status = case
          when payment_status in ('paid', 'dev_paid') then payment_status
          else 'failed'
        end,
        error_message = left(v_failure_message, 1000),
        updated_at = now()
    where id = v_order.id
      and status not in ('opened', 'completed')
    returning * into v_order;

    insert into ops.risk_events (
      user_id,
      event_type,
      severity,
      status,
      source_type,
      source_id,
      detail
    ) values (
      v_star_order.user_id,
      'gacha_fulfillment_failed',
      case when v_failure_reason = 'FULFILLMENT_FAILED' then 'high' else 'medium' end,
      'open',
      'star_order',
      p_star_order_id,
      jsonb_build_object(
        'reason_code', v_failure_reason,
        'error_message', v_failure_message,
        'error_detail', nullif(v_failure_detail, ''),
        'error_hint', nullif(v_failure_hint, ''),
        'telegram_payment_charge_id', v_charge_id,
        'star_payment_id', v_existing_payment.id,
        'draw_order_id', v_order.id,
        'update_id', v_update_id
      )
    );

    if v_update_id is not null then
      v_duration_ms := greatest(
        floor(extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000)::integer,
        0
      );

      update payments.telegram_webhook_events
      set user_id = coalesce(v_star_order.user_id, user_id),
          process_status = 'failed',
          processed_at = now(),
          processing_duration_ms = v_duration_ms,
          retry_count = retry_count + 1,
          next_retry_at = coalesce(next_retry_at, now() + interval '5 minutes'),
          error_message = left(v_failure_reason || ': ' || v_failure_message, 1000),
          status_context = coalesce(status_context, '{}'::jsonb) || jsonb_build_object(
            'fulfillment',
            jsonb_strip_nulls(jsonb_build_object(
              'status', 'failed',
              'reason_code', v_failure_reason,
              'error_message', v_failure_message,
              'retryable', true,
              'star_order_id', p_star_order_id,
              'draw_order_id', v_order.id,
              'telegram_payment_charge_id', v_charge_id,
              'processed_at', now()
            ))
          )
      where update_id = v_update_id
        and event_type = 'successful_payment';
    end if;

    return jsonb_build_object(
      'fulfilled', false,
      'idempotent', false,
      'retryable', true,
      'status', 'failed',
      'reason_code', v_failure_reason,
      'error_message', v_failure_message,
      'star_order_id', p_star_order_id,
      'draw_order_id', v_order.id,
      'telegram_payment_charge_id', v_charge_id,
      'payment_order_status', v_star_order.status,
      'result_count', (
        select count(*)::integer
        from gacha.draw_results
        where draw_order_id = v_order.id
      )
    );
  end;
end;
$$;

comment on function api.gacha_process_paid_order_without_task_progress(
  uuid,
  text,
  text,
  jsonb
) is 'Fulfills a recorded Telegram Stars paid gacha order exactly once, with retryable failure state and risk-event audit.';

revoke execute on function api.gacha_process_paid_order_without_task_progress(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;

commit;
