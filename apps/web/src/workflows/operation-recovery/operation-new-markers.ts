import {
  routeById,
  type RecoverableRouteId,
} from "@pokepets/api-contracts/app";

export function markOperationNewTemplates(
  routeId: RecoverableRouteId,
  result: unknown,
  markNew: (templateIds: readonly string[]) => void,
): void {
  if (routeId === "gacha.open") {
    const parsed = routeById(routeId).output.safeParse(result);
    if (parsed.success)
      markNew(parsed.data.results.map((item) => item.template_id));
  } else if (routeId === "inventory.evolve") {
    const parsed = routeById(routeId).output.safeParse(result);
    if (parsed.success && parsed.data.success_count > 0)
      markNew([parsed.data.target.template_id]);
  }
}
