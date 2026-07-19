import { marketRoutes } from "./routes.ts";

export const marketSchemas = Object.fromEntries(
  marketRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
