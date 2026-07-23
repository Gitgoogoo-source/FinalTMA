import type { RouteId } from "@pokepets/api-contracts/app";

import { albumHandlers } from "../../domains/album/routes.ts";
import { catalogHandlers } from "../../domains/catalog/routes.ts";
import { decompositionHandlers } from "../../domains/decomposition/routes.ts";
import { evolutionHandlers } from "../../domains/evolution/routes.ts";
import { expeditionHandlers } from "../../domains/expedition/routes.ts";
import { gachaHandlers } from "../../domains/gacha/routes.ts";
import { identityHandlers } from "../../domains/identity/routes.ts";
import { inventoryHandlers } from "../../domains/inventory/routes.ts";
import { marketHandlers } from "../../domains/market/routes.ts";
import { mintHandlers } from "../../domains/mint/routes.ts";
import { monsterTamerHandlers } from "../../domains/monster-tamer/routes.ts";
import { referralHandlers } from "../../domains/referral/routes.ts";
import { taskHandlers } from "../../domains/tasks/routes.ts";
import { topupHandlers } from "../../domains/topup/routes.ts";
import { vipHandlers } from "../../domains/vip/routes.ts";
import { walletHandlers } from "../../domains/wallet/routes.ts";
import { wheelHandlers } from "../../domains/wheel/routes.ts";
import type { RouteHandler } from "../../http/handlers.ts";
import { operationRecoveryHandlers } from "../../workflows/operation-recovery/routes.ts";
import { healthHandlers } from "./health.ts";
import { paymentSupportHandlers } from "./payment-support.ts";

export const appHandlers = {
  ...healthHandlers,
  ...identityHandlers,
  ...catalogHandlers,
  ...gachaHandlers,
  ...inventoryHandlers,
  ...evolutionHandlers,
  ...decompositionHandlers,
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
  ...monsterTamerHandlers,
  ...operationRecoveryHandlers,
  ...paymentSupportHandlers,
} satisfies Record<RouteId, RouteHandler>;
