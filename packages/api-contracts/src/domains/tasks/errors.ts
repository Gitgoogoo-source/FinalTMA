import type { ErrorCode } from "../../common/errors.ts";
import { taskRoutes } from "./routes.ts";

export const tasksErrorCodes = [
  ...new Set(taskRoutes.flatMap((route) => route.errors)),
] as ErrorCode[];
