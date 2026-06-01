-- Phase 6 step 2.10: user/support admin center.
-- Local-tested before any remote Supabase apply.

alter table ops.support_tickets
  add column if not exists resolution text,
  add column if not exists rejected_reason text,
  add column if not exists escalation_owner text,
  add column if not exists escalation_queue text,
  add column if not exists status_reason text,
  add column if not exists last_handled_by_admin_id uuid references ops.admin_users(id) on delete set null,
  add column if not exists last_handled_at timestamptz;

update ops.support_tickets
set status = 'resolved',
    resolution = coalesce(resolution, nullif(message, ''), 'legacy closed ticket'),
    resolved_at = coalesce(resolved_at, updated_at, now()),
    updated_at = now()
where status = 'closed';

alter table ops.support_tickets
  drop constraint if exists support_tickets_status_check;

alter table ops.support_tickets
  add constraint support_tickets_status_check
  check (
    status = any (
      array[
        'open'::text,
        'pending_user'::text,
        'pending_ops'::text,
        'resolved'::text,
        'rejected'::text,
        'escalated'::text
      ]
    )
  );

alter table ops.support_tickets
  drop constraint if exists support_tickets_resolution_required_check;

alter table ops.support_tickets
  add constraint support_tickets_resolution_required_check
  check (
    status <> 'resolved'
    or nullif(trim(coalesce(resolution, '')), '') is not null
  );

alter table ops.support_tickets
  drop constraint if exists support_tickets_rejected_reason_required_check;

alter table ops.support_tickets
  add constraint support_tickets_rejected_reason_required_check
  check (
    status <> 'rejected'
    or nullif(trim(coalesce(rejected_reason, status_reason, '')), '') is not null
  );

alter table ops.support_tickets
  drop constraint if exists support_tickets_escalation_target_required_check;

alter table ops.support_tickets
  add constraint support_tickets_escalation_target_required_check
  check (
    status <> 'escalated'
    or nullif(trim(coalesce(escalation_owner, escalation_queue, '')), '') is not null
  );

create index if not exists support_tickets_status_updated_idx
  on ops.support_tickets (status, updated_at desc);

create index if not exists support_tickets_user_updated_idx
  on ops.support_tickets (user_id, updated_at desc);

comment on column ops.support_tickets.resolution is
  'Support resolution text required when status=resolved.';

comment on column ops.support_tickets.rejected_reason is
  'Support rejection reason required when status=rejected.';

comment on column ops.support_tickets.escalation_owner is
  'Support escalation assignee or owner; required with escalation_queue when status=escalated.';

comment on column ops.support_tickets.escalation_queue is
  'Support escalation queue; required with escalation_owner when status=escalated.';

update ops.admin_roles
set permissions = (
  select jsonb_agg(distinct permission order by permission)
  from jsonb_array_elements_text(
    coalesce(permissions, '[]'::jsonb)
    || '["support:read","support:write","users:compensate","tickets:write"]'::jsonb
  ) as expanded(permission)
)
where code = 'SUPPORT';

alter table inventory.item_instances
  drop constraint if exists item_instances_source_type_check;

alter table inventory.item_instances
  add constraint item_instances_source_type_check
  check (
    source_type = any (
      array[
        'gacha'::text,
        'market'::text,
        'evolution'::text,
        'admin'::text,
        'admin_compensation'::text,
        'onchain_sync'::text,
        'airdrop'::text,
        'unknown'::text
      ]
    )
  );

alter table inventory.item_instance_events
  drop constraint if exists item_instance_events_event_type_check;

alter table inventory.item_instance_events
  add constraint item_instance_events_event_type_check
  check (
    event_type = any (
      array[
        'created'::text,
        'acquired'::text,
        'obtained_from_gacha'::text,
        'upgraded'::text,
        'evolved_success'::text,
        'evolved_failed_returned'::text,
        'consumed'::text,
        'decomposed'::text,
        'listed'::text,
        'delisted'::text,
        'sold'::text,
        'bought'::text,
        'mint_queued'::text,
        'minted'::text,
        'transferred'::text,
        'admin_adjusted'::text,
        'admin_granted'::text
      ]
    )
  );

create or replace function api.admin_compensate_user(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_compensation_type text,
  p_currency_code text default null,
  p_amount numeric default null,
  p_item_template_id uuid default null,
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
  v_target core.users%rowtype;
  v_type text := lower(nullif(trim(coalesce(p_compensation_type, '')), ''));
  v_currency text := upper(nullif(trim(coalesce(p_currency_code, '')), ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_context jsonb := coalesce(p_request_context, '{}'::jsonb);
  v_metadata jsonb;
  v_approval_context jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.compensate_user';
  v_request_hash text;
  v_idempotent jsonb;
  v_item inventory.item_instances%rowtype;
  v_notification core.notifications%rowtype;
  v_audit jsonb;
  v_response jsonb;
  v_source_task_progress_id uuid;
  v_source_task_claim_id uuid;
  v_source_task_id uuid;
  v_source_task_period_key text;
  v_source_draw_order_id uuid;
  v_source_star_order_id uuid;
  v_item_form_id uuid;
  v_task_progress tasks.user_task_progress%rowtype;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(
    v_admin.id,
    array['users:compensate', 'support:write', 'admin:write']
  );

  if p_target_user_id is null then
    raise exception 'ADMIN_TARGET_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if v_type is null then
    raise exception 'ADMIN_COMPENSATION_TYPE_REQUIRED' using errcode = 'P0001';
  end if;

  if v_type = 'k-coin' then
    v_type := 'kcoin';
  elsif v_type in ('f-gems', 'fgem') then
    v_type := 'fgems';
  elsif v_type in ('collectible', 'nft', 'item_instance') then
    v_type := 'item';
  elsif v_type in ('open_box_result', 'draw', 'draw_result_reissue') then
    v_type := 'draw_result';
  elsif v_type in ('task', 'task_reward_reissue') then
    v_type := 'task_reward';
  end if;

  if v_type not in (
    'currency',
    'kcoin',
    'fgems',
    'item',
    'task_reward',
    'draw_result',
    'notification'
  ) then
    raise exception 'ADMIN_COMPENSATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_context) <> 'object' then
    raise exception 'ADMIN_REQUEST_CONTEXT_INVALID' using errcode = 'P0001';
  end if;

  select *
  into v_target
  from core.users
  where id = p_target_user_id
  for update;

  if not found then
    raise exception 'ADMIN_TARGET_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_target.status = 'deleted' then
    raise exception 'ADMIN_TARGET_USER_DELETED' using errcode = 'P0001';
  end if;

  v_metadata := coalesce(v_context -> 'metadata', '{}'::jsonb)
    || jsonb_build_object(
      'compensation_type', v_type,
      'admin_user_id', p_admin_user_id,
      'target_user_id', p_target_user_id,
      'reason', v_reason,
      'request_context', v_context - 'metadata' - 'approval_context'
    );

  v_approval_context := coalesce(v_context -> 'approval_context', '{}'::jsonb);

  if p_amount is not null
     and p_amount >= coalesce(nullif(v_context ->> 'large_amount_threshold', '')::numeric, 10000)
     and not api._admin_requires_approval(v_approval_context) then
    v_approval_context := v_approval_context || jsonb_build_object(
      'requiresApproval', true,
      'approvalReason', 'large_compensation_amount'
    );
  end if;

  if v_type in ('kcoin', 'fgems') then
    v_currency := case when v_type = 'kcoin' then 'KCOIN' else 'FGEMS' end;
  end if;

  if v_type in ('task_reward', 'draw_result') then
    v_source_task_progress_id := nullif(coalesce(
      v_context ->> 'source_task_progress_id',
      v_context ->> 'sourceTaskProgressId'
    ), '')::uuid;
    v_source_task_claim_id := nullif(coalesce(
      v_context ->> 'source_task_claim_id',
      v_context ->> 'sourceTaskClaimId'
    ), '')::uuid;
    v_source_task_id := nullif(coalesce(
      v_context ->> 'source_task_id',
      v_context ->> 'sourceTaskId',
      v_context ->> 'task_id',
      v_context ->> 'taskId'
    ), '')::uuid;
    v_source_task_period_key := nullif(coalesce(
      v_context ->> 'source_task_period_key',
      v_context ->> 'sourceTaskPeriodKey',
      v_context ->> 'period_key',
      v_context ->> 'periodKey'
    ), '');
    v_source_draw_order_id := nullif(coalesce(
      v_context ->> 'source_draw_order_id',
      v_context ->> 'sourceDrawOrderId',
      v_context ->> 'draw_order_id',
      v_context ->> 'drawOrderId'
    ), '')::uuid;
    v_source_star_order_id := nullif(coalesce(
      v_context ->> 'source_star_order_id',
      v_context ->> 'sourceStarOrderId',
      v_context ->> 'star_order_id',
      v_context ->> 'starOrderId'
    ), '')::uuid;

    if v_type = 'task_reward'
       and v_source_task_progress_id is null
       and v_source_task_claim_id is null
       and v_source_task_id is null then
      raise exception 'ADMIN_TASK_COMPENSATION_SOURCE_REQUIRED' using errcode = 'P0001';
    end if;

    if v_type = 'task_reward' then
      if v_source_task_progress_id is not null then
        select *
        into v_task_progress
        from tasks.user_task_progress
        where id = v_source_task_progress_id
          and user_id = p_target_user_id
        for update;

        if not found then
          raise exception 'ADMIN_TASK_PROGRESS_NOT_FOUND' using errcode = 'P0001';
        end if;

        if v_task_progress.status = 'claimed'
           or v_task_progress.claimed_at is not null then
          raise exception 'ADMIN_TASK_REWARD_ALREADY_CLAIMED' using errcode = 'P0001';
        end if;

        v_source_task_id := coalesce(v_source_task_id, v_task_progress.task_id);
        v_source_task_period_key := coalesce(v_source_task_period_key, v_task_progress.period_key);
      end if;

      if v_source_task_claim_id is not null then
        if exists (
          select 1
          from tasks.task_claims
          where id = v_source_task_claim_id
            and user_id = p_target_user_id
        ) then
          raise exception 'ADMIN_TASK_REWARD_ALREADY_CLAIMED' using errcode = 'P0001';
        end if;

        raise exception 'ADMIN_TASK_CLAIM_NOT_FOUND' using errcode = 'P0001';
      end if;

      if v_source_task_id is not null then
        if v_source_task_period_key is null then
          raise exception 'ADMIN_TASK_PERIOD_REQUIRED' using errcode = 'P0001';
        end if;

        if exists (
          select 1
          from tasks.task_claims
          where user_id = p_target_user_id
            and task_id = v_source_task_id
            and period_key = v_source_task_period_key
        ) then
          raise exception 'ADMIN_TASK_REWARD_ALREADY_CLAIMED' using errcode = 'P0001';
        end if;
      end if;
    end if;

    if v_type = 'draw_result'
       and v_source_draw_order_id is null
       and v_source_star_order_id is null then
      raise exception 'ADMIN_DRAW_COMPENSATION_SOURCE_REQUIRED' using errcode = 'P0001';
    end if;

    v_metadata := v_metadata || jsonb_build_object(
      'source_task_progress_id', v_source_task_progress_id,
      'source_task_claim_id', v_source_task_claim_id,
      'source_task_id', v_source_task_id,
      'source_task_period_key', v_source_task_period_key,
      'source_draw_order_id', v_source_draw_order_id,
      'source_star_order_id', v_source_star_order_id
    );
  end if;

  if v_type in ('currency', 'kcoin', 'fgems')
     or (v_type in ('task_reward', 'draw_result') and v_currency is not null and p_amount is not null) then
    if v_currency is null then
      raise exception 'ADMIN_CURRENCY_REQUIRED' using errcode = 'P0001';
    end if;

    if p_amount is null or p_amount <= 0 then
      raise exception 'ADMIN_COMPENSATION_AMOUNT_INVALID' using errcode = 'P0001';
    end if;

    return api.admin_compensate_asset(
      p_admin_user_id => p_admin_user_id,
      p_user_id => p_target_user_id,
      p_currency_code => v_currency,
      p_amount => p_amount,
      p_reason => v_reason,
      p_idempotency_key => v_key,
      p_request_context => v_context,
      p_metadata => v_metadata,
      p_approval_context => v_approval_context
    ) || jsonb_build_object(
      'compensation_type', v_type,
      'target_user_id', p_target_user_id
    );
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'target_user_id', p_target_user_id,
    'compensation_type', v_type,
    'item_template_id', p_item_template_id,
    'reason', v_reason,
    'context', v_context
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if api._admin_requires_approval(v_approval_context) then
    v_response := api.admin_create_approval_request(
      p_admin_user_id => p_admin_user_id,
      p_action => 'user.compensate',
      p_target_schema => 'core',
      p_target_table => 'users',
      p_target_id => p_target_user_id,
      p_payload => jsonb_build_object(
        'rpc', 'admin_compensate_user',
        'target_user_id', p_target_user_id,
        'compensation_type', v_type,
        'currency_code', v_currency,
        'amount', p_amount,
        'item_template_id', p_item_template_id,
        'metadata', v_metadata,
        'request_context', v_context || jsonb_build_object(
          'approval_context',
          v_approval_context || jsonb_build_object('approvalStatus', 'approved')
        ),
        'idempotency_key', v_key
      ),
      p_reason => v_reason,
      p_idempotency_key => 'approval_request:' || v_key,
      p_request_context => v_context
    );
    perform api._admin_complete_idempotency(v_key, v_response, v_now);
    return v_response || jsonb_build_object(
      'compensation_type', v_type,
      'target_user_id', p_target_user_id
    );
  end if;

  if v_type in ('item', 'task_reward', 'draw_result') then
    if p_item_template_id is null then
      raise exception 'ADMIN_ITEM_TEMPLATE_REQUIRED' using errcode = 'P0001';
    end if;

    if not exists (
      select 1
      from catalog.collectible_templates
      where id = p_item_template_id
    ) then
      raise exception 'ADMIN_ITEM_TEMPLATE_NOT_FOUND' using errcode = 'P0001';
    end if;

    v_item_form_id := nullif(coalesce(
      v_context ->> 'item_form_id',
      v_context ->> 'itemFormId',
      v_context ->> 'form_id',
      v_context ->> 'formId'
    ), '')::uuid;

    if v_item_form_id is not null
       and not exists (
         select 1
         from catalog.collectible_forms
         where id = v_item_form_id
           and template_id = p_item_template_id
       ) then
      raise exception 'ADMIN_ITEM_FORM_NOT_FOUND' using errcode = 'P0001';
    end if;

    insert into inventory.item_instances (
      owner_user_id,
      template_id,
      form_id,
      status,
      source_type,
      source_id,
      metadata
    )
    values (
      p_target_user_id,
      p_item_template_id,
      v_item_form_id,
      'available',
      'admin_compensation',
      p_admin_user_id,
      v_metadata || jsonb_build_object('idempotency_key', v_key)
    )
    returning * into v_item;

    insert into inventory.item_instance_events (
      item_instance_id,
      user_id,
      event_type,
      source_type,
      source_id,
      before_state,
      after_state,
      metadata
    )
    values (
      v_item.id,
      p_target_user_id,
      'admin_granted',
      'admin_compensation',
      v_item.id,
      '{}'::jsonb,
      to_jsonb(v_item),
      v_metadata || jsonb_build_object('idempotency_key', v_key)
    );

    v_audit := api.admin_write_audit_log(
      p_admin_user_id,
      'user.compensate.item',
      'inventory',
      'item_instances',
      v_item.id,
      '{}'::jsonb,
      to_jsonb(v_item),
      v_context ->> 'ip_hash',
      coalesce(
        nullif(v_context ->> 'user_agent_hash', ''),
        nullif(v_context ->> 'user_agent', '')
      ),
      v_reason
    );

    v_response := jsonb_build_object(
      'target_user_id', p_target_user_id,
      'compensation_type', v_type,
      'item_instance_id', v_item.id,
      'item_template_id', p_item_template_id,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'idempotent', false,
      'server_time', v_now
    );
    perform api._admin_complete_idempotency(v_key, v_response, v_now);
    return v_response;
  end if;

  if v_type = 'notification' then
    insert into core.notifications (
      user_id,
      notification_type,
      title,
      body,
      payload
    )
    values (
      p_target_user_id,
      'admin_compensation',
      coalesce(nullif(v_context ->> 'title', ''), '客服处理通知'),
      coalesce(nullif(v_context ->> 'body', ''), v_reason),
      v_metadata || jsonb_build_object('idempotency_key', v_key)
    )
    returning * into v_notification;

    v_audit := api.admin_write_audit_log(
      p_admin_user_id,
      'user.compensate.notification',
      'core',
      'notifications',
      v_notification.id,
      '{}'::jsonb,
      to_jsonb(v_notification),
      v_context ->> 'ip_hash',
      coalesce(
        nullif(v_context ->> 'user_agent_hash', ''),
        nullif(v_context ->> 'user_agent', '')
      ),
      v_reason
    );

    v_response := jsonb_build_object(
      'target_user_id', p_target_user_id,
      'compensation_type', v_type,
      'notification_id', v_notification.id,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'idempotent', false,
      'server_time', v_now
    );
    perform api._admin_complete_idempotency(v_key, v_response, v_now);
    return v_response;
  end if;

  raise exception 'ADMIN_COMPENSATION_PAYLOAD_INVALID' using errcode = 'P0001';
end;
$$;

revoke all on function api.admin_compensate_user(
  uuid, uuid, text, text, numeric, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_compensate_user(
  uuid, uuid, text, text, numeric, uuid, text, text, jsonb
) to service_role;

comment on function api.admin_compensate_user(
  uuid, uuid, text, text, numeric, uuid, text, text, jsonb
) is
  'Phase 6 user/support admin compensation entrypoint. Currency compensation delegates to admin_compensate_asset so ledger and balances stay transactional.';
