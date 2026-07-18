import type { DomainModule } from "../module.ts";

export const expeditionModule = {
  domain: "expedition",
  routePrefixes: ["expeditions"],
} as const satisfies DomainModule;
