import type { RouteId } from "@pokepets/api-contracts";

import type { Session } from "../platform/session.ts";

export type HandlerContext = {
  request: Request;
  input: Record<string, unknown>;
  session: Session | null;
  operationId: string | null;
};

export type HandlerResult = {
  data: unknown;
  operationId?: string | null;
  status?: number;
};

export type RouteHandler = (context: HandlerContext) => Promise<HandlerResult>;
export type HandlerMap = Partial<Record<RouteId, RouteHandler>>;

export function requireSession(context: HandlerContext): Session {
  if (!context.session)
    throw new Error("SESSION_REQUIRED:请从 Telegram 重新打开 Mini App");
  return context.session;
}

export function requireOperationId(context: HandlerContext): string {
  if (!context.operationId)
    throw new Error("IDEMPOTENCY_KEY_REQUIRED:缺少幂等键");
  return context.operationId;
}
