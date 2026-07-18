import { rpc } from "../../platform/db/index.ts";
import type { HandlerMap } from "../types.ts";

export const catalogHandlers = {
  "catalog.get": async () => ({ data: await rpc("catalog_get", {}) }),
} satisfies HandlerMap;
