import { vipRoutes } from "./routes.ts";

export const vipSchemas = Object.fromEntries(
  vipRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
