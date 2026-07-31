import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  type BattleRoomSnapshotDto,
  type RouteId,
} from "@pokepets/api-contracts/app";

import {
  cancelApiQueryOwner,
  fetchApiQueryBatchAsOwner,
  getApiQueryData,
  releaseApiQuerySuppression,
  suppressApiQueries,
  type ApiQueryRequest,
} from "../../platform/query/index.ts";
import {
  getSession,
  registerSensitiveStateResetter,
} from "../../platform/session/store.ts";

export type BattleTerminalObservation = {
  roomId: string;
  stateVersion: number;
};

export type BattleTerminalReporter = (
  observation: BattleTerminalObservation,
) => Promise<void>;

export type BattleTerminalRefreshFailure = BattleTerminalObservation & {
  error: Error;
};

type CoordinatorState = {
  generation: string;
  discoveryOwner: symbol;
  suppressionOwner: symbol;
  routeOwners: Set<symbol>;
  active: BattleTerminalObservation | null;
  recoveryRoomId: string | null;
  roomInFlight: Map<string, Promise<BattleRoomSnapshotDto | null>>;
  terminalInFlight: Map<string, Promise<void>>;
  terminalOwners: Map<string, symbol>;
  acknowledgeInFlight: Map<string, Promise<boolean>>;
  acknowledgeOwners: Map<string, symbol>;
  completed: Set<string>;
  failure: BattleTerminalRefreshFailure | null;
  listeners: Set<() => void>;
  version: number;
  disposed: boolean;
};

const terminalStatuses = [
  "finished",
  "draw",
  "cancelled",
  "expired",
  "voided",
] as const;

const authorityCancellationRoutes = [
  "battle.bootstrap",
  "battle.room",
  "battle.current_invite",
  "battle.team_options",
] as const satisfies readonly RouteId[];

const terminalCancellationRoutes = [
  ...authorityCancellationRoutes,
  "identity.bootstrap",
  "inventory.list",
] as const satisfies readonly RouteId[];

const terminalRequests = [
  { routeId: "battle.bootstrap", input: {} },
  { routeId: "identity.bootstrap", input: {} },
  { routeId: "inventory.list", input: {} },
] as const satisfies readonly ApiQueryRequest[];

const postAcknowledgeRequests = [
  { routeId: "battle.bootstrap", input: {} },
  { routeId: "identity.bootstrap", input: {} },
] as const satisfies readonly ApiQueryRequest[];

const postAcknowledgeCancellationRoutes = [
  ...authorityCancellationRoutes,
  "identity.bootstrap",
] as const satisfies readonly RouteId[];

const coordinators = new Map<string, CoordinatorState>();

registerSensitiveStateResetter(() => {
  for (const state of coordinators.values()) {
    state.disposed = true;
    cancelApiQueryOwner(state.discoveryOwner);
    for (const owner of state.terminalOwners.values())
      cancelApiQueryOwner(owner);
    for (const owner of state.acknowledgeOwners.values())
      cancelApiQueryOwner(owner);
    releaseApiQuerySuppression(state.suppressionOwner);
  }
  coordinators.clear();
});

export function useBattleTerminalRefresh(
  sessionGeneration: string | null,
  routeActive: boolean,
): {
  reportTerminal: BattleTerminalReporter;
  reportNonTerminalRoom(roomId: string): void;
  prepareAuthorityRecovery(roomId: string): boolean;
  readAuthorityRoom(roomId: string): Promise<BattleRoomSnapshotDto | null>;
  finishAuthorityRecovery(roomId: string): void;
  prepareTerminalAcknowledgement(roomId: string): Promise<boolean>;
  confirmTerminalAcknowledged(roomId: string): Promise<boolean>;
  failure: BattleTerminalRefreshFailure | null;
  active: BattleTerminalObservation | null;
  isLocked(roomId: string | null): boolean;
} {
  const routeOwner = useRef(Symbol("battle-route-authority"));
  useSyncExternalStore(
    useCallback(
      (listener) =>
        sessionGeneration
          ? subscribeCoordinator(sessionGeneration, listener)
          : () => undefined,
      [sessionGeneration],
    ),
    useCallback(
      () => (sessionGeneration ? coordinatorVersion(sessionGeneration) : 0),
      [sessionGeneration],
    ),
    () => 0,
  );

  useLayoutEffect(() => {
    if (!sessionGeneration) return;
    setRouteActive(sessionGeneration, routeOwner.current, routeActive);
  }, [routeActive, sessionGeneration]);

  useLayoutEffect(
    () => () => {
      if (sessionGeneration)
        setRouteActive(sessionGeneration, routeOwner.current, false);
    },
    [sessionGeneration],
  );

  const reportTerminal = useCallback<BattleTerminalReporter>(
    (observation) =>
      sessionGeneration
        ? reportTerminalObservation(sessionGeneration, observation)
        : Promise.resolve(),
    [sessionGeneration],
  );
  const reportNonTerminalRoom = useCallback(
    (roomId: string) => {
      if (sessionGeneration)
        reportNonTerminalObservation(sessionGeneration, roomId);
    },
    [sessionGeneration],
  );
  const readAuthorityRoom = useCallback(
    (roomId: string) =>
      sessionGeneration
        ? readCoordinatorRoom(sessionGeneration, roomId)
        : Promise.resolve(null),
    [sessionGeneration],
  );
  const prepareAuthorityRecovery = useCallback(
    (roomId: string) =>
      sessionGeneration
        ? beginCoordinatorRecovery(sessionGeneration, roomId)
        : false,
    [sessionGeneration],
  );
  const finishAuthorityRecovery = useCallback(
    (roomId: string) => {
      if (sessionGeneration)
        finishCoordinatorRecovery(sessionGeneration, roomId);
    },
    [sessionGeneration],
  );
  const confirmTerminalAcknowledged = useCallback(
    (roomId: string) =>
      sessionGeneration
        ? confirmAcknowledgedResult(sessionGeneration, roomId)
        : Promise.resolve(false),
    [sessionGeneration],
  );
  const prepareTerminalAcknowledgement = useCallback(
    (roomId: string) =>
      sessionGeneration
        ? prepareAcknowledgement(sessionGeneration, roomId)
        : Promise.resolve(false),
    [sessionGeneration],
  );
  const isLocked = useCallback(
    (roomId: string | null) => {
      if (!sessionGeneration) return false;
      const active = coordinators.get(sessionGeneration)?.active;
      return Boolean(active && (roomId === null || active.roomId === roomId));
    },
    [sessionGeneration],
  );
  const state = sessionGeneration
    ? (coordinators.get(sessionGeneration) ?? null)
    : null;

  return {
    reportTerminal,
    reportNonTerminalRoom,
    prepareAuthorityRecovery,
    readAuthorityRoom,
    finishAuthorityRecovery,
    prepareTerminalAcknowledgement,
    confirmTerminalAcknowledged,
    failure: state?.failure ?? null,
    active: state?.active ?? null,
    isLocked,
  };
}

function reportTerminalObservation(
  generation: string,
  observation: BattleTerminalObservation,
): Promise<void> {
  if (
    !isCurrentGeneration(generation) ||
    !Number.isSafeInteger(observation.stateVersion) ||
    observation.stateVersion < 1
  )
    return Promise.resolve();
  const state = coordinatorFor(generation);
  const key = terminalRefreshKey(generation, observation);
  const current = state.active;
  if (
    state.completed.has(key) &&
    (!current ||
      current.roomId !== observation.roomId ||
      current.stateVersion !== observation.stateVersion)
  )
    return Promise.resolve();
  if (
    current?.roomId === observation.roomId &&
    current.stateVersion > observation.stateVersion
  )
    return Promise.resolve();

  if (
    !current ||
    current.roomId !== observation.roomId ||
    current.stateVersion !== observation.stateVersion
  ) {
    state.active = observation;
    state.recoveryRoomId = null;
    state.failure = null;
    cancelApiQueryOwner(state.discoveryOwner);
    for (const [terminalKey, owner] of state.terminalOwners)
      if (terminalKey !== key) cancelApiQueryOwner(owner);
    syncRouteSuppression(state);
    publishCoordinator(state);
  }
  if (state.completed.has(key)) return Promise.resolve();
  const existing = state.terminalInFlight.get(key);
  if (existing) return existing;

  const terminalOwner = Symbol(`battle-terminal:${key}`);
  state.terminalOwners.set(key, terminalOwner);
  const batch = fetchApiQueryBatchAsOwner(terminalOwner, terminalRequests, {
    cancelRouteIds: terminalCancellationRoutes,
  });
  const task = batch
    .then(() => {
      if (!isCurrentObservation(state, observation)) return;
      state.completed.add(key);
      state.failure = null;
      const battle = getApiQueryData(generation, "battle.bootstrap");
      const identity = getApiQueryData(generation, "identity.bootstrap");
      if (
        battle?.current_result?.room_id !== observation.roomId &&
        identity?.battle_result?.room_id !== observation.roomId
      ) {
        state.active = null;
        syncRouteSuppression(state);
      }
      publishCoordinator(state);
    })
    .catch(() => {
      if (!isCurrentObservation(state, observation)) return;
      state.failure = {
        ...observation,
        error: new Error("Battle 终态已确认，但资产与藏品刷新失败，请重新读取"),
      };
      publishCoordinator(state);
    })
    .finally(() => {
      if (state.terminalInFlight.get(key) === task)
        state.terminalInFlight.delete(key);
      if (state.terminalOwners.get(key) === terminalOwner)
        state.terminalOwners.delete(key);
    });
  state.terminalInFlight.set(key, task);
  return task;
}

async function prepareAcknowledgement(
  generation: string,
  roomId: string,
): Promise<boolean> {
  if (!isCurrentGeneration(generation)) return false;
  const state = coordinatorFor(generation);
  let observation = state.active;
  if (!observation) {
    const battle = getApiQueryData(generation, "battle.bootstrap");
    const identity = getApiQueryData(generation, "identity.bootstrap");
    if (
      battle?.current_result?.room_id !== roomId &&
      identity?.battle_result?.room_id !== roomId
    )
      return false;
    const room = await readCoordinatorRoom(generation, roomId);
    if (!room || !isBattleAssetTerminal(room.status)) return false;
    observation = {
      roomId: room.room_id,
      stateVersion: room.state_version,
    };
  }
  if (observation.roomId !== roomId) return false;
  const key = terminalRefreshKey(generation, observation);
  await reportTerminalObservation(generation, observation);
  return isCurrentObservation(state, observation) && state.completed.has(key);
}

async function confirmAcknowledgedResult(
  generation: string,
  roomId: string,
): Promise<boolean> {
  if (!isCurrentGeneration(generation)) return false;
  const state = coordinators.get(generation);
  const observation = state?.active;
  if (!state || !observation || observation.roomId !== roomId) return false;
  const key = terminalRefreshKey(generation, observation);
  if (!isCurrentObservation(state, observation) || !state.completed.has(key))
    return false;
  const existing = state.acknowledgeInFlight.get(key);
  if (existing) return existing;

  const acknowledgeOwner = Symbol(`battle-acknowledge:${key}`);
  state.acknowledgeOwners.set(key, acknowledgeOwner);
  const batch = fetchApiQueryBatchAsOwner(
    acknowledgeOwner,
    postAcknowledgeRequests,
    { cancelRouteIds: postAcknowledgeCancellationRoutes },
  );
  const task = batch
    .then(() => {
      if (!isCurrentObservation(state, observation)) return false;
      const battle = getApiQueryData(generation, "battle.bootstrap");
      const identity = getApiQueryData(generation, "identity.bootstrap");
      if (
        battle?.current_result?.room_id === roomId ||
        identity?.battle_result?.room_id === roomId
      )
        return false;
      state.active = null;
      state.failure = null;
      syncRouteSuppression(state);
      publishCoordinator(state);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (state.acknowledgeInFlight.get(key) === task)
        state.acknowledgeInFlight.delete(key);
      if (state.acknowledgeOwners.get(key) === acknowledgeOwner)
        state.acknowledgeOwners.delete(key);
    });
  state.acknowledgeInFlight.set(key, task);
  return task;
}

function readCoordinatorRoom(
  generation: string,
  roomId: string,
): Promise<BattleRoomSnapshotDto | null> {
  if (!beginCoordinatorRecovery(generation, roomId))
    return Promise.resolve(null);
  const state = coordinatorFor(generation);
  const key = `${generation}:${roomId}`;
  const existing = state.roomInFlight.get(key);
  if (existing) return existing;
  const task = fetchApiQueryBatchAsOwner(
    state.discoveryOwner,
    [{ routeId: "battle.room", input: { room_id: roomId } }],
    { cancelRouteIds: authorityCancellationRoutes },
  )
    .then(() => {
      if (
        state.disposed ||
        !isCurrentGeneration(generation) ||
        state.active ||
        state.recoveryRoomId !== roomId
      )
        return null;
      return (
        getApiQueryData(generation, "battle.room", { room_id: roomId }) ?? null
      );
    })
    .catch((cause: unknown) => {
      if (
        state.disposed ||
        !isCurrentGeneration(generation) ||
        state.active ||
        state.recoveryRoomId !== roomId
      )
        return null;
      finishCoordinatorRecovery(generation, roomId);
      throw cause;
    })
    .finally(() => {
      if (state.roomInFlight.get(key) === task) state.roomInFlight.delete(key);
    });
  state.roomInFlight.set(key, task);
  return task;
}

function beginCoordinatorRecovery(generation: string, roomId: string): boolean {
  if (!isCurrentGeneration(generation)) return false;
  const state = coordinatorFor(generation);
  if (state.active?.roomId === roomId) return false;
  if (state.active) {
    cancelTerminalOwners(state);
    state.active = null;
    state.failure = null;
  }
  if (state.recoveryRoomId && state.recoveryRoomId !== roomId)
    cancelApiQueryOwner(state.discoveryOwner);
  state.recoveryRoomId = roomId;
  syncRouteSuppression(state);
  publishCoordinator(state);
  return true;
}

function finishCoordinatorRecovery(generation: string, roomId: string): void {
  const state = coordinators.get(generation);
  if (!state || state.active || state.recoveryRoomId !== roomId) return;
  state.recoveryRoomId = null;
  syncRouteSuppression(state);
  publishCoordinator(state);
}

function reportNonTerminalObservation(
  generation: string,
  roomId: string,
): void {
  if (!isCurrentGeneration(generation)) return;
  const state = coordinatorFor(generation);
  if (state.active?.roomId === roomId) return;
  let changed = false;
  if (state.active) {
    cancelTerminalOwners(state);
    state.active = null;
    state.failure = null;
    changed = true;
  }
  if (state.recoveryRoomId === roomId) {
    state.recoveryRoomId = null;
    changed = true;
  }
  if (!changed) return;
  syncRouteSuppression(state);
  publishCoordinator(state);
}

function setRouteActive(
  generation: string,
  owner: symbol,
  active: boolean,
): void {
  if (active && !isCurrentGeneration(generation)) return;
  const state = active
    ? coordinatorFor(generation)
    : coordinators.get(generation);
  if (!state) return;
  const changed = active
    ? !state.routeOwners.has(owner) && Boolean(state.routeOwners.add(owner))
    : state.routeOwners.delete(owner);
  if (!changed) return;
  syncRouteSuppression(state);
  publishCoordinator(state);
}

function syncRouteSuppression(state: CoordinatorState): void {
  if (
    state.routeOwners.size > 0 &&
    (state.active !== null || state.recoveryRoomId !== null)
  ) {
    suppressApiQueries(
      state.suppressionOwner,
      state.generation,
      terminalCancellationRoutes,
    );
    return;
  }
  releaseApiQuerySuppression(state.suppressionOwner);
}

function cancelTerminalOwners(state: CoordinatorState): void {
  for (const owner of state.terminalOwners.values()) cancelApiQueryOwner(owner);
}

function coordinatorFor(generation: string): CoordinatorState {
  const existing = coordinators.get(generation);
  if (existing) return existing;
  const state: CoordinatorState = {
    generation,
    discoveryOwner: Symbol(`battle-discovery:${generation}`),
    suppressionOwner: Symbol(`battle-route:${generation}`),
    routeOwners: new Set(),
    active: null,
    recoveryRoomId: null,
    roomInFlight: new Map(),
    terminalInFlight: new Map(),
    terminalOwners: new Map(),
    acknowledgeInFlight: new Map(),
    acknowledgeOwners: new Map(),
    completed: new Set(),
    failure: null,
    listeners: new Set(),
    version: 0,
    disposed: false,
  };
  coordinators.set(generation, state);
  return state;
}

function coordinatorVersion(generation: string): number {
  return coordinators.get(generation)?.version ?? 0;
}

function subscribeCoordinator(
  generation: string,
  listener: () => void,
): () => void {
  if (!isCurrentGeneration(generation)) return () => undefined;
  const state = coordinatorFor(generation);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

function publishCoordinator(state: CoordinatorState): void {
  state.version += 1;
  for (const listener of state.listeners) listener();
}

function terminalRefreshKey(
  generation: string,
  observation: BattleTerminalObservation,
): string {
  return `${generation}:${observation.roomId}:${observation.stateVersion}`;
}

function isCurrentObservation(
  state: CoordinatorState,
  observation: BattleTerminalObservation,
): boolean {
  return (
    !state.disposed &&
    isCurrentGeneration(state.generation) &&
    state.active?.roomId === observation.roomId &&
    state.active.stateVersion === observation.stateVersion
  );
}

function isCurrentGeneration(generation: string): boolean {
  const session = getSession();
  return (
    session?.generation === generation && session.accountStatus === "normal"
  );
}

export function isBattleAssetTerminal(status: unknown): boolean {
  return terminalStatuses.some((terminalStatus) => terminalStatus === status);
}
