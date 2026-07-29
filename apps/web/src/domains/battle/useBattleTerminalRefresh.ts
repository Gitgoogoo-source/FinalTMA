import { useCallback, useEffect, useRef, useState } from "react";

import { cancelApiQueries, fetchApiQuery } from "../../platform/query/index.ts";
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

const terminalStatuses = [
  "finished",
  "draw",
  "cancelled",
  "expired",
  "voided",
] as const;

export function useBattleTerminalRefresh(sessionGeneration: string | null): {
  reportTerminal: BattleTerminalReporter;
  failure: BattleTerminalRefreshFailure | null;
  active: BattleTerminalObservation | null;
  isLocked(roomId: string | null): boolean;
} {
  const inFlight = useRef(new Map<string, Promise<void>>());
  const completed = useRef(new Set<string>());
  const active = useRef<GenerationObservation | null>(null);
  const mounted = useRef(false);
  const [failure, setFailure] = useState<GenerationFailure | null>(null);
  const [visibleActive, setVisibleActive] =
    useState<GenerationObservation | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
        if (mounted.current) setVisibleActive(next);
      }
      if (completed.current.has(key)) return Promise.resolve();
      const existing = inFlight.current.get(key);
      if (existing) return existing;

      const task = cancelApiQueries([
        "battle.bootstrap",
        "battle.room",
        "battle.current_invite",
        "battle.team_options",
        "identity.bootstrap",
        "inventory.list",
      ])
        .then(() => {
          if (!mounted.current || getSession()?.generation !== generation)
            throw new DOMException("Stale session generation", "AbortError");
          return Promise.all([
            fetchApiQuery("battle.bootstrap"),
            fetchApiQuery("identity.bootstrap"),
            fetchApiQuery("inventory.list"),
          ]);
        })
        .then(() => {
          if (!mounted.current || getSession()?.generation !== generation)
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

  return {
    reportTerminal,
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

export function isBattleAssetTerminal(status: unknown): boolean {
  return terminalStatuses.some((terminalStatus) => terminalStatus === status);
}
