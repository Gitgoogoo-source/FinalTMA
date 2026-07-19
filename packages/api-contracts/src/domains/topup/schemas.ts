import { topupRoutes } from "./routes.ts";

export const topupSchemas = Object.fromEntries(
  topupRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
