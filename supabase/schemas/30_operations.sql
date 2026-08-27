create table operations.user_authority_sequences (
  user_id uuid primary key references identity.users(id) on delete cascade,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create table operations.user_admission_counters (
  user_id uuid primary key references identity.users(id) on delete cascade,
  minute_window_started_at timestamptz not null,
  minute_count integer not null default 0 check (minute_count between 0 and 60),
  day_window_started_at timestamptz not null,
  day_count integer not null default 0 check (day_count between 0 and 1000),
  updated_at timestamptz not null default now()
);

create table operations.operations (
  id uuid primary key,
  user_id uuid not null references identity.users(id) on delete cascade,
  use_case text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  result jsonb,
  error_code text,
  authority_sequence bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  result_acknowledged_at timestamptz,
  payload_purged_at timestamptz,
  check (substr(id::text, 15, 1) = '7' and substr(id::text, 20, 1) in ('8', '9', 'a', 'b')),
  check (result_acknowledged_at is null or status in ('succeeded', 'failed')),
  check (
    (status in ('pending', 'unknown') and authority_sequence is null)
    or (
      status in ('succeeded', 'failed')
      and authority_sequence is not null
      and authority_sequence > 0
    )
  ),
  check (
    (payload_purged_at is null and request is not null)
    or (
      payload_purged_at is not null
      and status in ('succeeded', 'failed')
      and request is null
      and result is null
      and completed_at is not null
      and payload_purged_at >= completed_at
    )
  ),
  unique (user_id, use_case, id)
);

create index operations_user_created_idx on operations.operations (user_id, created_at desc);
create index operations_pending_idx on operations.operations (created_at) where status in ('pending', 'unknown');
create index operations_non_battle_open_user_idx
on operations.operations (user_id, created_at, id)
where status in ('pending', 'unknown') and use_case not like 'battle.%';
create index operations_non_battle_failed_user_idx
on operations.operations (user_id, completed_at desc)
where status = 'failed' and use_case not like 'battle.%';
create unique index operations_user_authority_sequence_idx
on operations.operations (user_id, authority_sequence)
where authority_sequence is not null;
create index operations_payload_cleanup_idx
on operations.operations (completed_at, id)
where status in ('succeeded', 'failed') and payload_purged_at is null;
create index operations_user_recovery_idx
on operations.operations (user_id, created_at, id)
where use_case <> 'gacha.open'
  and (
    status in ('pending', 'unknown')
    or (
      use_case = 'inventory.evolve'
      and status in ('succeeded', 'failed')
      and result_acknowledged_at is null
    )
  );

create or replace function operations.operation_id_timestamp_ms(p_operation_id uuid)
returns bigint
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  with value as (
    select decode(substr(replace(p_operation_id::text, '-', ''), 1, 12), 'hex') bytes
  )
  select get_byte(bytes, 0)::bigint * 1099511627776
    + get_byte(bytes, 1)::bigint * 4294967296
    + get_byte(bytes, 2)::bigint * 16777216
    + get_byte(bytes, 3)::bigint * 65536
    + get_byte(bytes, 4)::bigint * 256
    + get_byte(bytes, 5)::bigint
  from value
$$;

create or replace function operations.assert_new_operation_id(p_operation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_text text := p_operation_id::text;
  v_timestamp_ms bigint;
  v_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_operation_id is null
    or substr(v_text, 15, 1) <> '7'
    or substr(v_text, 20, 1) not in ('8', '9', 'a', 'b')
  then
    perform api.raise_business_error('IDEMPOTENCY_KEY_INVALID', '幂等键必须是 UUIDv7');
  end if;
  v_timestamp_ms := operations.operation_id_timestamp_ms(p_operation_id);
  if v_timestamp_ms < v_now_ms - 86400000
    or v_timestamp_ms > v_now_ms + 300000
  then
    perform api.raise_business_error('IDEMPOTENCY_KEY_INVALID', '幂等键时间无效');
  end if;
end;
$$;

create or replace function operations.admit_new_command(p_user_id uuid, p_use_case text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_counter operations.user_admission_counters%rowtype;
  v_failed_count integer;
  v_open_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_use_case like 'battle.%' then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('operations.admission:' || p_user_id::text, 0));
  insert into operations.user_admission_counters (
    user_id, minute_window_started_at, day_window_started_at
  ) values (p_user_id, v_now, v_now)
  on conflict (user_id) do nothing;
  select * into v_counter
  from operations.user_admission_counters
  where user_id = p_user_id
  for update;

  if v_counter.minute_window_started_at <= v_now - interval '60 seconds' then
    v_counter.minute_window_started_at := v_now;
    v_counter.minute_count := 0;
  end if;
  if v_counter.day_window_started_at <= v_now - interval '24 hours' then
    v_counter.day_window_started_at := v_now;
    v_counter.day_count := 0;
  end if;
  if v_counter.minute_count >= 60 or v_counter.day_count >= 1000 then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;

  select count(*)::integer into v_failed_count
  from operations.operations
  where user_id = p_user_id
    and use_case not like 'battle.%'
    and status = 'failed'
    and completed_at >= v_now - interval '24 hours';
  if v_failed_count >= 100 then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;

  select count(*)::integer into v_open_count
  from operations.operations
  where user_id = p_user_id
    and use_case not like 'battle.%'
    and status in ('pending', 'unknown');
  if v_open_count >= 20 then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;

  update operations.user_admission_counters
  set minute_window_started_at = v_counter.minute_window_started_at,
      minute_count = v_counter.minute_count + 1,
      day_window_started_at = v_counter.day_window_started_at,
      day_count = v_counter.day_count + 1,
      updated_at = v_now
  where user_id = p_user_id;
end;
$$;

create or replace function operations.assign_authority_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('succeeded', 'failed') and new.authority_sequence is null then
    insert into operations.user_authority_sequences (user_id, last_sequence)
    values (new.user_id, 1)
    on conflict (user_id) do update
    set last_sequence = operations.user_authority_sequences.last_sequence + 1,
        updated_at = now()
    returning last_sequence into new.authority_sequence;
  end if;
  return new;
end;
$$;

create trigger operations_assign_authority_sequence
before insert or update of status on operations.operations
for each row execute function operations.assign_authority_sequence();

create table operations.webhook_events (
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table operations.telegram_chat_onboarding (
  user_id uuid primary key references identity.users(id) on delete cascade,
  telegram_id bigint not null unique
    check (telegram_id between 1 and 9007199254740991),
  first_update_id bigint not null unique
    check (first_update_id between 0 and 9007199254740991),
  delivery_status text not null default 'unknown'
    check (delivery_status in ('unknown', 'sent', 'failed')),
  welcome_message_id bigint check (welcome_message_id > 0),
  attempted_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  error_code text check (error_code is null or error_code = 'TELEGRAM_API_FAILED'),
  updated_at timestamptz not null default clock_timestamp(),
  check (completed_at is null or completed_at >= attempted_at),
  check (
    (completed_at is null
      and delivery_status = 'unknown'
      and welcome_message_id is null
      and error_code is null)
    or
    (completed_at is not null
      and (
        (delivery_status = 'sent'
          and welcome_message_id is not null
          and error_code is null)
        or
        (delivery_status in ('unknown', 'failed')
          and welcome_message_id is null
          and error_code = 'TELEGRAM_API_FAILED')
      ))
  )
);

create or replace function api.telegram_chat_onboarding_claim(
  p_update_id bigint,
  p_telegram_id bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_preferred_language text;
  v_claimed_user_id uuid;
begin
  if p_update_id is null
    or p_update_id < 0
    or p_update_id > 9007199254740991
    or p_telegram_id is null
    or p_telegram_id <= 0
    or p_telegram_id > 9007199254740991
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
  then
    perform api.raise_business_error('REQUEST_INVALID', 'Telegram 授权通知无效');
  end if;

  insert into operations.webhook_events (provider, event_id, payload)
  values ('telegram_write_access', p_update_id::text, p_payload)
  on conflict do nothing;
  if not found then
    return jsonb_build_object(
      'should_send', false,
      'user_id', null,
      'preferred_language', null
    );
  end if;

  select u.id, u.preferred_language
  into v_user_id, v_preferred_language
  from identity.users u
  where u.telegram_id = p_telegram_id
    and u.status = 'normal'
  for update;

  if v_user_id is null then
    update operations.webhook_events
    set processed_at = clock_timestamp()
    where provider = 'telegram_write_access'
      and event_id = p_update_id::text;
    return jsonb_build_object(
      'should_send', false,
      'user_id', null,
      'preferred_language', null
    );
  end if;

  insert into operations.telegram_chat_onboarding (
    user_id,
    telegram_id,
    first_update_id
  ) values (
    v_user_id,
    p_telegram_id,
    p_update_id
  )
  on conflict do nothing
  returning user_id into v_claimed_user_id;

  update operations.webhook_events
  set processed_at = clock_timestamp()
  where provider = 'telegram_write_access'
    and event_id = p_update_id::text;

  return jsonb_build_object(
    'should_send', v_claimed_user_id is not null,
    'user_id', v_user_id,
    'preferred_language', v_preferred_language
  );
end;
$$;

create or replace function api.telegram_chat_onboarding_finish(
  p_user_id uuid,
  p_update_id bigint,
  p_delivery_status text,
  p_welcome_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_user_id is null
    or p_update_id is null
    or p_update_id < 0
    or p_update_id > 9007199254740991
    or p_delivery_status is null
    or p_delivery_status not in ('unknown', 'sent', 'failed')
    or (p_delivery_status = 'sent' and (p_welcome_message_id is null or p_welcome_message_id <= 0))
    or (p_delivery_status <> 'sent' and p_welcome_message_id is not null)
  then
    perform api.raise_business_error('REQUEST_INVALID', 'Telegram 欢迎消息结果无效');
  end if;

  update operations.telegram_chat_onboarding
  set delivery_status = p_delivery_status,
      welcome_message_id = p_welcome_message_id,
      completed_at = clock_timestamp(),
      error_code = case
        when p_delivery_status = 'sent' then null
        else 'TELEGRAM_API_FAILED'
      end,
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and first_update_id = p_update_id
    and completed_at is null;
  v_updated := found;

  return jsonb_build_object('updated', v_updated);
end;
$$;

create table operations.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  processed_count integer not null default 0 check (processed_count >= 0),
  details jsonb not null default '{}'::jsonb,
  scan_from timestamptz,
  scan_to timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index job_runs_name_started_idx on operations.job_runs (job_name, started_at desc);

create table operations.invariant_violations (
  id bigint generated always as identity primary key,
  code text not null,
  subject text not null,
  details jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index invariant_violations_open_idx on operations.invariant_violations (code, detected_at) where resolved_at is null;
create unique index invariant_violations_open_subject_idx on operations.invariant_violations (code, subject) where resolved_at is null;

create or replace function operations.strip_pet_urls(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_key text;
  v_item jsonb;
  v_template_id text;
  v_url text;
  v_variants jsonb := '[]'::jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then return p_value; end if;
  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(operations.strip_pet_urls(item.value) order by item.ordinality), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return v_result;
  end if;
  if jsonb_typeof(p_value) <> 'object' then return p_value; end if;

  v_result := '{}'::jsonb;
  for v_key, v_item in select key, value from jsonb_each(p_value)
  loop
    if v_key not in ('image_thumbnail_url', 'image_detail_url') then
      v_result := v_result || jsonb_build_object(v_key, operations.strip_pet_urls(v_item));
    end if;
  end loop;
  if p_value ? 'image_thumbnail_url' then
    v_variants := v_variants || jsonb_build_array('thumbnail');
  end if;
  if p_value ? 'image_detail_url' then
    v_variants := v_variants || jsonb_build_array('detail');
  end if;
  if jsonb_array_length(v_variants) > 0 then
    v_template_id := p_value->>'template_id';
    if v_template_id is null then
      v_url := coalesce(p_value->>'image_detail_url', p_value->>'image_thumbnail_url');
      v_template_id := upper((regexp_match(
        v_url,
        '/(pet-[nat]-[0-9]{3}-[123])\.[0-9a-f]{64}\.webp$'
      ))[1]);
    end if;
    if v_template_id is null or v_template_id !~ '^PET-[NAT]-[0-9]{3}-[123]$' then
      raise exception using errcode = '22023', message = 'pet image URL cannot be reduced to a template reference';
    end if;
    v_result := v_result || jsonb_build_object('_pet_image_variants', v_variants);
    if not (v_result ? 'template_id') then
      v_result := v_result || jsonb_build_object('_pet_image_template_id', v_template_id);
    end if;
  end if;
  return v_result;
end
$$;

create or replace function operations.present_pet_urls(p_value jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_key text;
  v_item jsonb;
  v_template_id text;
  v_variants jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then return p_value; end if;
  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(operations.present_pet_urls(item.value) order by item.ordinality), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return v_result;
  end if;
  if jsonb_typeof(p_value) <> 'object' then return p_value; end if;

  v_result := '{}'::jsonb;
  for v_key, v_item in select key, value from jsonb_each(p_value)
  loop
    if v_key not in ('_pet_image_template_id', '_pet_image_variants') then
      v_result := v_result || jsonb_build_object(v_key, operations.present_pet_urls(v_item));
    end if;
  end loop;
  v_variants := p_value->'_pet_image_variants';
  if jsonb_typeof(v_variants) = 'array' then
    v_template_id := coalesce(p_value->>'template_id', p_value->>'_pet_image_template_id');
    if v_variants ? 'thumbnail' then
      v_result := v_result || jsonb_build_object(
        'image_thumbnail_url', catalog.template_thumbnail_url(v_template_id)
      );
    end if;
    if v_variants ? 'detail' then
      v_result := v_result || jsonb_build_object(
        'image_detail_url', catalog.template_detail_url(v_template_id)
      );
    end if;
  end if;
  return v_result;
end
$$;

create or replace function operations.present_result(p_use_case text, p_result jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select operations.present_pet_urls(operations.strip_pet_urls(p_result))
$$;

create or replace function operations.operation_json(p_operation operations.operations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'operation_id', p_operation.id,
    'use_case', p_operation.use_case,
    'status', p_operation.status,
    'result', operations.present_result(p_operation.use_case, p_operation.result),
    'error_code', p_operation.error_code,
    'acknowledged_at', p_operation.result_acknowledged_at,
    'created_at', p_operation.created_at,
    'updated_at', p_operation.updated_at
  )
$$;

create or replace function operations.begin_command(
  p_session_id uuid,
  p_use_case text,
  p_operation_id uuid,
  p_request jsonb
)
returns operations.operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(
    p_session_id,
    p_use_case is not distinct from 'referral.bind'
  );
  v_hash text := encode(extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256'), 'hex');
  v_operation operations.operations%rowtype;
begin
  if p_operation_id is null or p_use_case is null or btrim(p_use_case) = '' or p_request is null then
    perform api.raise_business_error('REQUEST_INVALID', '操作请求无效');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('operations.command:' || p_operation_id::text, 0));
  select * into v_operation
  from operations.operations
  where id = p_operation_id
  for update;
  if v_operation.id is not null then
    if v_operation.user_id <> v_user_id or v_operation.use_case <> p_use_case or v_operation.request_hash <> v_hash then
      perform api.raise_business_error('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求');
    end if;
    if v_operation.payload_purged_at is not null then
      perform api.raise_business_error('OPERATION_RESULT_EXPIRED', '操作结果已超过可恢复期限');
    end if;
    return v_operation;
  end if;

  perform operations.assert_new_operation_id(p_operation_id);
  perform operations.admit_new_command(v_user_id, p_use_case);
  insert into operations.operations (id, user_id, use_case, request_hash, request)
  values (p_operation_id, v_user_id, p_use_case, v_hash, p_request)
  returning * into v_operation;
  return v_operation;
end;
$$;

create or replace function operations.complete_command(p_operation_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'succeeded', result = operations.strip_pet_urls(p_result), error_code = null,
      updated_at = now(), completed_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.pending_command(p_operation_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'pending', result = operations.strip_pet_urls(p_result), error_code = null, updated_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.fail_command(p_operation_id uuid, p_code text, p_detail jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'failed', result = operations.strip_pet_urls(p_detail), error_code = p_code,
      updated_at = now(), completed_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.replay_if_finished(p_operation operations.operations)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_operation.payload_purged_at is not null then
    perform api.raise_business_error('OPERATION_RESULT_EXPIRED', '操作结果已超过可恢复期限');
  end if;
  if p_operation.status <> 'pending' or p_operation.result is not null then
    return operations.operation_json(p_operation);
  end if;
  return null;
end;
$$;

create or replace function api.operations_get(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id, true);
  v_entry_handoff_pending boolean;
  v_operation operations.operations%rowtype;
  v_result jsonb;
begin
  select s.referral_processed_at is null into v_entry_handoff_pending
  from identity.sessions s
  where s.id = p_session_id;
  select * into v_operation
  from operations.operations o
  where o.id = p_operation_id and o.user_id = v_user_id;
  if v_operation.id is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '操作记录不存在');
  end if;
  if v_entry_handoff_pending and v_operation.use_case <> 'referral.bind' then
    perform api.raise_business_error('ENTRY_HANDOFF_PENDING', '邀请绑定结果确认中，请稍后刷新');
  end if;
  if v_operation.payload_purged_at is not null then
    perform api.raise_business_error('OPERATION_RESULT_EXPIRED', '操作结果已超过可恢复期限');
  end if;
  v_result := operations.operation_json(v_operation);
  return v_result;
end;
$$;

create or replace function api.operations_recoverable(
  p_session_id uuid,
  p_after_authority_cursor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  if p_after_authority_cursor is null or p_after_authority_cursor < 0 then
    perform api.raise_business_error('REQUEST_INVALID', '权威状态游标无效');
  end if;
  select jsonb_build_object(
    'operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at, o.id)
      from operations.operations o
      where o.user_id = v_user_id
        and (
          (o.use_case = 'wheel.spin' and o.status in ('pending', 'unknown'))
          or (o.use_case = 'inventory.evolve' and o.result_acknowledged_at is null)
        )
    ), '[]'::jsonb),
    'authority_refresh_routes', coalesce((
      select jsonb_agg(marker.use_case order by marker.first_sequence)
      from (
        select o.use_case, min(o.authority_sequence) as first_sequence
        from operations.operations o
        where o.user_id = v_user_id
          and o.authority_sequence > p_after_authority_cursor
        group by o.use_case
      ) marker
    ), '[]'::jsonb),
    'next_authority_cursor', coalesce((
      select sequence.last_sequence::text
      from operations.user_authority_sequences sequence
      where sequence.user_id = v_user_id
    ), '0')
  ) into v_result;
  return v_result;
end;
$$;
