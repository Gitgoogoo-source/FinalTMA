import { runScheduledJob } from "../../jobs/index.ts";
import type { HandlerMap } from "../types.ts";

export const jobHandlers = {
  "jobs.reconcile_payments": async () => ({ data: await runScheduledJob("reconcile-payments") }),
  "jobs.reconcile_mints": async () => ({ data: await runScheduledJob("reconcile-mints") }),
  "jobs.cleanup_idempotency": async () => ({ data: await runScheduledJob("cleanup-idempotency") }),
  "jobs.monitor_invariants": async () => ({ data: await runScheduledJob("monitor-invariants") }),
} satisfies HandlerMap;
