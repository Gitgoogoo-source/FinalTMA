import { z } from "zod";

import { operationSummarySchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import { uuidSchema } from "../../common/schemas.ts";

export const operationRoutes = [
  defineRoute({
    id: "operations.get",
    method: "GET",
    path: "/api/operations/:operation_id",
    gateway: "app",
    auth: true,
    idempotent: false,
    allowPendingEntryHandoff: true,
    input: z.object({ operation_id: uuidSchema }).strict(),
    output: operationSummarySchema,
    errors: [
      "OPERATION_NOT_FOUND",
      "ENTRY_HANDOFF_PENDING",
      "ACCOUNT_RESTRICTED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
