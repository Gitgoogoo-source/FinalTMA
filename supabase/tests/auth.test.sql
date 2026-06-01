-- This pgTAP test is designed for the Telegram Mini App blind-box game schema.
-- Run after migrations, RPC files and RLS files have been applied.
-- Each file wraps its fixture data in a transaction and rolls back at the end.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.raises_like(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return lower(sqlerrm) like lower(p_pattern);
end;
$$;

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null,
  p_start_param text default null
)
returns uuid
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := api.auth_upsert_telegram_user(
    p_telegram_user_id := p_telegram_user_id,
    p_username := coalesce(p_username, 'u' || p_telegram_user_id::text),
    p_first_name := 'Test',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := p_start_param,
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.balance_of(p_user_id uuid, p_currency_code text)
returns numeric
language sql
stable
as $$
  select coalesce((
    select available_amount
    from economy.user_balances
    where user_id = p_user_id and currency_code = upper(p_currency_code)
  ), 0)::numeric;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;

insert into _ids (key, payload)
select 'inviter_payload', api.auth_upsert_telegram_user(
  p_telegram_user_id := 9100000001,
  p_username := 'inviter_auth_test',
  p_first_name := 'Invite',
  p_last_name := 'Owner',
  p_language_code := 'en',
  p_is_premium := true,
  p_photo_url := 'https://example.test/inviter.png',
  p_start_param := null,
  p_metadata := '{"case":"auth"}'::jsonb
);

insert into _ids (key, id, txt)
select 'inviter', (payload ->> 'user_id')::uuid, payload ->> 'invite_code'
from _ids where key = 'inviter_payload';

insert into _ids (key, payload)
select 'invitee_payload', api.auth_upsert_telegram_user(
  p_telegram_user_id := 9100000002,
  p_username := 'invitee_auth_test',
  p_first_name := 'Invitee',
  p_last_name := 'User',
  p_language_code := 'en',
  p_is_premium := false,
  p_photo_url := 'https://example.test/invitee.png',
  p_start_param := (select txt from _ids where key = 'inviter'),
  p_metadata := '{"case":"auth_referral"}'::jsonb
);

insert into _ids (key, id, txt)
select 'invitee', (payload ->> 'user_id')::uuid, payload ->> 'invite_code'
from _ids where key = 'invitee_payload';

select ok(to_regprocedure('api.auth_upsert_telegram_user(bigint,text,text,text,text,boolean,text,text,jsonb)') is not null, 'auth_upsert_telegram_user RPC exists');
select ok(to_regprocedure('api.auth_create_session(uuid,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text)') is not null, 'auth_create_session RPC exists');
select ok(exists (select 1 from core.users where telegram_user_id = 9100000001 and username = 'inviter_auth_test'), 'inviter user was created from verified Telegram identity');
select ok(exists (select 1 from core.user_profiles p join _ids i on i.id = p.user_id where i.key = 'inviter' and p.display_name = 'Invite Owner'), 'profile row was created with display name');
select is((select count(*)::int from economy.user_balances b join _ids i on i.id = b.user_id where i.key = 'inviter'), 2, 'KCOIN and FGEMS balance rows are initialized');
select ok(exists (select 1 from tasks.referrals r join _ids i on i.id = r.invitee_user_id where i.key = 'invitee' and r.status = 'pending'), 'start_param created pending referral relationship');
select is(
  (
    select r.metadata ->> 'surface'
    from tasks.referrals r
    join _ids i on i.id = r.invitee_user_id
    where i.key = 'invitee'
  ),
  'auth_upsert_telegram_user',
  'start_param referral binding is delegated through referral_bind_inviter'
);
select is(
  (
    select count(*)::int
    from ops.idempotency_keys k
    join _ids i on i.id = k.user_id
    where i.key = 'invitee'
      and k.scope = 'referral_bind_inviter'
  ),
  1,
  'start_param referral binding records referral_bind_inviter idempotency'
);

insert into _ids (key, payload)
select 'invitee_repeat_payload', api.auth_upsert_telegram_user(
  p_telegram_user_id := 9100000002,
  p_username := 'invitee_auth_test_repeat',
  p_first_name := 'Invitee',
  p_last_name := 'User',
  p_language_code := 'en',
  p_is_premium := false,
  p_photo_url := 'https://example.test/invitee-repeat.png',
  p_start_param := (select txt from _ids where key = 'inviter'),
  p_metadata := '{"case":"auth_referral_repeat"}'::jsonb
);

select is(
  (
    select count(*)::int
    from tasks.referrals r
    join _ids i on i.id = r.invitee_user_id
    where i.key = 'invitee'
  ),
  1,
  'repeated auth start_param bind with the same inviter does not duplicate referral'
);

insert into _ids (key, payload)
select 'updated_payload', api.auth_upsert_telegram_user(
  p_telegram_user_id := 9100000001,
  p_username := 'inviter_auth_test_updated',
  p_first_name := 'Invite',
  p_last_name := 'Owner2',
  p_language_code := 'zh-hans',
  p_is_premium := false,
  p_photo_url := null,
  p_start_param := null,
  p_metadata := '{"case":"auth_update"}'::jsonb
);

select is((select count(*)::int from core.users where telegram_user_id = 9100000001), 1, 'upsert does not create duplicate Telegram users');
select is((select username::text from core.users where telegram_user_id = 9100000001), 'inviter_auth_test_updated', 'upsert updates Telegram username');
select is((select selected_language from core.user_profiles p join _ids i on i.id = p.user_id where i.key = 'inviter'), 'zh-hans', 'profile selected language is refreshed');

insert into _ids (key, payload)
select 'restricted_payload', api.auth_upsert_telegram_user(
  p_telegram_user_id := 9100000004,
  p_username := 'restricted_auth_test',
  p_first_name := 'Restricted',
  p_last_name := 'Before',
  p_language_code := 'en',
  p_is_premium := false,
  p_photo_url := 'https://example.test/restricted-before.png',
  p_start_param := null,
  p_metadata := '{"case":"auth_restricted_seed"}'::jsonb
);

insert into _ids (key, id)
select 'restricted', (payload ->> 'user_id')::uuid
from _ids where key = 'restricted_payload';

update core.users
set status = 'restricted',
    username = 'restricted_auth_test_before',
    first_name = 'Restricted',
    last_name = 'Before',
    language_code = 'en',
    photo_url = 'https://example.test/restricted-before.png',
    updated_at = '2026-01-01T00:00:00Z'::timestamptz,
    last_auth_at = '2026-01-01T00:00:00Z'::timestamptz
where id = (select id from _ids where key = 'restricted');

update core.user_profiles
set display_name = 'Restricted Before',
    avatar_url = 'https://example.test/restricted-before.png',
    selected_language = 'en',
    updated_at = '2026-01-01T00:00:00Z'::timestamptz
where user_id = (select id from _ids where key = 'restricted');

select ok(
  testutil.raises_like(
    $sql$
      select api.auth_upsert_telegram_user(
        p_telegram_user_id := 9100000004,
        p_username := 'restricted_auth_test_after',
        p_first_name := 'Restricted',
        p_last_name := 'After',
        p_language_code := 'zh-hans',
        p_is_premium := true,
        p_photo_url := 'https://example.test/restricted-after.png',
        p_start_param := null,
        p_metadata := '{"case":"auth_restricted_retry"}'::jsonb
      )
    $sql$,
    '%auth_user_not_active:restricted%'
  ),
  'restricted users are rejected before auth upsert writes profile or balances'
);

select is((select username::text from core.users where telegram_user_id = 9100000004), 'restricted_auth_test_before', 'restricted auth retry does not update username');
select is((select last_name from core.users where telegram_user_id = 9100000004), 'Before', 'restricted auth retry does not update user profile fields on core.users');
select is((select selected_language from core.user_profiles where user_id = (select id from _ids where key = 'restricted')), 'en', 'restricted auth retry does not update core.user_profiles');
select is(
  (select count(*)::int from economy.user_balances where user_id = (select id from _ids where key = 'restricted')),
  2,
  'restricted auth retry does not create duplicate balance rows'
);

insert into _ids (key, payload)
select 'second_inviter_payload', api.auth_upsert_telegram_user(
  p_telegram_user_id := 9100000003,
  p_username := 'second_inviter_auth_test',
  p_first_name := 'Second',
  p_last_name := 'Inviter',
  p_language_code := 'en',
  p_is_premium := false,
  p_photo_url := 'https://example.test/second-inviter.png',
  p_start_param := null,
  p_metadata := '{"case":"auth_second_inviter"}'::jsonb
);

insert into _ids (key, id, txt)
select 'second_inviter', (payload ->> 'user_id')::uuid, payload ->> 'invite_code'
from _ids where key = 'second_inviter_payload';

insert into _ids (key, payload)
select 'invitee_rebind_payload', api.auth_upsert_telegram_user(
  p_telegram_user_id := 9100000002,
  p_username := 'invitee_auth_test_rebind',
  p_first_name := 'Invitee',
  p_last_name := 'User',
  p_language_code := 'en',
  p_is_premium := false,
  p_photo_url := 'https://example.test/invitee-rebind.png',
  p_start_param := (select txt from _ids where key = 'second_inviter'),
  p_metadata := '{"case":"auth_referral_rebind"}'::jsonb
);

select is(
  (
    select inviter_user_id
    from tasks.referrals
    where invitee_user_id = (select id from _ids where key = 'invitee')
  ),
  (select id from _ids where key = 'inviter'),
  'different start_param inviter does not replace existing referral'
);
select is(
  (
    select count(*)::int
    from ops.risk_events
    where user_id = (select id from _ids where key = 'invitee')
      and event_type = 'referral_rebind_attempt'
  ),
  1,
  'different start_param inviter writes referral rebind risk event'
);

insert into _ids (key, payload)
select 'self_referral_payload', api.auth_upsert_telegram_user(
  p_telegram_user_id := 9100000001,
  p_username := 'inviter_auth_test_self',
  p_first_name := 'Invite',
  p_last_name := 'Owner2',
  p_language_code := 'zh-hans',
  p_is_premium := false,
  p_photo_url := null,
  p_start_param := (select txt from _ids where key = 'inviter'),
  p_metadata := '{"case":"auth_self_referral"}'::jsonb
);

select is(
  (
    select count(*)::int
    from tasks.referrals
    where invitee_user_id = (select id from _ids where key = 'inviter')
  ),
  0,
  'self start_param does not create a referral'
);
select is(
  (
    select count(*)::int
    from ops.risk_events
    where user_id = (select id from _ids where key = 'inviter')
      and event_type = 'referral_self_invite'
  ),
  1,
  'self start_param writes referral self-invite risk event'
);

insert into _ids (key, payload)
select 'session_payload', api.auth_create_session(
  p_user_id := (select id from _ids where key = 'inviter'),
  p_session_token_hash := 'auth-test-token-hash-001',
  p_expires_at := now() + interval '1 hour',
  p_telegram_auth_date := now(),
  p_init_data_hash := 'auth-test-init-hash-001',
  p_ip_hash := 'ip-hash-auth-test',
  p_user_agent := 'pgTAP auth test',
  p_device_id := 'device-auth-test',
  p_platform := 'ios'
);

select ok(exists (select 1 from core.app_sessions where session_token_hash = 'auth-test-token-hash-001' and revoked_at is null), 'session row was created');
select ok(exists (select 1 from core.user_devices d join _ids i on i.id = d.user_id where i.key = 'inviter' and d.device_key = 'device-auth-test'), 'device row was upserted from session creation');
select is(((select payload from _ids where key = 'session_payload') ->> 'revoked_device_session_count')::int, 0, 'initial session creation does not revoke device sessions');

select ok(
  testutil.raises_like(
    $sql$
      select api.auth_create_session(
        p_user_id := (select id from _ids where key = 'inviter'),
        p_session_token_hash := 'auth-test-token-hash-replayed',
        p_expires_at := now() + interval '1 hour',
        p_telegram_auth_date := now(),
        p_init_data_hash := 'auth-test-init-hash-001',
        p_ip_hash := 'ip-hash-auth-test',
        p_user_agent := 'pgTAP auth test replay',
        p_device_id := 'device-auth-test-replay',
        p_platform := 'ios'
      )
    $sql$,
    '%auth_init_data_replayed%'
  ),
  'auth_create_session rejects replayed Telegram initData hash'
);

insert into _ids (key, payload)
select 'session_same_device_retry_payload', api.auth_create_session(
  p_user_id := (select id from _ids where key = 'inviter'),
  p_session_token_hash := 'auth-test-token-hash-001-retry',
  p_expires_at := now() + interval '1 hour',
  p_telegram_auth_date := now(),
  p_init_data_hash := 'auth-test-init-hash-001',
  p_ip_hash := 'ip-hash-auth-test',
  p_user_agent := 'pgTAP auth test',
  p_device_id := 'device-auth-test',
  p_platform := 'ios'
);

select ok(exists (select 1 from core.app_sessions where session_token_hash = 'auth-test-token-hash-001' and revoked_at is not null), 'same-device initData retry revokes previous matching session');
select ok(exists (select 1 from core.app_sessions where session_token_hash = 'auth-test-token-hash-001-retry' and revoked_at is null), 'same-device initData retry creates a replacement session');
select is(((select payload from _ids where key = 'session_same_device_retry_payload') ->> 'revoked_replayed_session_count')::int, 1, 'same-device initData retry reports replay replacement count');
select is(((select payload from _ids where key = 'session_same_device_retry_payload') ->> 'revoked_device_session_count')::int, 0, 'same-device initData retry does not double-count device revocation');

insert into _ids (key, payload)
select 'session_same_device_payload', api.auth_create_session(
  p_user_id := (select id from _ids where key = 'inviter'),
  p_session_token_hash := 'auth-test-token-hash-002',
  p_expires_at := now() + interval '1 hour',
  p_telegram_auth_date := now(),
  p_init_data_hash := 'auth-test-init-hash-002',
  p_ip_hash := 'ip-hash-auth-test',
  p_user_agent := 'pgTAP auth test',
  p_device_id := 'device-auth-test',
  p_platform := 'ios'
);

select ok(exists (select 1 from core.app_sessions where session_token_hash = 'auth-test-token-hash-001' and revoked_at is not null), 'new same-device session revokes previous active device session');
select ok(exists (select 1 from core.app_sessions where session_token_hash = 'auth-test-token-hash-002' and revoked_at is null), 'new same-device session remains active');
select is(((select payload from _ids where key = 'session_same_device_payload') ->> 'revoked_device_session_count')::int, 1, 'same-device session reports revoked session count');

insert into core.app_sessions (
  user_id,
  session_token_hash,
  expires_at,
  telegram_auth_date,
  init_data_hash,
  ip_hash,
  user_agent,
  device_id,
  platform,
  last_seen_at
) values (
  (select id from _ids where key = 'inviter'),
  'auth-test-token-hash-expired-old',
  now() - interval '1 minute',
  now() - interval '2 minutes',
  'auth-test-init-hash-expired',
  'ip-hash-auth-expired-old',
  'pgTAP auth expired old',
  'device-auth-expired-old',
  'ios',
  now() - interval '2 minutes'
);

insert into _ids (key, payload)
select 'session_expired_replay_payload', api.auth_create_session(
  p_user_id := (select id from _ids where key = 'inviter'),
  p_session_token_hash := 'auth-test-token-hash-expired-new',
  p_expires_at := now() + interval '1 hour',
  p_telegram_auth_date := now(),
  p_init_data_hash := 'auth-test-init-hash-expired',
  p_ip_hash := 'ip-hash-auth-expired-new',
  p_user_agent := 'pgTAP auth expired new',
  p_device_id := 'device-auth-expired-new',
  p_platform := 'ios'
);

select ok(exists (select 1 from core.app_sessions where session_token_hash = 'auth-test-token-hash-expired-new' and revoked_at is null), 'expired historical initData hash does not block new session creation');
select is(((select payload from _ids where key = 'session_expired_replay_payload') ->> 'revoked_replayed_session_count')::int, 0, 'expired historical initData hash is not counted as replay replacement');

insert into core.app_sessions (
  user_id,
  session_token_hash,
  expires_at,
  revoked_at,
  telegram_auth_date,
  init_data_hash,
  ip_hash,
  user_agent,
  device_id,
  platform,
  last_seen_at
) values (
  (select id from _ids where key = 'inviter'),
  'auth-test-token-hash-revoked-old',
  now() + interval '1 hour',
  now() - interval '1 minute',
  now() - interval '2 minutes',
  'auth-test-init-hash-revoked',
  'ip-hash-auth-revoked-old',
  'pgTAP auth revoked old',
  'device-auth-revoked-old',
  'ios',
  now() - interval '2 minutes'
);

insert into _ids (key, payload)
select 'session_revoked_replay_payload', api.auth_create_session(
  p_user_id := (select id from _ids where key = 'inviter'),
  p_session_token_hash := 'auth-test-token-hash-revoked-new',
  p_expires_at := now() + interval '1 hour',
  p_telegram_auth_date := now(),
  p_init_data_hash := 'auth-test-init-hash-revoked',
  p_ip_hash := 'ip-hash-auth-revoked-new',
  p_user_agent := 'pgTAP auth revoked new',
  p_device_id := 'device-auth-revoked-new',
  p_platform := 'ios'
);

select ok(exists (select 1 from core.app_sessions where session_token_hash = 'auth-test-token-hash-revoked-new' and revoked_at is null), 'revoked historical initData hash does not block new session creation');
select is(((select payload from _ids where key = 'session_revoked_replay_payload') ->> 'revoked_replayed_session_count')::int, 0, 'revoked historical initData hash is not counted as replay replacement');

insert into _ids (key, payload)
select 'session_cap_' || n::text, api.auth_create_session(
  p_user_id := (select id from _ids where key = 'inviter'),
  p_session_token_hash := 'auth-cap-token-hash-' || n::text,
  p_expires_at := now() + interval '1 hour',
  p_telegram_auth_date := now(),
  p_init_data_hash := 'auth-cap-init-hash-' || n::text,
  p_ip_hash := 'ip-hash-auth-cap',
  p_user_agent := 'pgTAP auth cap test',
  p_device_id := 'device-auth-cap-' || n::text,
  p_platform := 'ios'
)
from generate_series(1, 12) as n;

select cmp_ok(
  (
    select count(*)::int
    from core.app_sessions
    where user_id = (select id from _ids where key = 'inviter')
      and revoked_at is null
      and expires_at > now()
  ),
  '<=',
  10,
  'auth_create_session caps active sessions per user'
);

insert into _ids (key, payload)
select 'bootstrap', api.get_user_bootstrap((select id from _ids where key = 'inviter'));

select ok(((select payload from _ids where key = 'bootstrap') ? 'profile'), 'bootstrap returns profile object');
select ok(((select payload from _ids where key = 'bootstrap') -> 'balances' ? 'KCOIN'), 'bootstrap returns KCOIN balance');
select ok(((select payload from _ids where key = 'bootstrap') -> 'feature_flags' ? 'gacha.open_box'), 'bootstrap returns feature flags');
select ok(testutil.raises_like('select api.auth_upsert_telegram_user(null::bigint)', '%telegram_user_id is required%'), 'auth_upsert rejects null Telegram user id');

select * from finish();

rollback;
