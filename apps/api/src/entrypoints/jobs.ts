import { createGateway } from "../http/gateway.ts";

export function createJobsGateway(): (request: Request) => Promise<Response> {
  return createGateway("jobs");
}
