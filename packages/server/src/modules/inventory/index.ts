import type { DomainModule } from "../module.ts";

export const inventoryModule = {
  domain: "inventory",
  routePrefixes: ["inventory"],
} as const satisfies DomainModule;
