import type { DomainModule } from "../module.ts";

export const catalogModule = {
  domain: "catalog",
  routePrefixes: ["catalog"],
} as const satisfies DomainModule;
