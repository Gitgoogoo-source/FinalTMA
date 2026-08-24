import type { RecoverableRouteId } from "@evomypet/api-contracts/app-client";

export type OperationRegistryRuntimeModule =
  typeof import("./OperationRegistryRuntimeProvider.tsx");

let task: Promise<OperationRegistryRuntimeModule> | null = null;

export function loadOperationRegistryRuntime(): Promise<OperationRegistryRuntimeModule> {
  task ??= import("./OperationRegistryRuntimeProvider.tsx").catch(
    (cause: unknown) => {
      task = null;
      throw cause;
    },
  );
  return task;
}

export function preloadOperationRegistryRuntime(
  routeId: RecoverableRouteId,
): void {
  void Promise.all([
    loadOperationRegistryRuntime(),
    import("./presentation-loader.ts"),
  ])
    .then(([, presentations]) =>
      presentations.preloadOperationPresentation(routeId),
    )
    .catch(() => undefined);
}
