import { z } from "zod";

import { operationSummarySchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  identifierSchema,
  nonNegativeBigintStringSchema,
  operationIdSchema,
} from "../../common/schemas.ts";

export const operationRoutes = [
  defineRoute({
    id: "operations.recoverable",
    method: "GET",
    path: "/api/operations/recoverable",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z
      .object({ after_authority_cursor: nonNegativeBigintStringSchema })
      .strict(),
    output: z
      .object({
        operations: z.array(operationSummarySchema),
        authority_refresh_routes: z.array(identifierSchema),
        next_authority_cursor: nonNegativeBigintStringSchema,
      })
      .strict(),
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
    input: z.object({ operation_id: operationIdSchema }).strict(),
    output: operationSummarySchema,
    errors: [
      "OPERATION_NOT_FOUND",
      "OPERATION_RESULT_EXPIRED",
      "ENTRY_HANDOFF_PENDING",
      "ACCOUNT_RESTRICTED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
