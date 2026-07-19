import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

const names = [
  "reconcile-payments",
  "reconcile-mints",
  "cleanup-idempotency",
  "monitor-invariants",
] as const;
const jobOutputSchema = z
  .object({
    job_run_id: uuidSchema,
    job_name: z.enum(names),
    status: z.enum(["succeeded", "skipped"]),
    processed_count: z.number().int().min(0),
    scan_from: timestampSchema.nullable(),
    scan_to: timestampSchema,
    chain: z
      .object({
        candidates: z.number().int().min(0),
        succeeded: z.number().int().min(0),
        failed: z.number().int().min(0),
        unknown: z.number().int().min(0),
      })
      .strict()
      .optional(),
  })
  .strict();

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
    errors: [
      "CRON_UNAUTHORIZED",
      "JOB_NOT_FOUND",
      "MINT_RESULT_INCOMPLETE",
      "INTERNAL_ERROR",
    ],
  }),
);
