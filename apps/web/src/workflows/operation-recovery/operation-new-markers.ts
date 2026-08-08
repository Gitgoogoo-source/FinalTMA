import type {
  RecoverableRouteId,
  RouteOutput,
} from "@pokepets/api-contracts/app-client";

export function markOperationNewTemplates(
  routeId: RecoverableRouteId,
  result: unknown,
  markNew: (templateIds: readonly string[]) => void,
): void {
  if (routeId === "gacha.open") {
    const validated = result as RouteOutput<"gacha.open">;
    markNew(validated.results.map((item) => item.template_id));
  } else if (routeId === "inventory.evolve") {
    const validated = result as RouteOutput<"inventory.evolve">;
    if (validated.success_count > 0) markNew([validated.target.template_id]);
  }
}
