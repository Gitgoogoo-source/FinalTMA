import { isRecoverableRouteId, parseRouteOutput } from "./app-client.ts";
import { operationSummarySchema } from "./common/models.ts";
import {
  hasUnavailableGachaPresentation,
  withGachaPresentationValidationUrls,
} from "./common/operation-presentation.ts";
import type {
  RecoverableOperationSummary,
  TypedOperationSummary,
} from "./registries/app.ts";

export async function parseRecoveredOperation(
  value: unknown,
): Promise<TypedOperationSummary> {
  const summary = operationSummarySchema.parse(
    value,
  ) as RecoverableOperationSummary;
  if (!isRecoverableRouteId(summary.use_case))
    throw new Error(
      `Operation use_case is not recoverable: ${summary.use_case}`,
    );
  if (
    summary.use_case === "gacha.open" &&
    summary.status === "succeeded" &&
    summary.result !== null &&
    hasUnavailableGachaPresentation(summary.result)
  ) {
    await parseRouteOutput(
      summary.use_case,
      withGachaPresentationValidationUrls(summary.result),
    );
    return {
      ...summary,
      result: null,
      error_code: "CATALOG_UNAVAILABLE",
    } as TypedOperationSummary;
  }
  if (summary.status === "succeeded" && summary.result !== null)
    await parseRouteOutput(summary.use_case, summary.result);
  return summary as TypedOperationSummary;
}
