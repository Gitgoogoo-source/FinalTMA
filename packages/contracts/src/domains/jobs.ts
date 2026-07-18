import { z } from "zod";

import { defineRoute } from "../common/route.ts";
import { emptyObjectSchema, uuidSchema } from "../common/schemas.ts";

const jobOutputSchema = z.object({ job_run_id: uuidSchema, job_name: z.string(), processed_count: z.number().int().min(0) }).strict();
const names = ["reconcile-payments", "reconcile-mints", "cleanup-idempotency", "monitor-invariants"] as const;

export const jobRoutes = names.map((name) =>
  defineRoute({
    id: `jobs.${name.replaceAll("-", "_")}`,
    method: "GET",
    path: `/api/jobs/${name}`,
    gateway: "jobs",
    auth: false,
    idempotent: false,
    input: emptyObjectSchema,
    output: jobOutputSchema,
    errors: ["CRON_UNAUTHORIZED", "JOB_NOT_FOUND", "INTERNAL_ERROR"],
  }),
);
