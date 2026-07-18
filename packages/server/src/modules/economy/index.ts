import type { DomainModule } from "../module.ts";

export const economyModule = {
  domain: "economy",
  routePrefixes: ["economy"],
} as const satisfies DomainModule;
