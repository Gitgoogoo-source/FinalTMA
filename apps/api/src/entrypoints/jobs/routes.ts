import type { HandlerMap } from "../../domains/types.ts";
import { runScheduledJob } from "../../workflows/scheduled-jobs/index.ts";

export const jobHandlers = {
  "jobs.reconcile_payments": async () => ({
    data: await runScheduledJob("reconcile-payments"),
  }),
  "jobs.reconcile_mints": async () => ({
    data: await runScheduledJob("reconcile-mints"),
  }),
  "jobs.cleanup_idempotency": async () => ({
    data: await runScheduledJob("cleanup-idempotency"),
  }),
  "jobs.monitor_invariants": async () => ({
    data: await runScheduledJob("monitor-invariants"),
  }),
} satisfies HandlerMap;
