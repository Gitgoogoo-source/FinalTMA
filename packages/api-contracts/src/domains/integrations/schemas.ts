import { integrationRoutes } from "./routes.ts";

export const integrationsSchemas = Object.fromEntries(
  integrationRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
