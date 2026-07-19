import { catalogRoutes } from "./routes.ts";

export const catalogSchemas = Object.fromEntries(
  catalogRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
