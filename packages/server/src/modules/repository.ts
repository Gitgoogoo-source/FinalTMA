import { rpc } from "../platform/db/index.ts";

import { routeDomain } from "./registry.ts";

export async function queryModule<T>(
  routeId: string,
  userId: string | null,
  input: unknown,
): Promise<T> {
  routeDomain(routeId);
  return rpc<T>("query", {
    p_action: routeId,
    p_user_id: userId,
    p_input: input,
  });
}

export async function executeModule<T>(
  routeId: string,
  userId: string,
  idempotencyKey: string,
  input: unknown,
): Promise<T> {
  routeDomain(routeId);
  return rpc<T>("execute", {
    p_action: routeId,
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
    p_input: input,
  });
}
