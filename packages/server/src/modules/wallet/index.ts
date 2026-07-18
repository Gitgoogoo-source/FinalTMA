import type { DomainModule } from "../module.ts";

export const walletModule = {
  domain: "wallet",
  routePrefixes: ["wallet"],
} as const satisfies DomainModule;
