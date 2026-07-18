import type { DomainModule } from "../module.ts";

export const mintModule = {
  domain: "mint",
  routePrefixes: ["nft"],
} as const satisfies DomainModule;
