import { jobRoutes } from "./routes.ts";

export const jobsSchemas = Object.fromEntries(
  jobRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
