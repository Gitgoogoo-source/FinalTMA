import type { DomainModule } from "../module.ts";

export const gachaModule = {
  domain: "gacha",
  routePrefixes: ["boxes"],
} as const satisfies DomainModule;
