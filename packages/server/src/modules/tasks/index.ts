import type { DomainModule } from "../module.ts";

export const tasksModule = {
  domain: "tasks",
  routePrefixes: ["tasks"],
} as const satisfies DomainModule;
