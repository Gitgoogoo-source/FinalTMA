import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  errorDefinition,
  isErrorCode,
  isRecoverableRouteId,
  parseRecoveredOperation,
  routeById,
  type RecoverableOperationSummary,
  type RecoverableRouteId,
  type RouteInput,
  type RouteOutput,
} from "@pokepets/api-contracts/app";
import { useNavigate } from "react-router-dom";

import {
  ApiFailure,
  apiRequest,
  newIdempotencyKey,
} from "../../platform/api/client.ts";
import { refreshRouteScopes } from "../../platform/query/index.ts";
import {
  getSession,
  registerSensitiveStateResetter,
  useSession,
} from "../../platform/session/store.ts";
import { haptic, telegram } from "../../platform/telegram/index.ts";
import { Button } from "../../shared/ui/index.tsx";
import { useNewMarkers } from "../new-markers/index.ts";
import { useNavigationIntent } from "../payment-recovery/index.ts";
import { AlbumClaimResultDialog } from "./AlbumClaimResultDialog.tsx";
import {
  OperationRegistryContext,
  type OperationPhase,
  type OperationRegistryValue,
} from "./context.ts";
import { EvolutionOperationDialog } from "./EvolutionOperationDialog.tsx";
import { GachaResultDialog } from "./GachaResultDialog.tsx";
import { operationLabel } from "./labels.ts";
import { WheelResultDialog } from "./WheelResultDialog.tsx";
import { markOperationNewTemplates } from "./operation-new-markers.ts";

type RegisteredOperation = {
  id: string;
  sessionGeneration: string;
  routeId: RecoverableRouteId;
  label: string;
  phase: OperationPhase;
  message: string;
  result: unknown;
  errorCode: string | null;
  persistent: boolean;
  input: unknown;
};

type GachaResultAction = "again" | "inventory" | "close";
type EvolutionResultAction = "inventory" | "album" | "acknowledge";
type GachaResult = RouteOutput<"gacha.open">;
const unresolvedPhases = new Set<OperationPhase>([
  "confirming",
  "submitting",
  "pending",
  "unknown",
]);
const acknowledgedResultRouteIds = new Set<RecoverableRouteId>([
  "gacha.open",
  "wheel.spin",
  "inventory.evolve",
]);
const navigationLockedThroughResultRouteIds = new Set<RecoverableRouteId>([
  "gacha.open",
  "wheel.spin",
]);
const externallyRenderedSuccessRouteIds = new Set<RecoverableRouteId>([
  "expedition.create",
  "mint.cancel",
  "mint.reserve",
  "referral.bind",
  "referral.share_event",
  "topup.cancel_order",
  "topup.create_order",
  "topup.fail_order",
  "vip.claim_fgems",
  "vip.claim_free_box",
  "vip.create_order",
  "wallet.disconnect",
  "wallet.verify",
]);
const inlineOperationRouteIds = new Set<RecoverableRouteId>([
  "referral.share_event",
]);

export function OperationRegistryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const session = useSession();
  const { markNew } = useNewMarkers();
  const { requestTopup } = useNavigationIntent();
  const [operations, setOperations] = useState<
    Record<string, RegisteredOperation>
  >({});
  const operationsRef = useRef(operations);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [acknowledgementError, setAcknowledgementError] = useState<{
    operationId: string;
    message: string;
  } | null>(null);
  const recoveringIds = useRef(new Set<string>());
  const acknowledgedIds = useRef(new Set<string>());
  const active = activeId ? operations[activeId] : undefined;
  const gachaResult = useMemo(() => {
    if (active?.routeId !== "gacha.open" || active.phase !== "succeeded")
      return null;
    const parsed = routeById("gacha.open").output.safeParse(active.result);
    return parsed.success ? parsed.data : null;
  }, [active]);
  const wheelResult = useMemo(() => {
    if (active?.routeId !== "wheel.spin" || active.phase !== "succeeded")
      return null;
    const parsed = routeById("wheel.spin").output.safeParse(active.result);
    return parsed.success ? parsed.data : null;
  }, [active]);
  const albumClaimResult = useMemo(() => {
    if (active?.routeId !== "album.claim" || active.phase !== "succeeded")
      return null;
    const parsed = routeById("album.claim").output.safeParse(active.result);
    return parsed.success ? parsed.data : null;
  }, [active]);
  const invalidGachaSuccess = Boolean(
    active?.routeId === "gacha.open" &&
    active.phase === "succeeded" &&
    !gachaResult,
  );
  const invalidWheelSuccess = Boolean(
    active?.routeId === "wheel.spin" &&
    active.phase === "succeeded" &&
    !wheelResult,
  );
  const invalidAlbumClaimSuccess = Boolean(
    active?.routeId === "album.claim" &&
    active.phase === "succeeded" &&
    !albumClaimResult,
  );
  const invalidDedicatedSuccess =
    invalidGachaSuccess || invalidWheelSuccess || invalidAlbumClaimSuccess;
  const unresolved = Object.values(operations).filter((operation) =>
    unresolvedPhases.has(operation.phase),
  );
  const resumableUnresolved = unresolved.filter(
    (operation) =>
      !inlineOperationRouteIds.has(operation.routeId) ||
      operation.phase === "pending" ||
      operation.phase === "unknown",
  );
  const navigationLocked = Object.values(operations).some(
    (operation) =>
      operation.sessionGeneration === session?.generation &&
      (navigationLockedThroughResultRouteIds.has(operation.routeId) ||
        (operation.routeId === "inventory.evolve" &&
          unresolvedPhases.has(operation.phase))),
  );
  const closingBlocked = unresolved.some(
    (operation) =>
      operation.phase === "confirming" || operation.phase === "submitting",
  );

  useEffect(() => {
    operationsRef.current = operations;
  }, [operations]);

  useEffect(
    () =>
      registerSensitiveStateResetter(() => {
        operationsRef.current = {};
        recoveringIds.current.clear();
        acknowledgedIds.current.clear();
        setOperations({});
        setActiveId(null);
        setAcknowledgingId(null);
        setAcknowledgementError(null);
        telegram()?.disableClosingConfirmation();
      }),
    [],
  );

  useEffect(() => {
    if (closingBlocked) telegram()?.enableClosingConfirmation();
    else telegram()?.disableClosingConfirmation();
    return () => telegram()?.disableClosingConfirmation();
  }, [closingBlocked]);

  useLayoutEffect(() => {
    if (!activeId || !dialogRef.current) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current.focus();
    return () => {
      requestAnimationFrame(() => {
        if (previousFocus?.isConnected && !previousFocus.matches(":disabled"))
          previousFocus.focus();
      });
    };
  }, [activeId]);

  const update = useCallback(
    (id: string, change: Partial<RegisteredOperation>) => {
      const current = operationsRef.current;
      if (
        !current[id] ||
        current[id].sessionGeneration !== getSession()?.generation ||
        getSession()?.accountStatus !== "normal"
      )
        return;
      const next = { ...current, [id]: { ...current[id], ...change } };
      operationsRef.current = next;
      setOperations(next);
    },
    [],
  );

  const remove = useCallback((id: string) => {
    const next = Object.fromEntries(
      Object.entries(operationsRef.current).filter(
        ([operationId]) => operationId !== id,
      ),
    );
    operationsRef.current = next;
    setOperations(next);
    setActiveId((current) =>
      current === id ? (Object.keys(next)[0] ?? null) : current,
    );
  }, []);

  const run: OperationRegistryValue["run"] = useCallback(
    async <Id extends RecoverableRouteId>(
      label: string,
      routeId: Id,
      input: RouteInput<Id>,
      options?: { background?: boolean; dialog?: boolean },
    ): Promise<RouteOutput<Id> | null> => {
      const sessionGeneration = getSession()?.generation;
      if (!sessionGeneration || getSession()?.accountStatus !== "normal")
        return null;
      if (options?.background) {
        try {
          const response = await apiRequest(routeId, input, {
            idempotencyKey: newIdempotencyKey(),
          });
          if (isCurrentNormalSession(sessionGeneration)) {
            if (response.status !== 202)
              markOperationNewTemplates(routeId, response.data, markNew);
            await refreshRouteScopes(routeId).catch(() => undefined);
          }
          return isCurrentNormalSession(sessionGeneration)
            ? response.data
            : null;
        } catch {
          if (isCurrentNormalSession(sessionGeneration))
            await refreshRouteScopes(routeId).catch(() => undefined);
          return null;
        }
      }
      const existing = Object.values(operationsRef.current).find(
        (operation) =>
          operation.sessionGeneration === sessionGeneration &&
          operation.routeId === routeId &&
          (unresolvedPhases.has(operation.phase) ||
            navigationLockedThroughResultRouteIds.has(routeId)),
      );
      if (existing) {
        if (options?.dialog !== false) setActiveId(existing.id);
        return null;
      }
      const id = newIdempotencyKey();
      const next = {
        ...operationsRef.current,
        [id]: {
          id,
          sessionGeneration,
          routeId,
          label,
          phase: "confirming",
          message: "正在确认本次操作",
          result: null,
          errorCode: null,
          persistent: false,
          input,
        },
      } satisfies Record<string, RegisteredOperation>;
      operationsRef.current = next;
      setOperations(next);
      if (options?.dialog !== false) setActiveId(id);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (!isCurrentNormalSession(sessionGeneration)) return null;
      update(id, {
        phase: "submitting",
        message: "已提交，正在等待服务器裁决",
      });
      try {
        const response = await apiRequest(routeId, input, {
          idempotencyKey: id,
        });
        if (!isCurrentNormalSession(sessionGeneration)) {
          if (getSession()?.accountStatus === "normal")
            await refreshRouteScopes(routeId);
          return null;
        }
        const pending = response.status === 202;
        if (!pending && externallyRenderedSuccessRouteIds.has(routeId))
          remove(id);
        else
          update(id, {
            phase: pending ? "pending" : "succeeded",
            message: pending
              ? "服务器已接收，最终结果仍在确认"
              : confirmedMessage(routeId, response.data),
            result: response.data,
            persistent: true,
          });
        if (!pending)
          markOperationNewTemplates(routeId, response.data, markNew);
        haptic(pending ? "warning" : "success");
        await refreshRouteScopes(routeId).catch(() => undefined);
        return response.data;
      } catch (cause) {
        if (!isCurrentNormalSession(sessionGeneration)) {
          if (getSession()?.accountStatus === "normal")
            await refreshRouteScopes(routeId);
          return null;
        }
        const failure =
          cause instanceof ApiFailure
            ? cause
            : new ApiFailure(
                0,
                "INTERNAL_ERROR",
                "操作结果暂时无法确认",
                true,
                id,
              );
        const unknown =
          Boolean(failure.operationId) &&
          ([
            "NETWORK_ERROR",
            "OPERATION_RESULT_INVALID",
            "RESPONSE_INVALID",
          ].includes(failure.code) ||
            !(cause instanceof ApiFailure));
        if (options?.dialog === false && !unknown) remove(id);
        else
          update(id, {
            phase: unknown ? "unknown" : "failed",
            message: unknown
              ? failure.code === "NETWORK_ERROR"
                ? "网络中断，必须查询原操作，不能重复提交"
                : "原操作结果详情暂时无法确认，必须查询原操作"
              : failure.message,
            errorCode: failure.code,
            persistent: Boolean(failure.operationId),
          });
        haptic("error");
        if (!unknown) await refreshRouteScopes(routeId).catch(() => undefined);
        return null;
      }
    },
    [markNew, remove, update],
  );

  const hydrate = useCallback(
    (incoming: readonly RecoverableOperationSummary[]) => {
      const sessionGeneration = getSession()?.generation;
      if (!sessionGeneration || getSession()?.accountStatus !== "normal")
        return;
      const next = { ...operationsRef.current };
      const completedOutsideRegistry = new Set<string>();
      let firstId: string | null = null;
      for (const operation of incoming) {
        if (
          !isRecoverableRouteId(operation.use_case) ||
          operation.acknowledged_at !== null ||
          acknowledgedIds.current.has(operation.operation_id)
        )
          continue;
        if (
          operation.status === "succeeded" &&
          externallyRenderedSuccessRouteIds.has(operation.use_case)
        ) {
          delete next[operation.operation_id];
          completedOutsideRegistry.add(operation.operation_id);
          markOperationNewTemplates(
            operation.use_case,
            operation.result,
            markNew,
          );
          continue;
        }
        if (!inlineOperationRouteIds.has(operation.use_case))
          firstId ??= operation.operation_id;
        next[operation.operation_id] = {
          id: operation.operation_id,
          sessionGeneration,
          routeId: operation.use_case,
          label: operationLabel(operation.use_case),
          phase: operation.status,
          message: recoveredMessage(operation),
          result: operation.result,
          errorCode: operation.error_code,
          persistent: true,
          input: null,
        };
        if (operation.status === "succeeded")
          markOperationNewTemplates(
            operation.use_case,
            operation.result,
            markNew,
          );
      }
      operationsRef.current = next;
      setOperations(next);
      setActiveId((current) =>
        current && completedOutsideRegistry.has(current)
          ? firstId
          : (current ?? firstId),
      );
    },
    [markNew],
  );

  const recover = useCallback(
    async (operation: RegisteredOperation) => {
      if (
        operation.sessionGeneration !== getSession()?.generation ||
        recoveringIds.current.has(operation.id)
      )
        return;
      recoveringIds.current.add(operation.id);
      update(operation.id, { phase: "pending", message: "正在查询原操作" });
      try {
        const response = await apiRequest("operations.get", {
          operation_id: operation.id,
        });
        if (operation.sessionGeneration !== getSession()?.generation) return;
        const recovered = parseRecoveredOperation(response.data);
        if (recovered.acknowledged_at !== null) {
          remove(operation.id);
          return;
        }
        if (recovered.status === "succeeded") {
          if (externallyRenderedSuccessRouteIds.has(operation.routeId))
            remove(operation.id);
          else
            update(operation.id, {
              phase: "succeeded",
              message: confirmedMessage(operation.routeId, recovered.result),
              result: recovered.result,
              errorCode: null,
              persistent: true,
            });
          markOperationNewTemplates(
            operation.routeId,
            recovered.result,
            markNew,
          );
          if (
            !externallyRenderedSuccessRouteIds.has(operation.routeId) &&
            acknowledgedResultRouteIds.has(operation.routeId)
          )
            setActiveId((current) => current ?? operation.id);
          haptic("success");
          await refreshRouteScopes(operation.routeId);
        } else if (recovered.status === "failed") {
          const definition =
            recovered.error_code && isErrorCode(recovered.error_code)
              ? errorDefinition(recovered.error_code)
              : null;
          update(operation.id, {
            phase: "failed",
            message: definition?.message ?? "原操作已确认失败",
            result: recovered.result,
            errorCode: recovered.error_code,
            persistent: true,
          });
          if (acknowledgedResultRouteIds.has(operation.routeId))
            setActiveId((current) => current ?? operation.id);
          await refreshRouteScopes(operation.routeId);
        } else {
          update(operation.id, {
            phase: recovered.status,
            message:
              recovered.status === "unknown"
                ? "原操作结果仍未知，请稍后继续查询"
                : "原操作仍在处理中",
          });
        }
      } catch (cause) {
        update(operation.id, {
          phase: "unknown",
          message:
            cause instanceof ApiFailure ? cause.message : "暂时无法查询原操作",
        });
      } finally {
        recoveringIds.current.delete(operation.id);
      }
    },
    [markNew, remove, update],
  );

  const pollingOperationId =
    active &&
    acknowledgedResultRouteIds.has(active.routeId) &&
    ["pending", "unknown"].includes(active.phase)
      ? active.id
      : (Object.values(operations).find(
          (operation) =>
            acknowledgedResultRouteIds.has(operation.routeId) &&
            ["pending", "unknown"].includes(operation.phase),
        )?.id ?? null);

  useEffect(() => {
    if (!pollingOperationId) return;
    const operationId = pollingOperationId;
    const delays = [1_000, 2_000, 3_000, 5_000] as const;
    let attempt = 0;
    let cancelled = false;
    let timer: number | undefined;
    const poll = () => {
      const operation = operationsRef.current[operationId];
      if (
        cancelled ||
        !operation ||
        !["pending", "unknown"].includes(operation.phase)
      )
        return;
      const delay = delays[Math.min(attempt, delays.length - 1)] ?? 5_000;
      attempt += 1;
      timer = window.setTimeout(async () => {
        const current = operationsRef.current[operationId];
        if (
          cancelled ||
          !current ||
          !["pending", "unknown"].includes(current.phase)
        )
          return;
        await recover(current);
        poll();
      }, delay);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollingOperationId, recover]);

  const value = useMemo<OperationRegistryValue>(
    () => ({
      run,
      isBlocked: (routeId) =>
        Object.values(operations).some(
          (operation) =>
            operation.sessionGeneration === getSession()?.generation &&
            operation.routeId === routeId &&
            (unresolvedPhases.has(operation.phase) ||
              navigationLockedThroughResultRouteIds.has(routeId)),
        ),
      navigationLocked,
      hydrate,
    }),
    [hydrate, navigationLocked, operations, run],
  );

  const dismiss = useCallback(() => {
    if (!active) return;
    if (active.phase === "succeeded" || active.phase === "failed")
      remove(active.id);
    else setActiveId(null);
  }, [active, remove]);

  const acknowledgeGachaResult = useCallback(
    async (operation: RegisteredOperation, action: GachaResultAction) => {
      if (
        operation.routeId !== "gacha.open" ||
        !["succeeded", "failed"].includes(operation.phase) ||
        acknowledgingId
      )
        return;
      const generation = operation.sessionGeneration;
      setAcknowledgingId(operation.id);
      setAcknowledgementError(null);
      let savingResult = false;
      try {
        let repeatDecision: {
          result: GachaResult;
          estimatedGap: number | null;
        } | null = null;
        if (action === "again") {
          const parsedResult = routeById("gacha.open").output.safeParse(
            operation.result,
          );
          if (!parsedResult.success) {
            setAcknowledgementError({
              operationId: operation.id,
              message: "开盒结果详情暂时无法确认，请查询原操作",
            });
            return;
          }
          const [bootstrap, identity] = await Promise.all([
            apiRequest("gacha.bootstrap", {}),
            apiRequest("identity.bootstrap", {}),
          ]);
          if (!isCurrentNormalSession(generation)) return;
          const box = bootstrap.data.boxes.find(
            (candidate) => candidate.tier === parsedResult.data.tier,
          );
          if (!bootstrap.data.rules_complete || !box) {
            setAcknowledgementError({
              operationId: operation.id,
              message: "开盒规则加载失败，请重试",
            });
            return;
          }
          const { draw_count, tier } = parsedResult.data;
          const free =
            draw_count === 1 &&
            ((tier === "normal" &&
              bootstrap.data.entitlements.free_normal_box > 0) ||
              (tier === "rare" &&
                bootstrap.data.entitlements.free_rare_box > 0));
          const price = draw_count === 10 ? box.ten_price : box.single_price;
          const balance = identity.data.assets.kcoin.available;
          repeatDecision = {
            result: parsedResult.data,
            estimatedGap: free || balance >= price ? null : price - balance,
          };
        }
        savingResult = true;
        await apiRequest("gacha.acknowledge_result", {
          operation_id: operation.id,
        });
        if (!isCurrentNormalSession(generation)) return;
        acknowledgedIds.current.add(operation.id);
        remove(operation.id);
        if (action === "inventory") navigate("/inventory");
        else if (action === "again" && repeatDecision) {
          const { draw_count, tier } = repeatDecision.result;
          navigate(`/?tier=${tier}`);
          if (repeatDecision.estimatedGap !== null)
            requestTopup(
              { kind: "gacha", tier, draw_count },
              repeatDecision.estimatedGap,
            );
          else
            await run(
              draw_count === 10 ? "正在准备十连开盒" : "正在开启盲盒",
              "gacha.open",
              { tier, draw_count },
            );
        }
      } catch (cause) {
        if (!isCurrentNormalSession(generation)) return;
        setAcknowledgementError({
          operationId: operation.id,
          message:
            cause instanceof ApiFailure && cause.code !== "NETWORK_ERROR"
              ? cause.message
              : savingResult
                ? "结果确认状态保存失败，请重试"
                : "最新开盒状态加载失败，请重试",
        });
      } finally {
        setAcknowledgingId((current) =>
          current === operation.id ? null : current,
        );
      }
    },
    [acknowledgingId, navigate, remove, requestTopup, run],
  );

  const acknowledgeWheelResult = useCallback(
    async (operation: RegisteredOperation) => {
      if (
        operation.routeId !== "wheel.spin" ||
        !["succeeded", "failed"].includes(operation.phase) ||
        acknowledgingId
      )
        return;
      const generation = operation.sessionGeneration;
      setAcknowledgingId(operation.id);
      setAcknowledgementError(null);
      try {
        await apiRequest("wheel.acknowledge_result", {
          operation_id: operation.id,
        });
        if (!isCurrentNormalSession(generation)) return;
        acknowledgedIds.current.add(operation.id);
        remove(operation.id);
      } catch (cause) {
        if (!isCurrentNormalSession(generation)) return;
        setAcknowledgementError({
          operationId: operation.id,
          message:
            cause instanceof ApiFailure && cause.code !== "NETWORK_ERROR"
              ? cause.message
              : "结果确认状态保存失败，请重试",
        });
      } finally {
        setAcknowledgingId((current) =>
          current === operation.id ? null : current,
        );
      }
    },
    [acknowledgingId, remove],
  );

  const acknowledgeEvolutionResult = useCallback(
    async (operation: RegisteredOperation, action: EvolutionResultAction) => {
      if (
        operation.routeId !== "inventory.evolve" ||
        !["succeeded", "failed"].includes(operation.phase) ||
        acknowledgingId
      )
        return;
      const generation = operation.sessionGeneration;
      const parsed = routeById("inventory.evolve").output.safeParse(
        operation.result,
      );
      if (
        action !== "acknowledge" &&
        (!parsed.success || parsed.data.success_count < 1)
      ) {
        setAcknowledgementError({
          operationId: operation.id,
          message: "进化结果详情暂时无法确认，请查询原操作",
        });
        return;
      }
      setAcknowledgingId(operation.id);
      setAcknowledgementError(null);
      try {
        if (!operation.persistent) {
          remove(operation.id);
          await refreshRouteScopes("inventory.evolve").catch(() => undefined);
          return;
        }
        await apiRequest("inventory.acknowledge_evolution_result", {
          operation_id: operation.id,
        });
        if (!isCurrentNormalSession(generation)) return;
        acknowledgedIds.current.add(operation.id);
        remove(operation.id);
        await refreshRouteScopes("inventory.evolve");
        if (
          action === "inventory" &&
          parsed.success &&
          parsed.data.success_count > 0
        )
          navigate(
            `/inventory?template=${encodeURIComponent(parsed.data.target.template_id)}&view=details`,
          );
        else if (action === "album") navigate("/album");
      } catch {
        if (!isCurrentNormalSession(generation)) return;
        setAcknowledgementError({
          operationId: operation.id,
          message: "结果确认状态保存失败，请重试",
        });
      } finally {
        setAcknowledgingId((current) =>
          current === operation.id ? null : current,
        );
      }
    },
    [acknowledgingId, navigate, remove],
  );

  const defer = useCallback(() => {
    if (!active) return;
    if (invalidGachaSuccess)
      update(active.id, {
        phase: "unknown",
        message: "开盒结果详情暂时无法确认，请查询原操作",
      });
    if (invalidWheelSuccess)
      update(active.id, {
        phase: "unknown",
        message: "转盘结果详情暂时无法确认，请查询原操作",
      });
    if (invalidAlbumClaimSuccess)
      update(active.id, {
        phase: "unknown",
        message: "图鉴奖励详情暂时无法确认，请查询原操作",
      });
    setActiveId(null);
  }, [
    active,
    invalidAlbumClaimSuccess,
    invalidGachaSuccess,
    invalidWheelSuccess,
    update,
  ]);

  const trapDialogFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!controls.length) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <OperationRegistryContext.Provider value={value}>
      {children}
      {session?.accountStatus === "normal" &&
        !active &&
        resumableUnresolved.length > 0 && (
          <button
            className="operation-resume"
            onClick={() => setActiveId(resumableUnresolved[0]?.id ?? null)}
          >
            {resumableUnresolved.length} 个操作待确认
          </button>
        )}
      {session?.accountStatus === "normal" && active && (
        <div
          ref={dialogRef}
          className={`modal-backdrop ${
            active.routeId === "gacha.open"
              ? `gacha-operation-backdrop phase-${active.phase}`
              : ""
          }`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={
            active.routeId === "inventory.evolve"
              ? "evolution-result-title"
              : gachaResult
                ? "gacha-result-title"
                : wheelResult
                  ? "wheel-result-title"
                  : albumClaimResult
                    ? "album-claim-result-title"
                    : "operation-dialog-title"
          }
          tabIndex={-1}
          onKeyDown={trapDialogFocus}
        >
          {active.routeId === "inventory.evolve" ? (
            <EvolutionOperationDialog
              operationId={active.id}
              phase={active.phase}
              message={active.message}
              result={active.result}
              errorCode={active.errorCode}
              busy={acknowledgingId === active.id}
              actionError={
                acknowledgementError?.operationId === active.id
                  ? acknowledgementError.message
                  : null
              }
              onRecover={() => void recover(active)}
              onSuccess={(action) =>
                void acknowledgeEvolutionResult(active, action)
              }
              onAcknowledge={() =>
                void acknowledgeEvolutionResult(active, "acknowledge")
              }
            />
          ) : gachaResult ? (
            <GachaResultDialog
              operationId={active.id}
              result={gachaResult}
              busy={acknowledgingId === active.id}
              error={
                acknowledgementError?.operationId === active.id
                  ? acknowledgementError.message
                  : null
              }
              onRepeat={() => void acknowledgeGachaResult(active, "again")}
              onInventory={() =>
                void acknowledgeGachaResult(active, "inventory")
              }
              onConfirm={() => void acknowledgeGachaResult(active, "close")}
            />
          ) : wheelResult ? (
            <WheelResultDialog
              operationId={active.id}
              result={wheelResult}
              busy={acknowledgingId === active.id}
              error={
                acknowledgementError?.operationId === active.id
                  ? acknowledgementError.message
                  : null
              }
              onConfirm={() => void acknowledgeWheelResult(active)}
            />
          ) : albumClaimResult ? (
            <AlbumClaimResultDialog
              operationId={active.id}
              result={albumClaimResult}
              onConfirm={dismiss}
            />
          ) : (
            <div
              className={`modal ${
                active.routeId === "gacha.open"
                  ? `gacha-operation-modal phase-${active.phase}`
                  : ""
              }`}
            >
              {active.routeId === "gacha.open" && active.phase !== "failed" ? (
                <>
                  <div className="gacha-opening-art" aria-hidden="true">
                    <img
                      src={gachaReferencePath(active.input)}
                      alt=""
                      width="180"
                      height="180"
                    />
                  </div>
                  <h2 id="operation-dialog-title">
                    {active.phase === "confirming" ||
                    active.phase === "submitting"
                      ? "开盒中…"
                      : "结果确认中…"}
                  </h2>
                  <p>
                    {invalidGachaSuccess
                      ? "开盒结果详情暂时无法确认，请查询原操作"
                      : active.message}
                  </p>
                  <span className="gacha-opening-track" aria-hidden="true">
                    <i />
                  </span>
                </>
              ) : (
                <>
                  <div
                    className={`operation-mark ${invalidDedicatedSuccess ? "unknown" : active.phase}`}
                  >
                    {invalidDedicatedSuccess
                      ? "…"
                      : active.phase === "succeeded"
                        ? "✓"
                        : active.phase === "failed"
                          ? "!"
                          : "…"}
                  </div>
                  <h2 id="operation-dialog-title">
                    {operationDialogTitle(active)}
                  </h2>
                  <p>
                    {invalidWheelSuccess
                      ? "转盘结果详情暂时无法确认，请查询原操作"
                      : invalidAlbumClaimSuccess
                        ? "图鉴奖励详情暂时无法确认，请查询原操作"
                        : active.message}
                  </p>
                </>
              )}
              <code>操作号 {active.id}</code>
              {acknowledgedResultRouteIds.has(active.routeId) &&
              acknowledgementError?.operationId === active.id ? (
                <p className="operation-ack-error">
                  {acknowledgementError.message}
                </p>
              ) : null}
              {(active.phase === "pending" ||
                active.phase === "unknown" ||
                invalidDedicatedSuccess) && (
                <Button onClick={() => void recover(active)}>查询原操作</Button>
              )}
              {(active.phase === "pending" ||
                active.phase === "unknown" ||
                invalidDedicatedSuccess) && (
                <Button className="secondary" onClick={defer}>
                  稍后处理
                </Button>
              )}
              {!invalidDedicatedSuccess &&
                !acknowledgedResultRouteIds.has(active.routeId) &&
                (active.phase === "succeeded" || active.phase === "failed") && (
                  <Button className="secondary" onClick={dismiss}>
                    完成
                  </Button>
                )}
              {active.routeId === "gacha.open" && active.phase === "failed" ? (
                <Button
                  className="secondary"
                  disabled={acknowledgingId === active.id}
                  onClick={() => void acknowledgeGachaResult(active, "close")}
                >
                  {acknowledgingId === active.id ? "正在确认结果" : "确定"}
                </Button>
              ) : null}
              {active.routeId === "wheel.spin" && active.phase === "failed" ? (
                <Button
                  className="secondary"
                  disabled={acknowledgingId === active.id}
                  onClick={() => void acknowledgeWheelResult(active)}
                >
                  {acknowledgingId === active.id ? "正在确认结果" : "确定"}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </OperationRegistryContext.Provider>
  );
}

function isCurrentNormalSession(generation: string): boolean {
  const session = getSession();
  return (
    session?.generation === generation && session.accountStatus === "normal"
  );
}

function gachaReferencePath(input: unknown): string {
  if (input && typeof input === "object" && "tier" in input) {
    const tier = input.tier;
    if (tier === "normal") return "/assets/boxes/normal.webp";
    if (tier === "rare") return "/assets/boxes/legendary.webp";
    if (tier === "legendary") return "/assets/boxes/rare.webp";
  }
  return "/assets/boxes/legendary.webp";
}

function recoveredMessage(operation: RecoverableOperationSummary): string {
  if (operation.status === "succeeded")
    return confirmedMessage(operation.use_case, operation.result);
  if (operation.status === "failed")
    return operation.error_code && isErrorCode(operation.error_code)
      ? errorDefinition(operation.error_code).message
      : "原操作已确认失败";
  return operation.status === "unknown"
    ? "原操作结果未知，需要继续查询"
    : "原操作仍在处理中";
}

function operationDialogTitle(operation: RegisteredOperation): string {
  if (operation.phase === "succeeded") {
    if (operation.routeId === "market.create_listing") return "上架成功";
    if (operation.routeId === "market.cancel_template_listings")
      return "已下架";
  }
  return operation.routeId === "gacha.open" && operation.phase === "failed"
    ? "开盒失败"
    : operation.label;
}

function confirmedMessage(
  routeId: RecoverableRouteId,
  result: unknown,
): string {
  if (routeId !== "market.cancel_template_listings")
    return "结果已由服务器确认";
  const parsed = routeById(routeId).output.safeParse(result);
  if (!parsed.success) return "已下架，真实状态已刷新";
  return parsed.data.released_quantity > 0
    ? `已下架，已释放 ${parsed.data.released_quantity} 个未成交藏品`
    : "已下架，当前没有有效挂单";
}
