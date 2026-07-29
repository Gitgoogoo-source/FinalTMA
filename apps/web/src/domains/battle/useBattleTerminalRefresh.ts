import { useCallback, useEffect, useRef, useState } from "react";

import { refreshScopes } from "../../platform/query/index.ts";
import { getSession } from "../../platform/session/store.ts";

export type BattleTerminalReporter = (roomId: string) => Promise<void>;

export type BattleTerminalRefreshFailure = {
  roomId: string;
  error: Error;
};

type GenerationFailure = BattleTerminalRefreshFailure & {
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
} {
  const inFlight = useRef(new Map<string, Promise<void>>());
  const completed = useRef(new Set<string>());
  const mounted = useRef(false);
  const [failure, setFailure] = useState<GenerationFailure | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reportTerminal = useCallback<BattleTerminalReporter>(
    (terminalRoomId) => {
      const generation = sessionGeneration;
      if (!generation || getSession()?.generation !== generation)
        return Promise.resolve();
      const key = `${generation}:${terminalRoomId}`;
      if (completed.current.has(key)) return Promise.resolve();
      const existing = inFlight.current.get(key);
      if (existing) return existing;

      const task = refreshScopes(["battle", "assets", "inventory"], {
        throwOnError: true,
      })
        .then(() => {
          if (!mounted.current || getSession()?.generation !== generation)
            return;
          completed.current.add(key);
          setFailure((current) =>
            current?.generation === generation &&
            current.roomId === terminalRoomId
              ? null
              : current,
          );
        })
        .catch(() => {
          if (!mounted.current || getSession()?.generation !== generation)
            return;
          setFailure({
            generation,
            roomId: terminalRoomId,
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

  return {
    reportTerminal,
    failure:
      failure?.generation === sessionGeneration
        ? { roomId: failure.roomId, error: failure.error }
        : null,
  };
}

export function isBattleAssetTerminal(status: unknown): boolean {
  return terminalStatuses.some((terminalStatus) => terminalStatus === status);
}

export function terminalRoomIdFromBattleResult(result: unknown): string | null {
  return isRecord(result) &&
    typeof result.room_id === "string" &&
    isBattleAssetTerminal(result.status)
    ? result.room_id
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
