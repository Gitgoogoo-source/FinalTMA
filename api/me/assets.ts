import { ApiError, withApiHandler } from '../_shared/handler.js';
import { getSupabaseAdmin, requireSession } from '../_shared/requireSession.js';

type CurrencyCode = 'KCOIN' | 'FGEMS' | 'STAR_DISPLAY';

type BalanceRow = {
  currency_code: string;
  available_amount: string | number | null;
  locked_amount: string | number | null;
  updated_at: string | null;
};

type AssetBalance = {
  currencyCode: CurrencyCode;
  available: string;
  locked: string;
};

const ASSET_CURRENCIES: CurrencyCode[] = ['KCOIN', 'FGEMS', 'STAR_DISPLAY'];

export default withApiHandler(
  async (req) => {
    const session = await requireSession(req);
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .schema('economy')
      .from('user_balances')
      .select('currency_code,available_amount,locked_amount,updated_at')
      .eq('user_id', session.userId)
      .in('currency_code', ASSET_CURRENCIES)
      .returns<BalanceRow[]>();

    if (error) {
      throw new ApiError(500, 'ASSET_BALANCE_LOOKUP_FAILED', '查询资产余额失败。', {
        details: error,
        expose: false,
      });
    }

    const balances = buildAssetBalances(data ?? []);

    return {
      userId: session.userId,
      balances,
      assets: {
        kcoin: balances.KCOIN,
        fgems: balances.FGEMS,
        stars: balances.STAR_DISPLAY,
      },
      updatedAt: getLatestUpdatedAt(data ?? []),
    };
  },
  {
    methods: ['GET'],
    rateLimit: {
      action: 'me.assets',
    },
  },
);

function buildAssetBalances(rows: BalanceRow[]): Record<CurrencyCode, AssetBalance> {
  const byCurrency = new Map(rows.map((row) => [row.currency_code, row]));

  return {
    KCOIN: toAssetBalance('KCOIN', byCurrency.get('KCOIN')),
    FGEMS: toAssetBalance('FGEMS', byCurrency.get('FGEMS')),
    STAR_DISPLAY: toAssetBalance('STAR_DISPLAY', byCurrency.get('STAR_DISPLAY')),
  };
}

function toAssetBalance(currencyCode: CurrencyCode, row: BalanceRow | undefined): AssetBalance {
  return {
    currencyCode,
    available: normalizeAmount(row?.available_amount),
    locked: normalizeAmount(row?.locked_amount),
  };
}

function normalizeAmount(value: string | number | null | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return value;
  }

  return '0';
}

function getLatestUpdatedAt(rows: BalanceRow[]): string | null {
  let latestMs = 0;
  let latest: string | null = null;

  for (const row of rows) {
    if (!row.updated_at) {
      continue;
    }

    const timeMs = Date.parse(row.updated_at);

    if (Number.isFinite(timeMs) && timeMs > latestMs) {
      latestMs = timeMs;
      latest = row.updated_at;
    }
  }

  return latest;
}
