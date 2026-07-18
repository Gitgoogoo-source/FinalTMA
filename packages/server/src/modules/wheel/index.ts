import type { DomainModule } from "../module.ts";

export const wheelModule = {
  domain: "wheel",
  routePrefixes: ["wheel"],
} as const satisfies DomainModule;
