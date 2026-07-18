import type { RouteId } from "@pokepets/contracts";

import { albumHandlers } from "./album/index.ts";
import { catalogHandlers } from "./catalog/index.ts";
import { expeditionHandlers } from "./expedition/index.ts";
import { gachaHandlers } from "./gacha/index.ts";
import { identityHandlers } from "./identity/index.ts";
import { integrationHandlers } from "./integrations/index.ts";
import { inventoryHandlers } from "./inventory/index.ts";
import { jobHandlers } from "./jobs/index.ts";
import { marketHandlers } from "./market/index.ts";
import { mintHandlers } from "./mint/index.ts";
import { operationHandlers } from "./operations/index.ts";
import { referralHandlers } from "./referral/index.ts";
import { taskHandlers } from "./tasks/index.ts";
import { topupHandlers } from "./topup/index.ts";
import type { RouteHandler } from "./types.ts";
import { vipHandlers } from "./vip/index.ts";
import { walletHandlers } from "./wallet/index.ts";
import { wheelHandlers } from "./wheel/index.ts";

const handlers: Partial<Record<RouteId, RouteHandler>> = {
  ...identityHandlers,
  ...catalogHandlers,
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
  ...walletHandlers,
  ...mintHandlers,
  ...operationHandlers,
  ...integrationHandlers,
  ...jobHandlers,
};

export function handlerFor(routeId: RouteId): RouteHandler {
  const handler = handlers[routeId];
  if (!handler) throw new Error("API_ROUTE_NOT_OWNED:接口缺少领域处理器");
  return handler;
}
