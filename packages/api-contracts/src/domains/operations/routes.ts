import { z } from "zod";

import { operationSummarySchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema, uuidSchema } from "../../common/schemas.ts";

export const operationRoutes = [
  defineRoute({
    id: "operations.recoverable",
    method: "GET",
    path: "/api/operations/recoverable",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z.object({ operations: z.array(operationSummarySchema) }).strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
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
