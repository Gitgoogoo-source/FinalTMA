import { walletRoutes } from "./routes.ts";

export const walletSchemas = Object.fromEntries(
  walletRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
