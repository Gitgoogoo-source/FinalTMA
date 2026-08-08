export type OperationRegistryProviderModule =
  typeof import("../../app/providers/AuthenticatedRuntimeProviders.tsx");

let task: Promise<OperationRegistryProviderModule> | null = null;

export function preloadOperationRegistryProvider(): Promise<OperationRegistryProviderModule> {
  task ??=
    import("../../app/providers/AuthenticatedRuntimeProviders.tsx").catch(
      (cause: unknown) => {
        task = null;
        throw cause;
      },
    );
  return task;
}
