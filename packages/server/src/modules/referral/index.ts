import type { DomainModule } from "../module.ts";

export const referralModule = {
  domain: "referral",
  routePrefixes: ["referral"],
} as const satisfies DomainModule;
