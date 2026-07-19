import { createGateway } from "../http/gateway.ts";

export function createAppGateway(): (request: Request) => Promise<Response> {
  return createGateway("app");
}
