import type { HandlerMap } from "../../http/handlers.ts";

export const healthHandlers = {
  "health.get": async () => ({
    data: { status: "ok", service: "pokepets", time: new Date().toISOString() },
  }),
} satisfies HandlerMap;
