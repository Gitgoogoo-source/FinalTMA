import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type {
  RecoverableOperationSummary,
  RecoverableRouteId,
  RouteInput,
  RouteOutput,
} from "@pokepets/api-contracts/app-client";

export type OperationPhase =
  | "confirming"
  | "submitting"
  | "pending"
  | "unknown"
  | "succeeded"
  | "failed";

export type OperationPresentation = {
  name: string;
  imagePath: string;
};

export type GachaHatchTier = "normal" | "rare" | "legendary";

export type OperationRunOptions = {
  background?: boolean;
  dialog?: boolean;
  presentation?: OperationPresentation;
  retainOnFailure?: boolean;
};

export type OperationRegistryCommands = {
  run<Id extends RecoverableRouteId>(
    label: string,
    routeId: Id,
    input: RouteInput<Id>,
    options?: OperationRunOptions,
  ): Promise<RouteOutput<Id> | null>;
  present(routeId: RecoverableRouteId): boolean;
  preload(routeId: RecoverableRouteId): void;
};

export type OperationRuntimeController = OperationRegistryCommands & {
  hydrate(operations: readonly RecoverableOperationSummary[]): number;
};

export type OperationRuntimeSignals = {
  blockedRoutes: ReadonlySet<RecoverableRouteId>;
  navigationLocked: boolean;
  recoveryQueueActive: boolean;
  wheelPresentationEpoch: number;
  hydrationEpoch: number;
};

export type OperationRegistryStore = {
  commands: OperationRegistryCommands;
  hydrate(operations: readonly RecoverableOperationSummary[]): void;
  subscribeBlocked(
    routeId: RecoverableRouteId,
    listener: () => void,
  ): () => void;
  getBlocked(routeId: RecoverableRouteId): boolean;
  subscribeNavigationLocked(listener: () => void): () => void;
  getNavigationLocked(): boolean;
  subscribeRecoveryQueueActive(listener: () => void): () => void;
  getRecoveryQueueActive(): boolean;
  subscribeWheelPresentationEpoch(listener: () => void): () => void;
  getWheelPresentationEpoch(): number;
};

export type OperationRegistryRuntimeHost = {
  attachRuntime(controller: OperationRuntimeController): () => void;
  publishRuntimeSignals(
    controller: OperationRuntimeController,
    signals: OperationRuntimeSignals,
  ): void;
};

export const OperationRegistryContext =
  createContext<OperationRegistryStore | null>(null);

function useOperationStore(): OperationRegistryStore {
  const store = useContext(OperationRegistryContext);
  if (!store) throw new Error("OperationRegistryProvider is missing");
  return store;
}

export function useOperationCommands(): OperationRegistryCommands {
  return useOperationStore().commands;
}

export function useOperationHydrator(): OperationRegistryStore["hydrate"] {
  return useOperationStore().hydrate;
}

export function useOperationBlocked(routeId: RecoverableRouteId): boolean {
  const store = useOperationStore();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeBlocked(routeId, listener),
    [routeId, store],
  );
  const getSnapshot = useCallback(
    () => store.getBlocked(routeId),
    [routeId, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useOperationNavigationLocked(): boolean {
  const store = useOperationStore();
  return useSyncExternalStore(
    store.subscribeNavigationLocked,
    store.getNavigationLocked,
    store.getNavigationLocked,
  );
}

export function useOperationRecoveryQueueActive(): boolean {
  const store = useOperationStore();
  return useSyncExternalStore(
    store.subscribeRecoveryQueueActive,
    store.getRecoveryQueueActive,
    store.getRecoveryQueueActive,
  );
}

export function useWheelPresentationEpoch(): number {
  const store = useOperationStore();
  return useSyncExternalStore(
    store.subscribeWheelPresentationEpoch,
    store.getWheelPresentationEpoch,
    store.getWheelPresentationEpoch,
  );
}
