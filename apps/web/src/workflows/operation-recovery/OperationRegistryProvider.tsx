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
  type RecoverableRouteId,
  type RouteInput,
  type RouteOutput,
  type TypedOperationSummary,
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
import {
  OperationRegistryContext,
  type OperationPhase,
  type OperationRegistryValue,
} from "./context.ts";
import { GachaResultDialog } from "./GachaResultDialog.tsx";
import { operationLabel } from "./labels.ts";

type RegisteredOperation = {
  id: string;
  sessionGeneration: string;
  routeId: RecoverableRouteId;
  label: string;
  phase: OperationPhase;
  message: string;
  result: unknown;
  errorCode: string | null;
};

type GachaResultAction = "again" | "inventory" | "close";
type GachaResult = RouteOutput<"gacha.open">;
const unresolvedPhases = new Set<OperationPhase>([
  "confirming",
  "submitting",
  "pending",
  "unknown",
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
  const invalidGachaSuccess = Boolean(
    active?.routeId === "gacha.open" &&
    active.phase === "succeeded" &&
    !gachaResult,
  );
  const unresolved = Object.values(operations).filter((operation) =>
    unresolvedPhases.has(operation.phase),
  );
  const navigationLocked = Object.values(operations).some(
    (operation) =>
      operation.sessionGeneration === session?.generation &&
      operation.routeId === "gacha.open",
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
      options?: { background?: boolean },
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
              markConfirmedGachaTemplates(routeId, response.data, markNew);
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
          (unresolvedPhases.has(operation.phase) || routeId === "gacha.open"),
      );
      if (existing) {
        setActiveId(existing.id);
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
        },
      } satisfies Record<string, RegisteredOperation>;
      operationsRef.current = next;
      setOperations(next);
      setActiveId(id);
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
        update(id, {
          phase: pending ? "pending" : "succeeded",
          message: pending
            ? "服务器已接收，最终结果仍在确认"
            : "结果已由服务器确认",
          result: response.data,
        });
        if (!pending)
          markConfirmedGachaTemplates(routeId, response.data, markNew);
        haptic(pending ? "warning" : "success");
        await refreshRouteScopes(routeId);
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
          failure.code === "NETWORK_ERROR" && Boolean(failure.operationId);
        update(id, {
          phase: unknown ? "unknown" : "failed",
          message: unknown
            ? "网络中断，必须查询原操作，不能重复提交"
            : failure.message,
          errorCode: failure.code,
        });
        haptic("error");
        if (!unknown) await refreshRouteScopes(routeId);
        return null;
      }
    },
    [markNew, update],
  );

  const hydrate = useCallback(
    (incoming: readonly TypedOperationSummary[]) => {
      const sessionGeneration = getSession()?.generation;
      if (!sessionGeneration || getSession()?.accountStatus !== "normal")
        return;
      const next = { ...operationsRef.current };
      let firstId: string | null = null;
      for (const operation of incoming) {
        if (
          !isRecoverableRouteId(operation.use_case) ||
          operation.acknowledged_at !== null ||
          acknowledgedIds.current.has(operation.operation_id)
        )
          continue;
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
        };
        if (operation.status === "succeeded")
          markConfirmedGachaTemplates(
            operation.use_case,
            operation.result,
            markNew,
          );
      }
      operationsRef.current = next;
      setOperations(next);
      setActiveId((current) => current ?? firstId);
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
          update(operation.id, {
            phase: "succeeded",
            message: "原操作已确认成功",
            result: recovered.result,
            errorCode: null,
          });
          markConfirmedGachaTemplates(
            operation.routeId,
            recovered.result,
            markNew,
          );
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
            errorCode: recovered.error_code,
          });
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

  const pollingGachaId =
    active?.routeId === "gacha.open" &&
    ["pending", "unknown"].includes(active.phase)
      ? active.id
      : null;

  useEffect(() => {
    if (!pollingGachaId) return;
    const operationId = pollingGachaId;
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
  }, [pollingGachaId, recover]);

  const value = useMemo<OperationRegistryValue>(
    () => ({
      run,
      isBlocked: (routeId) =>
        Object.values(operations).some(
          (operation) =>
            operation.sessionGeneration === getSession()?.generation &&
            operation.routeId === routeId &&
            (unresolvedPhases.has(operation.phase) || routeId === "gacha.open"),
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

  const defer = useCallback(() => {
    if (!active) return;
    if (invalidGachaSuccess)
      update(active.id, {
        phase: "unknown",
        message: "开盒结果详情暂时无法确认，请查询原操作",
      });
    setActiveId(null);
  }, [active, invalidGachaSuccess, update]);

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
        unresolved.length > 0 && (
          <button
            className="operation-resume"
            onClick={() => setActiveId(unresolved[0]?.id ?? null)}
          >
            {unresolved.length} 个操作待确认
          </button>
        )}
      {session?.accountStatus === "normal" && active && (
        <div
          ref={dialogRef}
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={
            gachaResult ? "gacha-result-title" : "operation-dialog-title"
          }
          tabIndex={-1}
          onKeyDown={trapDialogFocus}
        >
          {gachaResult ? (
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
          ) : (
            <div className="modal">
              <div
                className={`operation-mark ${invalidGachaSuccess ? "unknown" : active.phase}`}
              >
                {invalidGachaSuccess
                  ? "…"
                  : active.phase === "succeeded"
                    ? "✓"
                    : active.phase === "failed"
                      ? "!"
                      : "…"}
              </div>
              <h2 id="operation-dialog-title">{active.label}</h2>
              <p>
                {invalidGachaSuccess
                  ? "开盒结果详情暂时无法确认，请查询原操作"
                  : active.message}
              </p>
              <code>操作号 {active.id}</code>
              {active.routeId === "gacha.open" &&
              acknowledgementError?.operationId === active.id ? (
                <p className="operation-ack-error">
                  {acknowledgementError.message}
                </p>
              ) : null}
              {(active.phase === "pending" ||
                active.phase === "unknown" ||
                invalidGachaSuccess) && (
                <Button onClick={() => void recover(active)}>查询原操作</Button>
              )}
              {(active.phase === "pending" ||
                active.phase === "unknown" ||
                invalidGachaSuccess) && (
                <Button className="secondary" onClick={defer}>
                  稍后处理
                </Button>
              )}
              {!invalidGachaSuccess &&
                active.routeId !== "gacha.open" &&
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
            </div>
          )}
        </div>
      )}
    </OperationRegistryContext.Provider>
  );
}

function parseGachaResult(result: unknown): GachaResult | null {
  const parsed = routeById("gacha.open").output.safeParse(result);
  return parsed.success ? parsed.data : null;
}

function markConfirmedGachaTemplates(
  routeId: RecoverableRouteId,
  result: unknown,
  markNew: (templateIds: readonly string[]) => void,
): void {
  if (routeId !== "gacha.open") return;
  const gachaResult = parseGachaResult(result);
  if (gachaResult) markNew(gachaResult.results.map((item) => item.template_id));
}

function isCurrentNormalSession(generation: string): boolean {
  const session = getSession();
  return (
    session?.generation === generation && session.accountStatus === "normal"
  );
}

function recoveredMessage(operation: TypedOperationSummary): string {
  if (operation.status === "succeeded") return "原操作已确认成功";
  if (operation.status === "failed")
    return operation.error_code && isErrorCode(operation.error_code)
      ? errorDefinition(operation.error_code).message
      : "原操作已确认失败";
  return operation.status === "unknown"
    ? "原操作结果未知，需要继续查询"
    : "原操作仍在处理中";
}
