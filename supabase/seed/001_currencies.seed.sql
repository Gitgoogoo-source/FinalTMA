-- 001_currencies.seed.sql
-- Base currency catalog. Internal balances are limited to KCOIN and FGEMS.

begin;

insert into economy.currencies (
  code,
  display_name,
  symbol,
  decimals,
  currency_type,
  is_spendable,
  is_transferable,
  metadata
) values
  (
    'KCOIN',
    'K-coin',
    'K',
    0,
    'internal',
    true,
    false,
    '{"description":"Main game currency for marketplace purchases and synthesis costs."}'::jsonb
  ),
  (
    'FGEMS',
    'Fgems',
    'F',
    0,
    'internal',
    true,
    false,
    '{"description":"Growth currency obtained from decomposition and tasks, used for upgrades."}'::jsonb
  ),
  (
    'XTR',
    'Telegram Stars',
    '⭐',
    0,
    'external',
    false,
    false,
    '{"telegram_currency":"XTR","description":"Telegram Stars payment unit. Not an internal user balance."}'::jsonb
  ),
  (
    'STAR_DISPLAY',
    'Stars Display',
    '⭐',
    0,
    'display',
    false,
    false,
    '{"description":"Display-only Stars balance placeholder for UI and payment history."}'::jsonb
  )
on conflict (code) do update
set display_name = excluded.display_name,
    symbol = excluded.symbol,
    decimals = excluded.decimals,
    currency_type = excluded.currency_type,
    is_spendable = excluded.is_spendable,
    is_transferable = excluded.is_transferable,
    metadata = economy.currencies.metadata || excluded.metadata;

commit;
