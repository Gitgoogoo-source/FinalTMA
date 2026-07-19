import { inventoryRoutes } from "./routes.ts";

export const inventorySchemas = Object.fromEntries(
  inventoryRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
