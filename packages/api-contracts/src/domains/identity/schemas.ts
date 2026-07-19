import { identityRoutes } from "./routes.ts";

export const identitySchemas = Object.fromEntries(
  identityRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
