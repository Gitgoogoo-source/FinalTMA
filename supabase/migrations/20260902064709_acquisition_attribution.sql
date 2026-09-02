-- Forward-only acquisition attribution migration. Existing user, session, and login rows are
-- preserved and marked as legacy_unknown because historical start_param values
-- were not stored and cannot be reconstructed truthfully.

create schema if not exists acquisition;

create table acquisition.sources (
  source_code text primary key
    check (source_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  start_param text unique
    check (
      start_param is null
      or start_param = 'listed_on_tg_app'
      or start_param ~ '^SRC_[A-F0-9]{20}$'
    ),
  channel_code text not null
    check (channel_code in ('legacy', 'direct', 'directory', 'paid_ad', 'referral', 'battle')),
  platform_code text not null
    check (platform_code ~ '^[a-z][a-z0-9_]{1,31}$'),
  campaign_code text
    check (campaign_code is null or campaign_code ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  ad_group_code text
    check (ad_group_code is null or ad_group_code ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  creative_code text
    check (creative_code is null or creative_code ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  link_label text not null
    check (btrim(link_label) <> '' and char_length(link_label) <= 160),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  created_by text not null default current_user,
  disabled_at timestamptz,
  disabled_by text,
  check (
    (channel_code in ('directory', 'paid_ad') and start_param is not null)
    or (channel_code not in ('directory', 'paid_ad') and start_param is null)
  ),
  check (
    (status = 'active' and disabled_at is null and disabled_by is null)
    or (status = 'disabled' and disabled_at is not null and disabled_by is not null)
  ),
  check (
    source_code not in (
      'legacy_unknown',
      'telegram_direct',
      'tgapp_listing',
      'player_referral',
      'battle_share'
    )
    or status = 'active'
  )
);

create index acquisition_sources_platform_campaign_idx
on acquisition.sources (platform_code, campaign_code, source_code);

create index acquisition_sources_status_idx
on acquisition.sources (status, source_code);

create or replace function acquisition.enforce_source_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.source_code,
    new.start_param,
    new.channel_code,
    new.platform_code,
    new.campaign_code,
    new.ad_group_code,
    new.creative_code,
    new.link_label,
    new.created_at,
    new.created_by
  ) is distinct from row(
    old.source_code,
    old.start_param,
    old.channel_code,
    old.platform_code,
    old.campaign_code,
    old.ad_group_code,
    old.creative_code,
    old.link_label,
    old.created_at,
    old.created_by
  ) then
    raise exception using
      errcode = '22023',
      message = 'ACQUISITION_SOURCE_IMMUTABLE';
  end if;
  if old.status = 'disabled' and row(
    new.status,
    new.disabled_at,
    new.disabled_by
  ) is distinct from row(
    old.status,
    old.disabled_at,
    old.disabled_by
  ) then
    raise exception using
      errcode = '22023',
      message = 'ACQUISITION_SOURCE_DISABLED_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger acquisition_sources_immutable
before update on acquisition.sources
for each row execute function acquisition.enforce_source_immutability();

insert into acquisition.sources (
  source_code,
  start_param,
  channel_code,
  platform_code,
  campaign_code,
  ad_group_code,
  creative_code,
  link_label,
  created_by
) values
  (
    'legacy_unknown', null, 'legacy', 'unknown', null, null, null,
    'Users and logins created before source attribution', 'migration'
  ),
  (
    'telegram_direct', null, 'direct', 'telegram', null, null, null,
    'Telegram direct entry without a start parameter', 'migration'
  ),
  (
    'tgapp_listing', 'listed_on_tg_app', 'directory', 'tgapp', 'listing', null, null,
    'TG.app directory listing', 'migration'
  ),
  (
    'player_referral', null, 'referral', 'telegram', null, null, null,
    'Player referral link', 'migration'
  ),
  (
    'battle_share', null, 'battle', 'telegram', null, null, null,
    'Battle share link', 'migration'
  );

alter table identity.users
add column first_source_code text;

alter table identity.sessions
add column source_code text;

alter table identity.login_requests
add column source_code text;

update identity.users
set first_source_code = 'legacy_unknown'
where first_source_code is null;

update identity.sessions
set source_code = 'legacy_unknown'
where source_code is null;

update identity.login_requests
set source_code = 'legacy_unknown'
where source_code is null;

alter table identity.users
  alter column first_source_code set not null,
  add constraint users_first_source_code_fkey
    foreign key (first_source_code) references acquisition.sources(source_code);

alter table identity.sessions
  alter column source_code set not null,
  add constraint sessions_source_code_fkey
    foreign key (source_code) references acquisition.sources(source_code);

alter table identity.login_requests
  alter column source_code set not null,
  add constraint login_requests_source_code_fkey
    foreign key (source_code) references acquisition.sources(source_code);

create index users_first_source_created_idx
on identity.users (first_source_code, created_at, id);

create index sessions_source_created_idx
on identity.sessions (source_code, created_at, user_id);

create index login_requests_source_created_idx
on identity.login_requests (source_code, created_at, user_id);

drop function api.identity_authenticate(
  uuid, text, text, text, bigint, text, text, text, text, text, uuid, text,
  timestamptz, text, text, text
);

create or replace function api.identity_authenticate(
  p_operation_id uuid,
  p_request_hash text,
  p_user_key_hash text,
  p_init_data_key_hash text,
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_referral_code text,
  p_session_id uuid,
  p_token_hash text,
  p_auth_date timestamptz,
  p_entry_kind text,
  p_entry_referral_code text,
  p_battle_invite_token_hash text,
  p_entry_source_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user identity.users%rowtype;
  v_login identity.login_requests%rowtype;
  v_session_id uuid;
  v_new_user boolean;
  v_expires_at timestamptz;
  v_candidate identity.entry_candidates%rowtype;
  v_referral_processed_at timestamptz;
  v_rate_allowed boolean;
  v_source_code text;
begin
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_user_key_hash is null or p_user_key_hash !~ '^[0-9a-f]{64}$'
    or p_init_data_key_hash is null or p_init_data_key_hash !~ '^[0-9a-f]{64}$'
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_session_id is null
    or p_telegram_id is null
  then
    perform api.raise_business_error('REQUEST_INVALID', '登录请求摘要无效');
  end if;
  if p_entry_kind is null
    or p_entry_kind not in ('direct', 'referral', 'battle', 'invalid')
    or (
      p_entry_kind = 'direct'
      and (
        p_entry_referral_code is not null
        or p_battle_invite_token_hash is not null
        or (
          p_entry_source_param is not null
          and p_entry_source_param <> 'listed_on_tg_app'
          and p_entry_source_param !~ '^SRC_[A-F0-9]{20}$'
        )
      )
    )
    or (
      p_entry_kind = 'referral'
      and (
        p_entry_referral_code is null
        or p_entry_referral_code !~ '^TMA[A-F0-9]{20}$'
        or p_battle_invite_token_hash is not null
        or p_entry_source_param is not null
      )
    )
    or (
      p_entry_kind = 'battle'
      and (
        p_entry_referral_code is not null
        or p_battle_invite_token_hash is null
        or p_battle_invite_token_hash !~ '^[0-9a-f]{64}$'
        or p_entry_source_param is not null
      )
    )
    or (
      p_entry_kind = 'invalid'
      and (
        p_entry_referral_code is not null
        or p_battle_invite_token_hash is not null
        or p_entry_source_param is not null
      )
    )
  then
    perform api.raise_business_error('REQUEST_INVALID', '登录入口参数无效');
  end if;

  v_rate_allowed := identity.consume_login_rate_limit('user', p_user_key_hash);
  if not v_rate_allowed then
    return jsonb_build_object('error_code', 'RATE_LIMITED');
  end if;
  v_rate_allowed := identity.consume_login_rate_limit('init_data', p_init_data_key_hash);
  if not v_rate_allowed then
    return jsonb_build_object('error_code', 'RATE_LIMITED');
  end if;
  if p_entry_kind = 'invalid' then
    return jsonb_build_object('error_code', 'TELEGRAM_START_PARAM_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('identity.login:' || p_operation_id::text, 0));
  select * into v_login from identity.login_requests where operation_id = p_operation_id for update;
  if v_login.operation_id is not null then
    if v_login.request_hash <> p_request_hash then
      return jsonb_build_object('error_code', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    select * into v_user from identity.users where id = v_login.user_id for update;
    if v_user.status = 'banned' then
      update identity.sessions set revoked_at = coalesce(revoked_at, now())
      where user_id = v_user.id and revoked_at is null;
    end if;
    if v_login.account_status = 'banned' or v_user.status = 'banned' then
      return jsonb_build_object('account_status', 'banned');
    end if;
    return jsonb_build_object(
      'session_id', v_login.session_id,
      'user_id', v_login.user_id,
      'account_status', 'normal',
      'preferred_language', v_user.preferred_language,
      'entry_kind', v_login.entry_kind,
      'expires_at', v_login.expires_at
    ) || identity.session_entry_handoff(v_login.session_id);
  end if;

  if p_entry_kind = 'direct' then
    select source.source_code into v_source_code
    from acquisition.sources source
    where source.status = 'active'
      and (
        (p_entry_source_param is null and source.source_code = 'telegram_direct')
        or source.start_param = p_entry_source_param
      )
    for share;
  elsif p_entry_kind = 'referral' then
    select source.source_code into v_source_code
    from acquisition.sources source
    where source.source_code = 'player_referral' and source.status = 'active'
    for share;
  elsif p_entry_kind = 'battle' then
    select source.source_code into v_source_code
    from acquisition.sources source
    where source.source_code = 'battle_share' and source.status = 'active'
    for share;
  end if;
  if v_source_code is null then
    if p_entry_kind = 'direct' and p_entry_source_param is not null then
      return jsonb_build_object('error_code', 'TELEGRAM_START_PARAM_INVALID');
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'ACQUISITION_SOURCE_CONFIGURATION_INVALID';
  end if;

  perform pg_advisory_xact_lock(p_telegram_id);
  insert into identity.users (
    telegram_id, username, first_name, last_name, language_code, referral_code,
    first_source_code
  )
  values (
    p_telegram_id, p_username, p_first_name, p_last_name, p_language_code,
    p_referral_code, v_source_code
  )
  on conflict (telegram_id) do nothing
  returning * into v_user;
  v_new_user := v_user.id is not null;
  if not v_new_user then
    update identity.users
    set username = p_username, first_name = p_first_name, last_name = p_last_name,
        language_code = p_language_code, updated_at = now()
    where telegram_id = p_telegram_id and status = 'normal'
    returning * into v_user;
    if v_user.id is null then
      select * into v_user from identity.users where telegram_id = p_telegram_id;
    end if;
  end if;

  if v_new_user and p_entry_kind = 'referral' then
    insert into identity.entry_candidates (user_id, code, expires_at)
    values (v_user.id, p_entry_referral_code, now() + interval '10 minutes');
  end if;
  select * into v_candidate
  from identity.entry_candidates
  where user_id = v_user.id
  for update;
  if v_candidate.user_id is not null then
    if v_candidate.status = 'pending' then
      v_referral_processed_at := null;
    else
      v_referral_processed_at := coalesce(v_candidate.settled_at, now());
    end if;
  else
    v_referral_processed_at := now();
  end if;
  insert into economy.balances (user_id, currency)
  values (v_user.id, 'KCOIN'), (v_user.id, 'FGEMS')
  on conflict do nothing;

  update identity.sessions set revoked_at = now()
  where user_id = v_user.id and revoked_at is null;
  if v_user.status = 'banned' then
    insert into identity.login_requests (
      operation_id, request_hash, user_id, account_status, session_id, expires_at,
      entry_kind, referral_code, battle_invite_token_hash, source_code
    ) values (
      p_operation_id, p_request_hash, v_user.id, 'banned', null, null,
      p_entry_kind, p_entry_referral_code, p_battle_invite_token_hash, v_source_code
    );
    return jsonb_build_object('account_status', 'banned');
  end if;

  v_expires_at := now() + interval '15 minutes';
  insert into identity.sessions (
    id, user_id, token_hash, auth_date, expires_at, new_user, entry_kind,
    referral_code, battle_invite_token_hash, referral_processed_at, source_code
  ) values (
    p_session_id, v_user.id, p_token_hash, p_auth_date, v_expires_at, v_new_user, p_entry_kind,
    p_entry_referral_code, p_battle_invite_token_hash, v_referral_processed_at,
    v_source_code
  )
  returning id into v_session_id;
  insert into identity.login_requests (
    operation_id, request_hash, user_id, account_status, session_id, expires_at,
    entry_kind, referral_code, battle_invite_token_hash, source_code
  ) values (
    p_operation_id, p_request_hash, v_user.id, 'normal', v_session_id, v_expires_at,
    p_entry_kind, p_entry_referral_code, p_battle_invite_token_hash, v_source_code
  );

  return jsonb_build_object(
    'session_id', v_session_id,
    'user_id', v_user.id,
    'account_status', v_user.status,
    'preferred_language', v_user.preferred_language,
    'entry_kind', p_entry_kind,
    'expires_at', v_expires_at
  ) || identity.session_entry_handoff(v_session_id);
end;
$$;

create or replace function admin.assert_owner_call()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner oid;
begin
  select n.nspowner into v_owner
  from pg_catalog.pg_namespace n
  where n.nspname = 'admin';
  if v_owner is null or not pg_catalog.pg_has_role(current_user, v_owner, 'USAGE') then
    raise exception using
      errcode = '42501',
      message = 'ADMIN_OWNER_REQUIRED';
  end if;
end;
$$;

create or replace function admin.assert_database_identity(
  p_environment text,
  p_project_ref text
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_identity admin.database_identity%rowtype;
begin
  perform admin.assert_owner_call();
  if p_environment is null
    or p_environment not in ('local', 'real_development', 'production')
    or p_project_ref is null
    or p_project_ref !~ '^[a-z]{20}$'
  then
    raise exception using
      errcode = '22023',
      message = 'DATABASE_IDENTITY_INVALID';
  end if;
  select * into v_identity
  from admin.database_identity
  where singleton;
  if v_identity.singleton is null
    or v_identity.environment <> p_environment
    or v_identity.project_ref <> p_project_ref
  then
    raise exception using
      errcode = 'P0001',
      message = 'DATABASE_IDENTITY_MISMATCH';
  end if;
end;
$$;

create or replace function admin.acquisition_source_register(
  p_environment text,
  p_project_ref text,
  p_source_code text,
  p_channel_code text,
  p_platform_code text,
  p_campaign_code text,
  p_ad_group_code text,
  p_creative_code text,
  p_link_label text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source acquisition.sources%rowtype;
  v_start_param text;
  v_attempt integer;
begin
  perform admin.assert_database_identity(p_environment, p_project_ref);
  if p_source_code is null
    or p_source_code !~ '^[a-z][a-z0-9_]{2,63}$'
    or p_source_code in (
      'legacy_unknown',
      'telegram_direct',
      'tgapp_listing',
      'player_referral',
      'battle_share'
    )
    or p_channel_code is null
    or p_channel_code not in ('directory', 'paid_ad')
    or p_platform_code is null
    or p_platform_code !~ '^[a-z][a-z0-9_]{1,31}$'
    or p_campaign_code is null
    or p_campaign_code !~ '^[a-z0-9][a-z0-9_.-]{0,63}$'
    or (p_ad_group_code is not null and p_ad_group_code !~ '^[a-z0-9][a-z0-9_.-]{0,63}$')
    or (p_creative_code is not null and p_creative_code !~ '^[a-z0-9][a-z0-9_.-]{0,63}$')
    or p_link_label is null
    or btrim(p_link_label) = ''
    or char_length(p_link_label) > 160
  then
    raise exception using
      errcode = '22023',
      message = 'ACQUISITION_SOURCE_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('admin.acquisition.source:' || p_source_code, 0)
  );
  select * into v_source
  from acquisition.sources source
  where source.source_code = p_source_code
  for update;
  if v_source.source_code is not null then
    if v_source.channel_code is distinct from p_channel_code
      or v_source.platform_code is distinct from p_platform_code
      or v_source.campaign_code is distinct from p_campaign_code
      or v_source.ad_group_code is distinct from p_ad_group_code
      or v_source.creative_code is distinct from p_creative_code
      or v_source.link_label is distinct from p_link_label
    then
      raise exception using
        errcode = '23505',
        message = 'ACQUISITION_SOURCE_CODE_CONFLICT';
    end if;
    return jsonb_build_object(
      'source_code', v_source.source_code,
      'start_param', v_source.start_param,
      'status', v_source.status,
      'created_at', v_source.created_at,
      'replayed', true
    );
  end if;

  for v_attempt in 1..5 loop
    v_start_param := 'SRC_' || upper(encode(extensions.gen_random_bytes(10), 'hex'));
    begin
      insert into acquisition.sources (
        source_code,
        start_param,
        channel_code,
        platform_code,
        campaign_code,
        ad_group_code,
        creative_code,
        link_label
      ) values (
        p_source_code,
        v_start_param,
        p_channel_code,
        p_platform_code,
        p_campaign_code,
        p_ad_group_code,
        p_creative_code,
        p_link_label
      )
      returning * into v_source;
      exit;
    exception when unique_violation then
      v_source := null;
    end;
  end loop;
  if v_source.source_code is null then
    raise exception using
      errcode = 'P0001',
      message = 'ACQUISITION_SOURCE_TOKEN_GENERATION_FAILED';
  end if;

  return jsonb_build_object(
    'source_code', v_source.source_code,
    'start_param', v_source.start_param,
    'status', v_source.status,
    'created_at', v_source.created_at,
    'replayed', false
  );
end;
$$;

create or replace function admin.acquisition_source_disable(
  p_environment text,
  p_project_ref text,
  p_source_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source acquisition.sources%rowtype;
begin
  perform admin.assert_database_identity(p_environment, p_project_ref);
  if p_source_code is null then
    raise exception using
      errcode = '22023',
      message = 'ACQUISITION_SOURCE_INVALID';
  end if;
  if p_source_code in (
    'legacy_unknown',
    'telegram_direct',
    'tgapp_listing',
    'player_referral',
    'battle_share'
  ) then
    raise exception using
      errcode = '22023',
      message = 'ACQUISITION_SYSTEM_SOURCE_IMMUTABLE';
  end if;
  select * into v_source
  from acquisition.sources source
  where source.source_code = p_source_code
  for update;
  if v_source.source_code is null then
    raise exception using
      errcode = 'P0001',
      message = 'ACQUISITION_SOURCE_NOT_FOUND';
  end if;
  if v_source.status = 'active' then
    update acquisition.sources
    set status = 'disabled',
        disabled_at = now(),
        disabled_by = current_user
    where source_code = p_source_code
    returning * into v_source;
  end if;
  return jsonb_build_object(
    'source_code', v_source.source_code,
    'start_param', v_source.start_param,
    'status', v_source.status,
    'disabled_at', v_source.disabled_at
  );
end;
$$;

create or replace function admin.acquisition_sources()
returns table (
  source_code text,
  start_param text,
  channel_code text,
  platform_code text,
  campaign_code text,
  ad_group_code text,
  creative_code text,
  link_label text,
  status text,
  created_at timestamptz,
  disabled_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform admin.assert_owner_call();
  return query
  select
    source.source_code,
    source.start_param,
    source.channel_code,
    source.platform_code,
    source.campaign_code,
    source.ad_group_code,
    source.creative_code,
    source.link_label,
    source.status,
    source.created_at,
    source.disabled_at
  from acquisition.sources source
  order by source.created_at, source.source_code;
end;
$$;

create or replace function admin.acquisition_report(
  p_cohort_from timestamptz,
  p_cohort_to timestamptz
)
returns table (
  source_code text,
  start_param text,
  channel_code text,
  platform_code text,
  campaign_code text,
  ad_group_code text,
  creative_code text,
  link_label text,
  status text,
  new_users bigint,
  unique_login_users bigint,
  successful_logins bigint,
  activated_users bigint,
  d1_eligible_users bigint,
  d1_retained_users bigint,
  d7_eligible_users bigint,
  d7_retained_users bigint,
  payer_users bigint,
  gross_stars bigint,
  refund_stars bigint,
  net_stars bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform admin.assert_owner_call();
  if p_cohort_from is null or p_cohort_to is null or p_cohort_from >= p_cohort_to then
    raise exception using
      errcode = '22023',
      message = 'ACQUISITION_REPORT_RANGE_INVALID';
  end if;
  return query
  with cohort as (
    select
      account.id as user_id,
      account.first_source_code,
      (account.created_at at time zone 'utc')::date as registration_date
    from identity.users account
    where account.created_at >= p_cohort_from
      and account.created_at < p_cohort_to
  ), cohort_rollup as (
    select
      cohort.first_source_code,
      count(*) as new_users,
      count(*) filter (
        where exists (
          select 1
          from tasks.daily_progress progress
          where progress.user_id = cohort.user_id
            and progress.task_code in ('gacha_1', 'gacha_10', 'gacha_ten')
            and progress.progress > 0
        )
      ) as activated_users,
      count(*) filter (
        where cohort.registration_date + 1 < (now() at time zone 'utc')::date
      ) as d1_eligible_users,
      count(*) filter (
        where cohort.registration_date + 1 < (now() at time zone 'utc')::date
          and exists (
            select 1
            from identity.sessions retained_session
            where retained_session.user_id = cohort.user_id
              and (retained_session.created_at at time zone 'utc')::date = cohort.registration_date + 1
          )
      ) as d1_retained_users,
      count(*) filter (
        where cohort.registration_date + 7 < (now() at time zone 'utc')::date
      ) as d7_eligible_users,
      count(*) filter (
        where cohort.registration_date + 7 < (now() at time zone 'utc')::date
          and exists (
            select 1
            from identity.sessions retained_session
            where retained_session.user_id = cohort.user_id
              and (retained_session.created_at at time zone 'utc')::date = cohort.registration_date + 7
          )
      ) as d7_retained_users
    from cohort
    group by cohort.first_source_code
  ), session_rollup as (
    select
      session.source_code,
      count(distinct session.user_id) as unique_login_users,
      count(*) as successful_logins
    from identity.sessions session
    where session.created_at >= p_cohort_from
      and session.created_at < p_cohort_to
    group by session.source_code
  ), payment_rollup as (
    select
      cohort.first_source_code,
      count(distinct payment.user_id) as payer_users,
      coalesce(sum(payment.stars_amount), 0)::bigint as gross_stars,
      coalesce(sum(payment.refunded_stars), 0)::bigint as refund_stars
    from cohort
    join payments.orders payment on payment.user_id = cohort.user_id
    where payment.paid_at is not null
    group by cohort.first_source_code
  )
  select
    source.source_code,
    source.start_param,
    source.channel_code,
    source.platform_code,
    source.campaign_code,
    source.ad_group_code,
    source.creative_code,
    source.link_label,
    source.status,
    coalesce(cohort_metric.new_users, 0),
    coalesce(session_metric.unique_login_users, 0),
    coalesce(session_metric.successful_logins, 0),
    coalesce(cohort_metric.activated_users, 0),
    coalesce(cohort_metric.d1_eligible_users, 0),
    coalesce(cohort_metric.d1_retained_users, 0),
    coalesce(cohort_metric.d7_eligible_users, 0),
    coalesce(cohort_metric.d7_retained_users, 0),
    coalesce(payment_metric.payer_users, 0),
    coalesce(payment_metric.gross_stars, 0),
    coalesce(payment_metric.refund_stars, 0),
    coalesce(payment_metric.gross_stars, 0) - coalesce(payment_metric.refund_stars, 0)
  from acquisition.sources source
  left join cohort_rollup cohort_metric
    on cohort_metric.first_source_code = source.source_code
  left join session_rollup session_metric
    on session_metric.source_code = source.source_code
  left join payment_rollup payment_metric
    on payment_metric.first_source_code = source.source_code
  order by source.platform_code, source.campaign_code nulls first, source.source_code;
end;
$$;

alter table acquisition.sources enable row level security;

revoke all on schema acquisition from public, anon, authenticated, service_role;
revoke all on table acquisition.sources from public, anon, authenticated, service_role;
revoke execute on all functions in schema acquisition from public, anon, authenticated, service_role;

alter default privileges in schema acquisition
revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema acquisition
revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema acquisition
revoke execute on functions from public, anon, authenticated, service_role;

revoke execute on function admin.assert_database_identity(text, text)
from public, anon, authenticated, service_role;
revoke execute on function admin.acquisition_source_register(
  text, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke execute on function admin.acquisition_source_disable(text, text, text)
from public, anon, authenticated, service_role;
revoke execute on function admin.acquisition_sources()
from public, anon, authenticated, service_role;
revoke execute on function admin.acquisition_report(timestamptz, timestamptz)
from public, anon, authenticated, service_role;

revoke execute on function api.identity_authenticate(
  uuid, text, text, text, bigint, text, text, text, text, text, uuid, text,
  timestamptz, text, text, text, text
) from public, anon, authenticated;
grant execute on function api.identity_authenticate(
  uuid, text, text, text, bigint, text, text, text, text, text, uuid, text,
  timestamptz, text, text, text, text
) to service_role;

notify pgrst, 'reload schema';
