import { albumRoutes } from "./routes.ts";

export const albumSchemas = Object.fromEntries(
  albumRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
