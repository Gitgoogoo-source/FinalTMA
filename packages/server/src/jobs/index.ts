import { rpc } from "../platform/db/index.ts";
import { reconcileSubmittedMints } from "../platform/ton/mintReconciliation.ts";

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
  const database = await rpc<Record<string, unknown>>("run_job", {
    p_job_name: name,
    p_limit: 100,
  });
  if (name !== "reconcile-mints") return database;
  return { ...database, chain: await reconcileSubmittedMints() };
}
