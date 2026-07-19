export const taskRouteIds = [
  "tasks.get",
  "tasks.check_in",
  "tasks.claim",
] as const;

export type TaskRouteId = (typeof taskRouteIds)[number];
