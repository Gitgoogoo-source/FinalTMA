import type { RouteId } from "@pokepets/api-contracts/jobs";

import type { RouteHandler } from "../../http/handlers.ts";
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
} satisfies Record<RouteId, RouteHandler>;
