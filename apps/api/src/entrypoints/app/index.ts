import {
  findRoute,
  findRouteByPath,
  type AppRoute,
} from "@evomypet/api-contracts/app";

import { createGateway } from "../../http/gateway.ts";
import { appHandlers } from "./handlers.ts";

export function createAppGateway(): (request: Request) => Promise<Response> {
  return createGateway<AppRoute>({
    gateway: "app",
    findRoute,
    findRouteByPath,
    handlers: appHandlers,
  });
}
