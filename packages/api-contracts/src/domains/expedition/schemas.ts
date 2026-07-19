import { expeditionRoutes } from "./routes.ts";

export const expeditionSchemas = Object.fromEntries(
  expeditionRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
