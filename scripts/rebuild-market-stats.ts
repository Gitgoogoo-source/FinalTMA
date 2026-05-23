import { callRpcRaw } from "../packages/server/src/db/rpc.js";

type RefreshMarketStatsPayload = {
  snapshot_at?: string | null;
  price_snapshot_count?: number | string | null;
  depth_snapshot_count?: number | string | null;
  price_health_update_count?: number | string | null;
};

async function main(): Promise<void> {
  const requestId = `script-rebuild-market-stats-${Date.now()}`;
  const startedAt = Date.now();
  const payload = await callRpcRaw<RefreshMarketStatsPayload>(
    "market_refresh_price_stats",
    {},
    {
      schema: "api" as never,
      context: {
        requestId,
        source: "scripts.rebuild_market_stats",
      },
    },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        requestId,
        elapsedMs: Date.now() - startedAt,
        snapshotAt: payload.snapshot_at ?? null,
        priceSnapshotCount: toNonNegativeInteger(payload.price_snapshot_count),
        depthSnapshotCount: toNonNegativeInteger(payload.depth_snapshot_count),
        priceHealthUpdateCount: toNonNegativeInteger(
          payload.price_health_update_count,
        ),
      },
      null,
      2,
    ),
  );
}

function toNonNegativeInteger(
  value: number | string | null | undefined,
): number {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return 0;
  }

  return Math.trunc(numberValue);
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
