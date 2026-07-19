import {
  findRoute,
  findRouteByPath,
  type AppRoute,
} from "@pokepets/api-contracts/integrations";

import { createGateway } from "../../http/gateway.ts";
import { integrationHandlers } from "./handlers.ts";

export function createIntegrationsGateway(): (
  request: Request,
) => Promise<Response> {
  return createGateway<AppRoute>({
    gateway: "integrations",
    findRoute,
    findRouteByPath,
    handlers: integrationHandlers,
  });
}
