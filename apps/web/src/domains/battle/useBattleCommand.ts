import { useCallback, useEffect, useRef, useState } from "react";
import {
  errorDefinition,
  isErrorCode,
  parseRouteOutput,
  type BattleRoomSnapshotDto,
  type RefreshScope,
  type RouteInput,
  type RouteOutput,
} from "@pokepets/api-contracts/app";

import {
  ApiFailure,
  apiRequest,
  newIdempotencyKey,
} from "../../platform/api/client.ts";
import {
  refreshRouteScopes,
  refreshScopes,
} from "../../platform/query/index.ts";
import { getSession } from "../../platform/session/store.ts";
import { isBattleAssetTerminal } from "./useBattleTerminalRefresh.ts";

type BattleCommandRouteId =
  | "battle.create"
  | "battle.matchmake"
  | "battle.cancel"
  | "battle.accept"
  | "battle.action";

type BattleCommandPhase =
  | "idle"
  | "submitted"
  | "recovering"
  | "succeeded"
  | "failed";

export type BattleCommandState = {
  routeId: BattleCommandRouteId | null;
  operationId: string | null;
  phase: BattleCommandPhase;
};

export type BattleAuthoritativeRoomHandler = (
  snapshot: BattleRoomSnapshotDto,
) => Promise<void>;

export type BattleAuthoritativeRoomReader = (
  roomId: string,
) => Promise<BattleRoomSnapshotDto | null>;

const initialState: BattleCommandState = {
  routeId: null,
  operationId: null,
  phase: "idle",
};

export function useBattleCommand(
  refetchAuthority: () => Promise<void>,
  onAuthoritativeRoom: BattleAuthoritativeRoomHandler,
  readAuthoritativeRoom: BattleAuthoritativeRoomReader,
): {
  state: BattleCommandState;
  execute<Id extends BattleCommandRouteId>(
    routeId: Id,
    input: RouteInput<Id>,
    options?: { terminalRoomId?: string },
  ): Promise<RouteOutput<Id> | null>;
} {
  const [state, setState] = useState<BattleCommandState>(initialState);
  const active = useRef<AbortController | null>(null);
  const refetchRef = useRef(refetchAuthority);
  const onAuthoritativeRoomRef = useRef(onAuthoritativeRoom);
  const readAuthoritativeRoomRef = useRef(readAuthoritativeRoom);

  useEffect(() => {
    refetchRef.current = refetchAuthority;
    onAuthoritativeRoomRef.current = onAuthoritativeRoom;
    readAuthoritativeRoomRef.current = readAuthoritativeRoom;
  }, [onAuthoritativeRoom, readAuthoritativeRoom, refetchAuthority]);

  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  const execute = useCallback(
    async <Id extends BattleCommandRouteId>(
      routeId: Id,
      input: RouteInput<Id>,
      options?: { terminalRoomId?: string },
    ): Promise<RouteOutput<Id> | null> => {
      if (active.current) return null;
      const generation = getSession()?.generation;
      if (!generation || getSession()?.accountStatus !== "normal") return null;
      const operationId = newIdempotencyKey();
      const controller = new AbortController();
      active.current = controller;
      setState({
        routeId,
        operationId,
        phase: "submitted",
      });
      try {
        await nextAnimationFrame();
        if (controller.signal.aborted || !isCurrentGeneration(generation))
          return null;
        const response = await apiRequest(routeId, input, {
          idempotencyKey: operationId,
          signal: controller.signal,
        });
        if (!isCurrentGeneration(generation)) return null;
        await applyBattleCommandResult(
          routeId,
          response.data,
          generation,
          controller.signal,
          onAuthoritativeRoomRef.current,
          readAuthoritativeRoomRef.current,
        );
        if (!isCurrentGeneration(generation)) return null;
        setState({
          routeId,
          operationId,
          phase: "succeeded",
        });
        return response.data;
      } catch (cause) {
        if (controller.signal.aborted || isAbortFailure(cause)) return null;
        const failure = toFailure(cause, operationId);
        if (!isUnknownResult(failure)) {
          await refreshBattleCommandFailure(
            routeId,
            failure.code,
            options?.terminalRoomId ?? roomIdFromInput(input),
            generation,
            controller.signal,
            onAuthoritativeRoomRef.current,
            readAuthoritativeRoomRef.current,
            refetchRef.current,
          );
          if (!isCurrentGeneration(generation)) return null;
          setState({
            routeId,
            operationId,
            phase: "failed",
          });
          return null;
        }
        setState({
          routeId,
          operationId,
          phase: "recovering",
        });
        await refetchRef.current().catch(() => undefined);
        let recovered: Awaited<ReturnType<typeof recoverSameOperation<Id>>>;
        try {
          recovered = await recoverSameOperation(
            routeId,
            input,
            operationId,
            generation,
            controller.signal,
          );
        } catch (recoveryCause) {
          if (
            controller.signal.aborted ||
            isAbortFailure(recoveryCause) ||
            !isCurrentGeneration(generation)
          )
            return null;
          setState({
            routeId,
            operationId,
            phase: "failed",
          });
          return null;
        }
        if (recovered.kind === "succeeded") {
          try {
            await applyBattleCommandResult(
              routeId,
              recovered.data,
              generation,
              controller.signal,
              onAuthoritativeRoomRef.current,
              readAuthoritativeRoomRef.current,
            );
          } catch (recoveryCause) {
            if (
              controller.signal.aborted ||
              isAbortFailure(recoveryCause) ||
              !isCurrentGeneration(generation)
            )
              return null;
            setState({
              routeId,
              operationId,
              phase: "failed",
            });
            return null;
          }
          if (!isCurrentGeneration(generation)) return null;
          setState({
            routeId,
            operationId,
            phase: "succeeded",
          });
          return recovered.data;
        }
        await refreshBattleCommandFailure(
          routeId,
          recovered.failure.code,
          options?.terminalRoomId ?? roomIdFromInput(input),
          generation,
          controller.signal,
          onAuthoritativeRoomRef.current,
          readAuthoritativeRoomRef.current,
          refetchRef.current,
        );
        if (!isCurrentGeneration(generation)) return null;
        setState({
          routeId,
          operationId,
          phase: "failed",
        });
        return null;
      } finally {
        if (active.current === controller) active.current = null;
      }
    },
    [],
  );

  return {
    state,
    execute,
  };
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function recoverSameOperation<Id extends BattleCommandRouteId>(
  routeId: Id,
  input: RouteInput<Id>,
  operationId: string,
  generation: string,
  signal: AbortSignal,
): Promise<
  | { kind: "succeeded"; data: RouteOutput<Id> }
  | { kind: "failed"; failure: ApiFailure }
> {
  let resubmitted = false;
  let attempt = 0;
  while (!signal.aborted) {
    try {
      const response = await apiRequest(
        "operations.get",
        { operation_id: operationId },
        { signal },
      );
      assertGeneration(generation);
      if (response.data.status === "succeeded") {
        try {
          return {
            kind: "succeeded",
            data: parseRecoveredResult(routeId, response.data.result),
          };
        } catch {
          return {
            kind: "failed",
            failure: new ApiFailure(
              502,
              "OPERATION_RESULT_INVALID",
              "原操作结果格式无效，请刷新权威状态",
              true,
              operationId,
            ),
          };
        }
      }
      if (response.data.status === "failed")
        return {
          kind: "failed",
          failure: operationFailure(response.data.error_code, operationId),
        };
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      if (isAbortFailure(cause)) throw cause;
      const failure = toFailure(cause, operationId);
      if (failure.code === "OPERATION_NOT_FOUND" && !resubmitted) {
        resubmitted = true;
        try {
          const response = await apiRequest(routeId, input, {
            idempotencyKey: operationId,
            signal,
          });
          assertGeneration(generation);
          return { kind: "succeeded", data: response.data };
        } catch (resubmitCause) {
          if (signal.aborted) throw signal.reason;
          const resubmitFailure = toFailure(resubmitCause, operationId);
          if (!isUnknownResult(resubmitFailure))
            return { kind: "failed", failure: resubmitFailure };
        }
      } else if (
        ![
          "NETWORK_ERROR",
          "OPERATION_NOT_FOUND",
          "RESPONSE_INVALID",
          "INTERNAL_ERROR",
          "DATABASE_RPC_FAILED",
        ].includes(failure.code)
      ) {
        return { kind: "failed", failure };
      }
    }
    attempt += 1;
    await wait(Math.min(5_000, 800 + attempt * 700), signal);
  }
  throw signal.reason;
}

function parseRecoveredResult<Id extends BattleCommandRouteId>(
  routeId: Id,
  result: unknown,
): RouteOutput<Id> {
  return parseRouteOutput(routeId, result);
}

function isUnknownResult(failure: ApiFailure): boolean {
  return (
    failure.operationId !== null &&
    ((isErrorCode(failure.code) &&
      errorDefinition(failure.code).recoveryAction === "query_operation") ||
      [
        "NETWORK_ERROR",
        "OPERATION_RESULT_INVALID",
        "RESPONSE_INVALID",
        "INTERNAL_ERROR",
        "DATABASE_RPC_FAILED",
      ].includes(failure.code))
  );
}

function toFailure(cause: unknown, operationId: string): ApiFailure {
  return cause instanceof ApiFailure
    ? cause
    : new ApiFailure(
        0,
        "INTERNAL_ERROR",
        "操作结果暂时无法确认",
        true,
        operationId,
      );
}

function operationFailure(
  code: string | null,
  operationId: string,
): ApiFailure {
  if (code && isErrorCode(code)) {
    const definition = errorDefinition(code);
    return new ApiFailure(
      definition.status,
      code,
      definition.message,
      definition.retryable,
      operationId,
    );
  }
  return new ApiFailure(
    500,
    "OPERATION_RESULT_INVALID",
    "原操作失败详情暂时无法确认",
    true,
    operationId,
  );
}

async function applyFailureScopes(code: string): Promise<void> {
  if (!isErrorCode(code)) return;
  const declared = errorDefinition(code).refreshScope;
  const scopes: readonly RefreshScope[] =
    typeof declared === "string" ? [declared] : declared;
  await refreshScopes(scopes).catch(() => undefined);
}

async function applyBattleCommandResult<Id extends BattleCommandRouteId>(
  routeId: Id,
  result: RouteOutput<Id>,
  generation: string,
  signal: AbortSignal,
  onAuthoritativeRoom: BattleAuthoritativeRoomHandler,
  readAuthoritativeRoom: BattleAuthoritativeRoomReader,
): Promise<void> {
  const snapshot = await authoritativeRoomFromResult(
    routeId,
    result,
    generation,
    signal,
    readAuthoritativeRoom,
  );
  if (!snapshot || signal.aborted || !isCurrentGeneration(generation)) return;
  await onAuthoritativeRoom(snapshot);
  if (routeId !== "battle.action" && !isBattleAssetTerminal(snapshot.status))
    await refreshRouteScopes(routeId);
}

async function refreshBattleCommandFailure(
  routeId: BattleCommandRouteId,
  code: string,
  terminalRoomId: string | null,
  generation: string,
  signal: AbortSignal,
  onAuthoritativeRoom: BattleAuthoritativeRoomHandler,
  readAuthoritativeRoom: BattleAuthoritativeRoomReader,
  refetchAuthority: () => Promise<void>,
): Promise<void> {
  if (isBattleTerminalFailure(code)) {
    if (routeId !== "battle.accept" && terminalRoomId) {
      try {
        const snapshot = await readAuthoritativeRoom(terminalRoomId);
        if (!snapshot || signal.aborted || !isCurrentGeneration(generation))
          return;
        await onAuthoritativeRoom(snapshot);
        return;
      } catch (cause) {
        if (signal.aborted || isAbortFailure(cause)) return;
      }
    }
    await refetchAuthority();
    return;
  }
  await applyFailureScopes(code);
}

async function authoritativeRoomFromResult<Id extends BattleCommandRouteId>(
  routeId: Id,
  result: RouteOutput<Id>,
  generation: string,
  signal: AbortSignal,
  readAuthoritativeRoom: BattleAuthoritativeRoomReader,
): Promise<BattleRoomSnapshotDto | null> {
  if (
    routeId === "battle.matchmake" ||
    routeId === "battle.accept" ||
    routeId === "battle.action"
  )
    return result as BattleRoomSnapshotDto;
  const commandResult = result as RouteOutput<BattleCommandRouteId>;
  const snapshot = await readAuthoritativeRoom(commandResult.room_id);
  if (signal.aborted) return null;
  assertGeneration(generation);
  return snapshot;
}

function isBattleTerminalFailure(code: string): boolean {
  return [
    "BATTLE_SHARE_FAILED",
    "BATTLE_ROOM_EXPIRED",
    "BATTLE_ROOM_CANCELLED",
    "BATTLE_VOIDED",
  ].includes(code);
}

function roomIdFromInput(input: unknown): string | null {
  return isRecord(input) && typeof input.room_id === "string"
    ? input.room_id
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertGeneration(expected: string): void {
  const session = getSession();
  if (session?.generation !== expected || session.accountStatus !== "normal")
    throw new DOMException("Stale session generation", "AbortError");
}

function isCurrentGeneration(expected: string): boolean {
  const session = getSession();
  return session?.generation === expected && session.accountStatus === "normal";
}

function isAbortFailure(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function wait(duration: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const aborted = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, duration);
    signal.addEventListener("abort", aborted, { once: true });
  });
}
