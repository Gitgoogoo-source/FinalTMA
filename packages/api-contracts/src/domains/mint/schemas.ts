import { mintRoutes } from "./routes.ts";

export const mintSchemas = Object.fromEntries(
  mintRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
