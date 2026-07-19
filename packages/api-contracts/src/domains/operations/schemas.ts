import { operationRoutes } from "./routes.ts";

export const operationsSchemas = Object.fromEntries(
  operationRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
