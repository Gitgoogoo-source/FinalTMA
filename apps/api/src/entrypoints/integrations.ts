import { createGateway } from "../http/gateway.ts";

export function createIntegrationsGateway(): (
  request: Request,
) => Promise<Response> {
  return createGateway("integrations");
}
