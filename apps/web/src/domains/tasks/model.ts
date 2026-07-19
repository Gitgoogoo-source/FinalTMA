import type { RouteOutput } from "@pokepets/api-contracts";

export type TaskCenter = RouteOutput<"tasks.get">;
export type Task = TaskCenter["tasks"][number];
