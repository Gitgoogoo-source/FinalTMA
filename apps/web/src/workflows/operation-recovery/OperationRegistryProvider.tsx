import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  type OperationRegistryCommands,
  type OperationRegistryRuntimeHost,
  type OperationRunOptions,
  type OperationRuntimeController,
} from "./context.ts";
import {
  createOperationRegistryStore,
  type MutableOperationRegistryStore,
} from "./operation-registry-store.ts";
import {
  loadOperationRegistryRuntime,
  preloadOperationRegistryRuntime,
  type OperationRegistryRuntimeModule,
} from "./runtime-loader.ts";

type PendingRun = {
  generation: string;
  routeId: RecoverableRouteId;
  background: boolean;
  start(controller: OperationRuntimeController): Promise<void>;
  cancel(): void;
};

export function OperationRegistryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [runtimeModule, setRuntimeModule] =
    useState<OperationRegistryRuntimeModule | null>(null);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [store] = useState<MutableOperationRegistryStore>(
    createOperationRegistryStore,
  );
  const pendingRunRef = useRef<PendingRun | null>(null);
  const pendingHydration = useRef<{
    generation: string;
    operations: readonly RecoverableOperationSummary[];
  } | null>(null);

  const publishPendingRun = useCallback(
    (command: PendingRun | null) => {
      pendingRunRef.current = command;
      setPendingRun(command);
      store.setPendingRunRoute(command?.routeId ?? null);
    },
    [store],
  );
  const resetPending = useCallback(() => {
    pendingRunRef.current?.cancel();
    pendingRunRef.current = null;
    setPendingRun(null);
    pendingHydration.current = null;
    setRecoveryPending(false);
    setLoadFailed(false);
    store.resetSignals();
  }, [store]);
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
      const runtime = store.getRuntime();
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
          background: options?.background === true,
          start: async (controller) => {
            try {
              resolve(await controller.run(label, routeId, input, options));
            } catch {
              resolve(null);
            }
          },
          cancel: () => resolve(null),
        });
        load();
      });
    },
    [load, publishPendingRun, store],
  );
  const preload = useCallback(
    (routeId: RecoverableRouteId) => {
      const runtime = store.getRuntime();
      if (runtime) runtime.preload(routeId);
      else preloadOperationRegistryRuntime(routeId);
    },
    [store],
  );
  const present = useCallback(
    (routeId: RecoverableRouteId): boolean => {
      const runtime = store.getRuntime();
      if (runtime) return runtime.present(routeId);
      preload(routeId);
      return false;
    },
    [preload, store],
  );
  const hydrate = useCallback(
    (operations: readonly RecoverableOperationSummary[]) => {
      if (operations.length === 0) return;
      const generation = getSession()?.generation;
      if (!generation || getSession()?.accountStatus !== "normal") return;
      store.setFacadeRecoveryPending(true);
      const runtime = store.getRuntime();
      if (runtime) {
        const hydrationEpoch = runtime.hydrate(operations);
        store.expectHydrationCommit(runtime, hydrationEpoch);
        return;
      }
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
    },
    [load, store],
  );
  const commands = useMemo<OperationRegistryCommands>(
    () => ({ run, present, preload }),
    [preload, present, run],
  );
  useLayoutEffect(
    () => store.bindFacade(commands, hydrate),
    [commands, hydrate, store],
  );

  const attachRuntime = useCallback(
    (controller: OperationRuntimeController): (() => void) => {
      store.attachRuntime(controller);
      const generation = getSession()?.generation;
      const hydration = pendingHydration.current;
      pendingHydration.current = null;
      setRecoveryPending(false);
      if (hydration && hydration.generation === generation) {
        const hydrationEpoch = controller.hydrate(hydration.operations);
        store.expectHydrationCommit(controller, hydrationEpoch);
      } else if (hydration) {
        store.setFacadeRecoveryPending(false);
      }

      const command = pendingRunRef.current;
      pendingRunRef.current = null;
      setPendingRun(null);
      if (command) {
        if (command.generation === generation) {
          if (command.background) store.clearPendingRunRoute(command.routeId);
          void command
            .start(controller)
            .finally(() => store.clearPendingRunRoute(command.routeId));
        } else {
          command.cancel();
          store.clearPendingRunRoute(command.routeId);
        }
      }
      return () => store.detachRuntime(controller);
    },
    [store],
  );
  const runtimeHost = useMemo<OperationRegistryRuntimeHost>(
    () => ({
      attachRuntime,
      publishRuntimeSignals: (controller, signals) =>
        store.publishRuntimeSignals(controller, signals),
    }),
    [attachRuntime, store],
  );
  const RuntimeProvider = runtimeModule?.OperationRegistryRuntimeProvider;

  return (
    <OperationRegistryContext.Provider value={store}>
      {children}
      {RuntimeProvider ? <RuntimeProvider host={runtimeHost} /> : null}
      {loadFailed && (pendingRun || recoveryPending) ? (
        <button className="operation-resume" type="button" onClick={load}>
          画面无法打开，重试
        </button>
      ) : null}
    </OperationRegistryContext.Provider>
  );
}
