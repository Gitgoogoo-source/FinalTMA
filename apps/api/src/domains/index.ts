import type { RouteId } from "@pokepets/api-contracts";

import { jobHandlers } from "../entrypoints/jobs/routes.ts";
import { integrationHandlers } from "../workflows/stars-payment/integrations.ts";
import { albumHandlers } from "./album/routes.ts";
import { catalogHandlers } from "./catalog/routes.ts";
import { economyHandlers } from "./economy/routes.ts";
import { expeditionHandlers } from "./expedition/routes.ts";
import { gachaHandlers } from "./gacha/routes.ts";
import { identityHandlers } from "./identity/routes.ts";
import { inventoryHandlers } from "./inventory/routes.ts";
import { marketHandlers } from "./market/routes.ts";
import { onchainHandlers } from "./onchain/routes.ts";
import { operationHandlers } from "./operations/routes.ts";
import { topupHandlers } from "./payments/routes.ts";
import { referralHandlers } from "./referral/routes.ts";
import { taskHandlers } from "./tasks/routes.ts";
import type { RouteHandler } from "./types.ts";
import { vipHandlers } from "./vip/routes.ts";
import { wheelHandlers } from "./wheel/routes.ts";

const handlers = {
  ...identityHandlers,
  ...catalogHandlers,
  ...economyHandlers,
  ...gachaHandlers,
  ...inventoryHandlers,
  ...expeditionHandlers,
  ...wheelHandlers,
  ...marketHandlers,
  ...topupHandlers,
  ...vipHandlers,
  ...taskHandlers,
  ...referralHandlers,
  ...albumHandlers,
  ...onchainHandlers,
  ...operationHandlers,
  ...integrationHandlers,
  ...jobHandlers,
} satisfies Record<RouteId, RouteHandler>;

export function handlerFor(routeId: RouteId): RouteHandler {
  return (handlers as Record<RouteId, RouteHandler>)[routeId]!;
}
