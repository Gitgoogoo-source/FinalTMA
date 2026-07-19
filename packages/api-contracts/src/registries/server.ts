import { assertContractRegistry } from "../common/registry.ts";
import { albumRoutes } from "../domains/album/routes.ts";
import { catalogRoutes } from "../domains/catalog/routes.ts";
import { expeditionRoutes } from "../domains/expedition/routes.ts";
import { gachaRoutes } from "../domains/gacha/routes.ts";
import { identityRoutes } from "../domains/identity/routes.ts";
import { integrationRoutes } from "../domains/integrations/routes.ts";
import { inventoryRoutes } from "../domains/inventory/routes.ts";
import { jobRoutes } from "../domains/jobs/routes.ts";
import { marketRoutes } from "../domains/market/routes.ts";
import { mintRoutes } from "../domains/mint/routes.ts";
import { operationRoutes } from "../domains/operations/routes.ts";
import { paymentSupportRoutes } from "../domains/payment-support/routes.ts";
import { referralRoutes } from "../domains/referral/routes.ts";
import { taskRoutes } from "../domains/tasks/routes.ts";
import { topupRoutes } from "../domains/topup/routes.ts";
import { vipRoutes } from "../domains/vip/routes.ts";
import { walletRoutes } from "../domains/wallet/routes.ts";
import { wheelRoutes } from "../domains/wheel/routes.ts";

export const routes = [
  ...identityRoutes,
  ...catalogRoutes,
  ...gachaRoutes,
  ...inventoryRoutes,
  ...expeditionRoutes,
  ...wheelRoutes,
  ...marketRoutes,
  ...topupRoutes,
  ...vipRoutes,
  ...taskRoutes,
  ...referralRoutes,
  ...albumRoutes,
  ...walletRoutes,
  ...mintRoutes,
  ...operationRoutes,
  ...paymentSupportRoutes,
  ...integrationRoutes,
  ...jobRoutes,
] as const;

assertContractRegistry(routes);

export type AppRoute = (typeof routes)[number];
export type RouteId = AppRoute["id"];
