import { rpc } from "../../platform/db/index.ts";
import type { HandlerMap } from "../../http/handlers.ts";

export const catalogHandlers = {
  "catalog.get": async () => ({ data: await rpc("catalog_get", {}) }),
} satisfies HandlerMap;
