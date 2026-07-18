import type { DomainModule } from "../module.ts";

export const vipModule = {
  domain: "vip",
  routePrefixes: ["vip"],
} as const satisfies DomainModule;
