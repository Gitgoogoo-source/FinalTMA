import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  RecoverableOperationSummary,
  RecoverableRouteId,
  RouteInput,
  RouteOutput,
} from "@pokepets/api-contracts/app-client";

import {
  getSession,
  registerSensitiveStateResetter,
} from "../../platform/session/store.ts";
import {
  OperationRegistryContext,
  type OperationRegistryValue,
  type OperationRunOptions,
  useOperationRegistry,
} from "./context.ts";
import {
  loadOperationRegistryRuntime,
  preloadOperationRegistryRuntime,
  type OperationRegistryRuntimeModule,
} from "./runtime-loader.ts";

type PendingRun = {
  generation: string;
  routeId: RecoverableRouteId;
  start(value: OperationRegistryValue): void;
  cancel(): void;
};

export function OperationRegistryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [runtimeModule, setRuntimeModule] =
    useState<OperationRegistryRuntimeModule | null>(null);
  const [runtimeValue, setRuntimeValue] =
    useState<OperationRegistryValue | null>(null);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const pendingRunRef = useRef<PendingRun | null>(null);
  const pendingHydration = useRef<{
    generation: string;
    operations: readonly RecoverableOperationSummary[];
  } | null>(null);

  const publishPendingRun = useCallback((command: PendingRun | null) => {
    pendingRunRef.current = command;
    setPendingRun(command);
  }, []);
  const resetPending = useCallback(() => {
    pendingRunRef.current?.cancel();
    publishPendingRun(null);
    pendingHydration.current = null;
    setRecoveryPending(false);
    setLoadFailed(false);
  }, [publishPendingRun]);
  useEffect(() => registerSensitiveStateResetter(resetPending), [resetPending]);

  const load = useCallback(() => {
    setLoadFailed(false);
    void loadOperationRegistryRuntime()
      .then(setRuntimeModule)
      .catch(() => setLoadFailed(true));
  }, []);
  const run = useCallback(
    <Id extends RecoverableRouteId>(
      label: string,
      routeId: Id,
      input: RouteInput<Id>,
      options?: OperationRunOptions,
    ): Promise<RouteOutput<Id> | null> => {
      const runtime = runtimeValue;
      if (runtime) return runtime.run(label, routeId, input, options);
      const generation = getSession()?.generation;
      if (
        !generation ||
        getSession()?.accountStatus !== "normal" ||
        pendingRunRef.current
      )
        return Promise.resolve(null);
      return new Promise<RouteOutput<Id> | null>((resolve) => {
        publishPendingRun({
          generation,
          routeId,
          start: (value) => {
            void value.run(label, routeId, input, options).then(resolve);
          },
          cancel: () => resolve(null),
        });
        load();
      });
    },
    [load, publishPendingRun, runtimeValue],
  );
  const preload = useCallback(
    (routeId: RecoverableRouteId) => {
      if (runtimeValue) runtimeValue.preload(routeId);
      else preloadOperationRegistryRuntime(routeId);
    },
    [runtimeValue],
  );
  const present = useCallback(
    (routeId: RecoverableRouteId): boolean => {
      if (runtimeValue) return runtimeValue.present(routeId);
      preload(routeId);
      return false;
    },
    [preload, runtimeValue],
  );
  const hydrate = useCallback(
    (operations: readonly RecoverableOperationSummary[]) => {
      if (operations.length === 0) return;
      if (runtimeValue) runtimeValue.hydrate(operations);
      else {
        const generation = getSession()?.generation;
        if (!generation || getSession()?.accountStatus !== "normal") return;
        const pending = pendingHydration.current;
        pendingHydration.current = {
          generation,
          operations:
            pending?.generation === generation
              ? [...pending.operations, ...operations]
              : operations,
        };
        setRecoveryPending(true);
        load();
      }
    },
    [load, runtimeValue],
  );

  const publishRuntime = useCallback(
    (runtime: OperationRegistryValue) => {
      setRuntimeValue(runtime);
      const generation = getSession()?.generation;
      const hydration = pendingHydration.current;
      pendingHydration.current = null;
      setRecoveryPending(false);
      if (hydration && hydration.generation === generation)
        runtime.hydrate(hydration.operations);
      const command = pendingRunRef.current;
      publishPendingRun(null);
      if (!command) return;
      if (command.generation === generation) command.start(runtime);
      else command.cancel();
    },
    [publishPendingRun],
  );

  const value: OperationRegistryValue = {
    run,
    isBlocked: (routeId) =>
      pendingRun?.routeId === routeId ||
      runtimeValue?.isBlocked(routeId) === true,
    present,
    preload,
    navigationLocked:
      pendingRun !== null || runtimeValue?.navigationLocked === true,
    recoveryQueueActive:
      recoveryPending || runtimeValue?.recoveryQueueActive === true,
    wheelPresentationEpoch: runtimeValue?.wheelPresentationEpoch ?? 0,
    hydrate,
  };
  const RuntimeProvider = runtimeModule?.OperationRegistryRuntimeProvider;

  return (
    <OperationRegistryContext.Provider value={value}>
      {children}
      {RuntimeProvider ? (
        <RuntimeProvider>
          <RuntimeValueBridge publish={publishRuntime} />
        </RuntimeProvider>
      ) : null}
      {loadFailed && (pendingRun || recoveryPending) ? (
        <button className="operation-resume" type="button" onClick={load}>
          画面无法打开，重试
        </button>
      ) : null}
    </OperationRegistryContext.Provider>
  );
}

function RuntimeValueBridge({
  publish,
}: {
  publish(value: OperationRegistryValue): void;
}): null {
  const value = useOperationRegistry();
  useLayoutEffect(() => publish(value), [publish, value]);
  return null;
}
