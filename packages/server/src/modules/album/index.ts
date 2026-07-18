import type { DomainModule } from "../module.ts";

export const albumModule = {
  domain: "album",
  routePrefixes: ["album"],
} as const satisfies DomainModule;
