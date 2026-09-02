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
