import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BattleRoomSnapshotDto,
  type RouteId,
  type RouteOutput,
} from "@pokepets/api-contracts/app";

import {
  cancelApiQueries,
  fetchApiQuery,
  releaseApiQuerySuppression,
  suppressApiQueries,
} from "../../platform/query/index.ts";
import { getSession } from "../../platform/session/store.ts";

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

type GenerationFailure = BattleTerminalRefreshFailure & {
  generation: string;
};

type GenerationObservation = BattleTerminalObservation & {
  generation: string;
};

type GenerationRoom = {
  generation: string;
  roomId: string;
};

const terminalStatuses = [
  "finished",
  "draw",
  "cancelled",
  "expired",
  "voided",
] as const;

const terminalQueryRoutes = [
  "battle.bootstrap",
  "battle.room",
  "battle.current_invite",
  "battle.team_options",
  "identity.bootstrap",
  "inventory.list",
] as const satisfies readonly RouteId[];

export function useBattleTerminalRefresh(sessionGeneration: string | null): {
  reportTerminal: BattleTerminalReporter;
  reportNonTerminalRoom(roomId: string): void;
  prepareAuthorityRecovery(roomId: string): boolean;
  readAuthorityRoom(roomId: string): Promise<BattleRoomSnapshotDto | null>;
  readAuthorityBootstrap(
    roomId: string,
  ): Promise<RouteOutput<"battle.bootstrap"> | null>;
  finishAuthorityRecovery(roomId: string): void;
  failure: BattleTerminalRefreshFailure | null;
  active: BattleTerminalObservation | null;
  isLocked(roomId: string | null): boolean;
} {
  const suppressionOwner = useRef(Symbol("battle-terminal-query-owner"));
  const inFlight = useRef(new Map<string, Promise<void>>());
  const completed = useRef(new Set<string>());
  const active = useRef<GenerationObservation | null>(null);
  const recovery = useRef<GenerationRoom | null>(null);
  const mounted = useRef(false);
  const [failure, setFailure] = useState<GenerationFailure | null>(null);
  const [visibleActive, setVisibleActive] =
    useState<GenerationObservation | null>(null);

  useEffect(() => {
    const generation = sessionGeneration;
    const owner = suppressionOwner.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      releaseApiQuerySuppression(owner);
      if (generation)
        void cancelApiQueries(terminalQueryRoutes, generation).catch(
          () => undefined,
        );
      if (active.current?.generation === generation) active.current = null;
      if (recovery.current?.generation === generation) recovery.current = null;
    };
  }, [sessionGeneration]);

  const isLocked = useCallback(
    (roomId: string | null) => {
      const observation = active.current;
      return Boolean(
        observation?.generation === sessionGeneration &&
        (roomId === null || observation.roomId === roomId),
      );
    },
    [sessionGeneration],
  );

  const prepareAuthorityRecovery = useCallback(
    (roomId: string) => {
      const generation = sessionGeneration;
      if (
        !generation ||
        getSession()?.generation !== generation ||
        active.current?.generation === generation
      )
        return false;
      recovery.current = { generation, roomId };
      suppressApiQueries(
        suppressionOwner.current,
        generation,
        terminalQueryRoutes,
      );
      return true;
    },
    [sessionGeneration],
  );

  const finishAuthorityRecovery = useCallback(
    (roomId: string) => {
      const generation = sessionGeneration;
      if (
        !generation ||
        active.current?.generation === generation ||
        !matchesRoom(recovery.current, generation, roomId)
      )
        return;
      recovery.current = null;
      releaseApiQuerySuppression(suppressionOwner.current);
    },
    [sessionGeneration],
  );

  const readAuthorityRoom = useCallback(
    async (roomId: string): Promise<BattleRoomSnapshotDto | null> => {
      const generation = sessionGeneration;
      if (!generation || !prepareAuthorityRecovery(roomId)) return null;
      await cancelApiQueries(terminalQueryRoutes, generation);
      if (
        !mounted.current ||
        getSession()?.generation !== generation ||
        active.current?.generation === generation ||
        !matchesRoom(recovery.current, generation, roomId)
      )
        return null;
      return fetchApiQuery(
        "battle.room",
        { room_id: roomId },
        suppressionOwner.current,
      );
    },
    [prepareAuthorityRecovery, sessionGeneration],
  );

  const readAuthorityBootstrap = useCallback(
    (roomId: string): Promise<RouteOutput<"battle.bootstrap"> | null> => {
      const generation = sessionGeneration;
      if (
        !generation ||
        !mounted.current ||
        getSession()?.generation !== generation ||
        active.current?.generation === generation ||
        !matchesRoom(recovery.current, generation, roomId)
      )
        return Promise.resolve(null);
      return fetchApiQuery("battle.bootstrap", {}, suppressionOwner.current);
    },
    [sessionGeneration],
  );

  const reportNonTerminalRoom = useCallback(
    (roomId: string) => {
      const generation = sessionGeneration;
      const terminal = active.current;
      if (
        !generation ||
        terminal?.generation !== generation ||
        terminal.roomId === roomId
      )
        return;
      active.current = null;
      recovery.current = null;
      releaseApiQuerySuppression(suppressionOwner.current);
      if (!mounted.current) return;
      setVisibleActive(null);
      setFailure((current) =>
        current?.generation === generation ? null : current,
      );
    },
    [sessionGeneration],
  );

  const reportTerminal = useCallback<BattleTerminalReporter>(
    (observation) => {
      const generation = sessionGeneration;
      if (
        !generation ||
        getSession()?.generation !== generation ||
        !Number.isSafeInteger(observation.stateVersion) ||
        observation.stateVersion < 1
      )
        return Promise.resolve();
      const key = terminalRefreshKey(generation, observation);
      const current = active.current;
      if (
        current?.generation === generation &&
        current.roomId === observation.roomId &&
        current.stateVersion > observation.stateVersion
      )
        return Promise.resolve();
      if (
        !current ||
        current.generation !== generation ||
        current.roomId !== observation.roomId ||
        current.stateVersion !== observation.stateVersion
      ) {
        const next = { generation, ...observation };
        active.current = next;
        recovery.current = null;
        suppressApiQueries(
          suppressionOwner.current,
          generation,
          terminalQueryRoutes,
        );
        if (mounted.current) setVisibleActive(next);
      }
      if (completed.current.has(key)) return Promise.resolve();
      const existing = inFlight.current.get(key);
      if (existing) return existing;

      const task = cancelApiQueries(terminalQueryRoutes, generation)
        .then(() => {
          if (
            !mounted.current ||
            getSession()?.generation !== generation ||
            !matchesObservation(active.current, generation, observation)
          )
            throw new DOMException("Stale terminal observation", "AbortError");
          return Promise.all([
            fetchApiQuery("battle.bootstrap", {}, suppressionOwner.current),
            fetchApiQuery("identity.bootstrap", {}, suppressionOwner.current),
            fetchApiQuery("inventory.list", {}, suppressionOwner.current),
          ]);
        })
        .then(() => {
          if (
            !mounted.current ||
            getSession()?.generation !== generation ||
            !matchesObservation(active.current, generation, observation)
          )
            return;
          completed.current.add(key);
          setFailure((current) =>
            current?.generation === generation &&
            current.roomId === observation.roomId &&
            current.stateVersion === observation.stateVersion
              ? null
              : current,
          );
        })
        .catch(() => {
          if (
            !mounted.current ||
            getSession()?.generation !== generation ||
            !matchesObservation(active.current, generation, observation)
          )
            return;
          setFailure({
            generation,
            ...observation,
            error: new Error(
              "Battle 终态已确认，但资产与藏品刷新失败，请重新读取",
            ),
          });
        })
        .finally(() => {
          inFlight.current.delete(key);
        });
      inFlight.current.set(key, task);
      return task;
    },
    [sessionGeneration],
  );

  const currentActive =
    visibleActive?.generation === sessionGeneration ? visibleActive : null;

  return {
    reportTerminal,
    reportNonTerminalRoom,
    prepareAuthorityRecovery,
    readAuthorityRoom,
    readAuthorityBootstrap,
    finishAuthorityRecovery,
    failure:
      failure?.generation === sessionGeneration &&
      currentActive?.roomId === failure.roomId &&
      currentActive.stateVersion === failure.stateVersion
        ? {
            roomId: failure.roomId,
            stateVersion: failure.stateVersion,
            error: failure.error,
          }
        : null,
    active: currentActive
      ? {
          roomId: currentActive.roomId,
          stateVersion: currentActive.stateVersion,
        }
      : null,
    isLocked,
  };
}

function terminalRefreshKey(
  generation: string,
  observation: BattleTerminalObservation,
): string {
  return `${generation}:${observation.roomId}:${observation.stateVersion}`;
}

function matchesObservation(
  current: GenerationObservation | null,
  generation: string,
  observation: BattleTerminalObservation,
): boolean {
  return (
    current?.generation === generation &&
    current.roomId === observation.roomId &&
    current.stateVersion === observation.stateVersion
  );
}

function matchesRoom(
  current: GenerationRoom | null,
  generation: string,
  roomId: string,
): boolean {
  return current?.generation === generation && current.roomId === roomId;
}

export function isBattleAssetTerminal(status: unknown): boolean {
  return terminalStatuses.some((terminalStatus) => terminalStatus === status);
}
