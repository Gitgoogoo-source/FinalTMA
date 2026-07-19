import { referralRoutes } from "./routes.ts";

export const referralSchemas = Object.fromEntries(
  referralRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
