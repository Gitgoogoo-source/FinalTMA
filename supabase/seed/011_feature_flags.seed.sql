-- 011_feature_flags.seed.sql
-- Feature flag and operational setting defaults.

begin;

insert into ops.system_settings (key, value, description)
values (
  'REFERRAL_COMMISSION_BPS',
  '{"commission_bps":1000}'::jsonb,
  'Referral commission rate in basis points for post-first-open gacha rewards.'
)
on conflict (key) do update
set description = excluded.description,
    updated_at = now();

commit;
