import type { DomainModule } from "../module.ts";

export const riskModule = {
  domain: "risk",
  routePrefixes: ["operations", "jobs", "telegram"],
} as const satisfies DomainModule;
