import { rpc } from "../../platform/db/index.ts";
import type { HandlerMap } from "../../http/handlers.ts";

export const catalogHandlers = {
  "catalog.current": async () => ({ data: await rpc("catalog_current", {}) }),
  "catalog.release": async ({ input }) => ({
    data: await rpc("catalog_release", {
      p_product_checksum: input.product_checksum,
      p_release_key: input.release_key,
    }),
  }),
} satisfies HandlerMap;
