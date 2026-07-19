import { taskRoutes } from "./routes.ts";

export const tasksSchemas = Object.fromEntries(
  taskRoutes.map((route) => [
    route.id,
    { input: route.input, output: route.output },
  ]),
);
