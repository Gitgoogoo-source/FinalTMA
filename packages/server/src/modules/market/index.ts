import type { DomainModule } from "../module.ts";

export const marketModule = {
  domain: "market",
  routePrefixes: ["market"],
} as const satisfies DomainModule;
