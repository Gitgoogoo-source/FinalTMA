import { albumModule } from "./album/index.ts";
import { catalogModule } from "./catalog/index.ts";
import { economyModule } from "./economy/index.ts";
import { expeditionModule } from "./expedition/index.ts";
import { gachaModule } from "./gacha/index.ts";
import { identityModule } from "./identity/index.ts";
import { inventoryModule } from "./inventory/index.ts";
import { marketModule } from "./market/index.ts";
import { mintModule } from "./mint/index.ts";
import { referralModule } from "./referral/index.ts";
import { riskModule } from "./risk/index.ts";
import { tasksModule } from "./tasks/index.ts";
import { topupModule } from "./topup/index.ts";
import { vipModule } from "./vip/index.ts";
import { walletModule } from "./wallet/index.ts";
import { wheelModule } from "./wheel/index.ts";

const modules = [
  identityModule,
  catalogModule,
  economyModule,
  gachaModule,
  inventoryModule,
  expeditionModule,
  wheelModule,
  marketModule,
  topupModule,
  vipModule,
  tasksModule,
  referralModule,
  albumModule,
  walletModule,
  mintModule,
  riskModule,
] as const;
export type Domain = (typeof modules)[number]["domain"];

export function routeDomain(routeId: string): Domain {
  const prefix = routeId.split(".")[0] ?? "";
  const module = modules.find((candidate) =>
    (candidate.routePrefixes as readonly string[]).includes(prefix),
  );
  if (!module) throw new Error("API_ROUTE_NOT_OWNED:接口缺少模块归属");
  return module.domain;
}
