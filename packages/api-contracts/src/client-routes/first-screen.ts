import type { RouteDefinition } from "../common/route.ts";
import { catalogRoutes } from "../domains/catalog/routes.ts";
import { gachaRoutes } from "../domains/gacha/routes.ts";
import { identityFirstScreenRoutes } from "../domains/identity/routes.ts";
import { operationRoutes } from "../domains/operations/routes.ts";
import { paymentSupportRoutes } from "../domains/payment-support/routes.ts";
import { topupRoutes } from "../domains/topup/routes.ts";
import { vipRoutes } from "../domains/vip/routes.ts";

const routes = [
  ...identityFirstScreenRoutes,
  ...catalogRoutes,
  ...gachaRoutes,
  ...vipRoutes,
  ...topupRoutes,
  ...operationRoutes,
  ...paymentSupportRoutes,
] as const;

export function firstScreenRouteById(id: string): RouteDefinition | null {
  return routes.find((route) => route.id === id) ?? null;
}
