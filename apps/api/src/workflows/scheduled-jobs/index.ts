import { rpc } from "../../platform/db/index.ts";
import { reconcileSubmittedMints } from "../mint-reconciliation/reconcile.ts";

const names = [
  "reconcile-payments",
  "reconcile-mints",
  "cleanup-idempotency",
  "monitor-invariants",
] as const;

export async function runScheduledJob(
  name: string,
): Promise<Record<string, unknown>> {
  if (!names.includes(name as (typeof names)[number]))
    throw new Error("JOB_NOT_FOUND:后台任务不存在");
  const database = await rpc<Record<string, unknown> & { status?: unknown }>(
    "run_job",
    {
      p_job_name: name,
      p_limit: 100,
    },
  );
  if (database.status === "failed")
    throw new Error("INTERNAL_ERROR:后台任务执行失败");
  if (database.status === "skipped" || name !== "reconcile-mints")
    return database;
  const jobRunId = String(database.job_run_id);
  const databaseCount = Number(database.processed_count ?? 0);
  try {
    const chain = await reconcileSubmittedMints();
    const completed = await rpc<Record<string, unknown>>("finish_job", {
      p_job_run_id: jobRunId,
      p_processed_count: databaseCount + chain.candidates,
      p_details: { chain },
      p_error: null,
    });
    return { ...completed, chain };
  } catch (cause) {
    await rpc("finish_job", {
      p_job_run_id: jobRunId,
      p_processed_count: databaseCount,
      p_details: { phase: "chain_reconciliation" },
      p_error:
        cause instanceof Error
          ? cause.message
          : "unknown_chain_reconciliation_error",
    });
    throw new Error("INTERNAL_ERROR:Mint 对账失败", { cause });
  }
}
