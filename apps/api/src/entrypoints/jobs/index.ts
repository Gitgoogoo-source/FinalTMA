import {
  findRoute,
  findRouteByPath,
  type AppRoute,
} from "@evomypet/api-contracts/jobs";

import { createGateway } from "../../http/gateway.ts";
import { jobHandlers } from "./handlers.ts";

export function createJobsGateway(): (request: Request) => Promise<Response> {
  return createGateway<AppRoute>({
    gateway: "jobs",
    findRoute,
    findRouteByPath,
    handlers: jobHandlers,
  });
}
