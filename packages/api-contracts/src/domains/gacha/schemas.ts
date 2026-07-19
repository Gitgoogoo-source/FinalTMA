import { gachaRoutes } from "./routes.ts";

export const gachaSchemas = Object.fromEntries(
  gachaRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
