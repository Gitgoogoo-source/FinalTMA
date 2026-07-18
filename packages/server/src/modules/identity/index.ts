import type { DomainModule } from "../module.ts";

export const identityModule = {
  domain: "identity",
  routePrefixes: ["auth", "me"],
} as const satisfies DomainModule;
