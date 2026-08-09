import type { RecoverableRouteId } from "@pokepets/api-contracts/app-client";

import type {
  OperationRegistryCommands,
  OperationRegistryStore,
  OperationRuntimeController,
  OperationRuntimeSignals,
} from "./context.ts";

type Listener = () => void;

const emptyRuntimeSignals = (): OperationRuntimeSignals => ({
  blockedRoutes: new Set(),
  navigationLocked: false,
  recoveryQueueActive: false,
  wheelPresentationEpoch: 0,
  hydrationEpoch: 0,
});

export type MutableOperationRegistryStore = OperationRegistryStore & {
  bindFacade(
    commands: OperationRegistryCommands,
    hydrate: OperationRegistryStore["hydrate"],
  ): () => void;
  attachRuntime(controller: OperationRuntimeController): void;
  detachRuntime(controller: OperationRuntimeController): void;
  getRuntime(): OperationRuntimeController | null;
  publishRuntimeSignals(
    controller: OperationRuntimeController,
    signals: OperationRuntimeSignals,
  ): void;
  setPendingRunRoute(routeId: RecoverableRouteId | null): void;
  clearPendingRunRoute(routeId: RecoverableRouteId): void;
  setFacadeRecoveryPending(pending: boolean): void;
  expectHydrationCommit(
    controller: OperationRuntimeController,
    hydrationEpoch: number,
  ): void;
  resetSignals(): void;
};

export function createOperationRegistryStore(): MutableOperationRegistryStore {
  let facadeCommands: OperationRegistryCommands | null = null;
  let facadeHydrate: OperationRegistryStore["hydrate"] | null = null;
  let runtimeController: OperationRuntimeController | null = null;
  let runtimeSignals = emptyRuntimeSignals();
  let pendingRunRoute: RecoverableRouteId | null = null;
  let facadeRecoveryPending = false;
  let expectedHydrationEpoch: number | null = null;

  const blockedListeners = new Map<RecoverableRouteId, Set<Listener>>();
  const navigationListeners = new Set<Listener>();
  const recoveryListeners = new Set<Listener>();
  const wheelEpochListeners = new Set<Listener>();

  const commands: OperationRegistryCommands = {
    run: (label, routeId, input, options) =>
      facadeCommands?.run(label, routeId, input, options) ??
      Promise.resolve(null),
    present: (routeId) => facadeCommands?.present(routeId) ?? false,
    preload: (routeId) => facadeCommands?.preload(routeId),
  };
  const hydrate: OperationRegistryStore["hydrate"] = (operations) =>
    facadeHydrate?.(operations);

  const getBlocked = (routeId: RecoverableRouteId): boolean =>
    pendingRunRoute === routeId || runtimeSignals.blockedRoutes.has(routeId);
  const getNavigationLocked = (): boolean =>
    pendingRunRoute !== null || runtimeSignals.navigationLocked;
  const getRecoveryQueueActive = (): boolean =>
    facadeRecoveryPending || runtimeSignals.recoveryQueueActive;
  const getWheelPresentationEpoch = (): number =>
    runtimeSignals.wheelPresentationEpoch;

  const notify = (listeners: ReadonlySet<Listener>): void => {
    for (const listener of listeners) listener();
  };
  const notifyBlocked = (routeId: RecoverableRouteId): void => {
    const listeners = blockedListeners.get(routeId);
    if (listeners) notify(listeners);
  };

  const setPendingRunRoute = (routeId: RecoverableRouteId | null): void => {
    if (pendingRunRoute === routeId) return;
    const previousRoute = pendingRunRoute;
    const previousNavigationLocked = getNavigationLocked();
    const previousRouteBlocked = previousRoute
      ? getBlocked(previousRoute)
      : false;
    const nextRouteBlockedBefore = routeId ? getBlocked(routeId) : false;
    pendingRunRoute = routeId;
    if (previousRoute && previousRouteBlocked !== getBlocked(previousRoute))
      notifyBlocked(previousRoute);
    if (routeId && nextRouteBlockedBefore !== getBlocked(routeId))
      notifyBlocked(routeId);
    if (previousNavigationLocked !== getNavigationLocked())
      notify(navigationListeners);
  };

  const setFacadeRecoveryPending = (pending: boolean): void => {
    if (facadeRecoveryPending === pending) return;
    const previous = getRecoveryQueueActive();
    facadeRecoveryPending = pending;
    if (!pending) expectedHydrationEpoch = null;
    if (previous !== getRecoveryQueueActive()) notify(recoveryListeners);
  };

  const publishRuntimeSignals = (
    controller: OperationRuntimeController,
    signals: OperationRuntimeSignals,
  ): void => {
    if (runtimeController !== controller) return;
    const previousSignals = runtimeSignals;
    const previousPendingRunRoute = pendingRunRoute;
    const previousNavigationLocked = getNavigationLocked();
    const previousRecoveryQueueActive = getRecoveryQueueActive();
    const previousWheelEpoch = getWheelPresentationEpoch();
    const routes = new Set<RecoverableRouteId>([
      ...previousSignals.blockedRoutes,
      ...signals.blockedRoutes,
    ]);
    if (previousPendingRunRoute) routes.add(previousPendingRunRoute);
    const previousBlocked = new Map(
      [...routes].map((routeId) => [routeId, getBlocked(routeId)] as const),
    );

    runtimeSignals = signals;
    if (pendingRunRoute && runtimeSignals.blockedRoutes.has(pendingRunRoute))
      pendingRunRoute = null;
    if (
      expectedHydrationEpoch !== null &&
      signals.hydrationEpoch >= expectedHydrationEpoch
    ) {
      expectedHydrationEpoch = null;
      facadeRecoveryPending = false;
    }

    for (const routeId of routes) {
      if (previousBlocked.get(routeId) !== getBlocked(routeId))
        notifyBlocked(routeId);
    }
    if (previousNavigationLocked !== getNavigationLocked())
      notify(navigationListeners);
    if (previousRecoveryQueueActive !== getRecoveryQueueActive())
      notify(recoveryListeners);
    if (previousWheelEpoch !== getWheelPresentationEpoch())
      notify(wheelEpochListeners);
  };

  const resetSignals = (): void => {
    const previousRoutes = new Set(runtimeSignals.blockedRoutes);
    if (pendingRunRoute) previousRoutes.add(pendingRunRoute);
    const previousNavigationLocked = getNavigationLocked();
    const previousRecoveryQueueActive = getRecoveryQueueActive();
    const previousWheelEpoch = getWheelPresentationEpoch();
    runtimeSignals = emptyRuntimeSignals();
    pendingRunRoute = null;
    facadeRecoveryPending = false;
    expectedHydrationEpoch = null;
    for (const routeId of previousRoutes) notifyBlocked(routeId);
    if (previousNavigationLocked !== getNavigationLocked())
      notify(navigationListeners);
    if (previousRecoveryQueueActive !== getRecoveryQueueActive())
      notify(recoveryListeners);
    if (previousWheelEpoch !== getWheelPresentationEpoch())
      notify(wheelEpochListeners);
  };

  return {
    commands,
    hydrate,
    bindFacade: (nextCommands, nextHydrate) => {
      facadeCommands = nextCommands;
      facadeHydrate = nextHydrate;
      return () => {
        if (facadeCommands === nextCommands) facadeCommands = null;
        if (facadeHydrate === nextHydrate) facadeHydrate = null;
      };
    },
    subscribeBlocked: (routeId, listener) => {
      const listeners = blockedListeners.get(routeId) ?? new Set<Listener>();
      listeners.add(listener);
      blockedListeners.set(routeId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) blockedListeners.delete(routeId);
      };
    },
    getBlocked,
    subscribeNavigationLocked: (listener) => {
      navigationListeners.add(listener);
      return () => navigationListeners.delete(listener);
    },
    getNavigationLocked,
    subscribeRecoveryQueueActive: (listener) => {
      recoveryListeners.add(listener);
      return () => recoveryListeners.delete(listener);
    },
    getRecoveryQueueActive,
    subscribeWheelPresentationEpoch: (listener) => {
      wheelEpochListeners.add(listener);
      return () => wheelEpochListeners.delete(listener);
    },
    getWheelPresentationEpoch,
    attachRuntime: (controller) => {
      runtimeController = controller;
    },
    detachRuntime: (controller) => {
      if (runtimeController !== controller) return;
      publishRuntimeSignals(controller, emptyRuntimeSignals());
      runtimeController = null;
    },
    getRuntime: () => runtimeController,
    publishRuntimeSignals,
    setPendingRunRoute,
    clearPendingRunRoute: (routeId) => {
      if (pendingRunRoute === routeId) setPendingRunRoute(null);
    },
    setFacadeRecoveryPending,
    expectHydrationCommit: (controller, hydrationEpoch) => {
      if (runtimeController !== controller) return;
      expectedHydrationEpoch = hydrationEpoch;
      if (runtimeSignals.hydrationEpoch >= hydrationEpoch)
        setFacadeRecoveryPending(false);
    },
    resetSignals,
  };
}
