import type { HandlerMap } from "../../http/handlers.ts";

export const healthHandlers = {
  "health.get": async () => ({
    data: { status: "ok", service: "evomypet", time: new Date().toISOString() },
  }),
} satisfies HandlerMap;
