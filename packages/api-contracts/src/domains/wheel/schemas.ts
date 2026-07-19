import { wheelRoutes } from "./routes.ts";

export const wheelSchemas = Object.fromEntries(
  wheelRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
