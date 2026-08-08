import type { RouteOutput } from "@pokepets/api-contracts/app-client";

export type Task = RouteOutput<"tasks.get">["tasks"][number];
export type VisibleTaskCategory = Exclude<
  Task["category"],
  "expedition" | "wallet" | "mint"
>;
export type VisibleTask = Task & { category: VisibleTaskCategory };

export function isVisibleMvpTask(task: Task): task is VisibleTask {
  return (
    task.category !== "expedition" &&
    task.category !== "wallet" &&
    task.category !== "mint"
  );
}
