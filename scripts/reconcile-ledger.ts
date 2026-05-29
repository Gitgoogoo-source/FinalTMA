import {
  runPhase5Reconciliation,
  type Phase5ReconciliationRunType,
} from "../packages/server/src/jobs/ledgerReconcileJob.js";

const ALLOWED_RUN_TYPES: ReadonlySet<Phase5ReconciliationRunType> = new Set([
  "payment_fulfillment",
  "mint_queue",
  "wallet_sync",
  "ledger_balance",
]);

async function main(): Promise<void> {
  const requestId = `script-reconcile-ledger-${Date.now()}`;
  const startedAt = Date.now();
  const result = await runPhase5Reconciliation({
    requestId,
    runTypes: parseRunTypes(process.env.PHASE5_RECONCILIATION_RUN_TYPES),
    limit: parseLimit(process.env.PHASE5_RECONCILIATION_LIMIT),
    createdBy: "scripts.reconcile-ledger",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        requestId,
        elapsedMs: Date.now() - startedAt,
        runs: result.runs.map((run) => ({
          runType: run.runType,
          runId: run.runId,
          status: run.status,
          findingCount: run.findingCount,
          riskEventCount: run.riskEventCount,
        })),
        serverTime: result.serverTime,
      },
      null,
      2,
    ),
  );
}

function parseRunTypes(
  value: string | undefined,
): Phase5ReconciliationRunType[] | undefined {
  if (!value) {
    return undefined;
  }

  const runTypes = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (runTypes.length === 0) {
    return undefined;
  }

  for (const runType of runTypes) {
    if (!ALLOWED_RUN_TYPES.has(runType as Phase5ReconciliationRunType)) {
      throw new Error(`Invalid reconciliation run type: ${runType}`);
    }
  }

  return runTypes as Phase5ReconciliationRunType[];
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("PHASE5_RECONCILIATION_LIMIT must be a positive integer.");
  }

  return parsed;
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
