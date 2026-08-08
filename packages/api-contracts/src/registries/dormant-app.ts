import { assertContractRegistry } from "../common/registry.ts";
import { mintRoutes } from "../domains/mint/routes.ts";
import { walletRoutes } from "../domains/wallet/routes.ts";

export const dormantRoutes = [...walletRoutes, ...mintRoutes] as const;

assertContractRegistry(dormantRoutes);

export type DormantAppRoute = (typeof dormantRoutes)[number];
export type DormantRouteId = DormantAppRoute["id"];
export type DormantRouteById<Id extends DormantRouteId> = Extract<
  DormantAppRoute,
  { id: Id }
>;

export function dormantRouteById<Id extends DormantRouteId>(
  id: Id,
): DormantRouteById<Id> {
  const route = dormantRoutes.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Unknown dormant route: ${id}`);
  return route as DormantRouteById<Id>;
}
