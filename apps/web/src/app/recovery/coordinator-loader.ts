export type RecoveryCoordinatorModule =
  typeof import("./AppRecoveryCoordinator.tsx");

let task: Promise<RecoveryCoordinatorModule> | null = null;

export function loadRecoveryCoordinator(): Promise<RecoveryCoordinatorModule> {
  task ??= import("./AppRecoveryCoordinator.tsx").catch((cause: unknown) => {
    task = null;
    throw cause;
  });
  return task;
}
