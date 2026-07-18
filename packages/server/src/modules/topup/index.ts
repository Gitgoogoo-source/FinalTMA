import type { DomainModule } from "../module.ts";

export const topupModule = {
  domain: "topup",
  routePrefixes: ["topup", "payments"],
} as const satisfies DomainModule;
