import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  errorDefinition,
  isErrorCode,
  isRecoverableRouteId,
  parseRecoveredOperation,
  type RecoverableRouteId,
  type RouteInput,
  type RouteOutput,
  type TypedOperationSummary,
} from "@pokepets/api-contracts";

import {
  ApiFailure,
  apiRequest,
  newIdempotencyKey,
} from "../../platform/api/client.ts";
import { refreshRouteScopes } from "../../platform/query/index.ts";
import { haptic, telegram } from "../../platform/telegram/index.ts";
import { Button } from "../../shared/ui/index.tsx";
import {
  OperationRegistryContext,
  type OperationPhase,
  type OperationRegistryValue,
} from "./context.ts";
import { operationLabel } from "./labels.ts";

type RegisteredOperation = {
  id: string;
  routeId: RecoverableRouteId;
  label: string;
  phase: OperationPhase;
  message: string;
  result: unknown;
  errorCode: string | null;
};

export function OperationRegistryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [operations, setOperations] = useState<
    Record<string, RegisteredOperation>
  >({});
  const operationsRef = useRef(operations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId ? operations[activeId] : undefined;
  const unresolved = Object.values(operations).filter((operation) =>
    ["confirming", "submitting", "pending", "unknown"].includes(
      operation.phase,
    ),
  );
  const closingBlocked = unresolved.some(
    (operation) =>
      operation.phase === "confirming" || operation.phase === "submitting",
  );

  useEffect(() => {
    operationsRef.current = operations;
  }, [operations]);

  useEffect(() => {
    if (closingBlocked) telegram()?.enableClosingConfirmation();
    else telegram()?.disableClosingConfirmation();
    return () => telegram()?.disableClosingConfirmation();
  }, [closingBlocked]);

  const update = useCallback(
    (id: string, change: Partial<RegisteredOperation>) => {
      const current = operationsRef.current;
      if (!current[id]) return;
      const next = { ...current, [id]: { ...current[id], ...change } };
      operationsRef.current = next;
      setOperations(next);
    },
    [],
  );

  const run: OperationRegistryValue["run"] = useCallback(
    async <Id extends RecoverableRouteId>(
      label: string,
      routeId: Id,
      input: RouteInput<Id>,
    ): Promise<RouteOutput<Id> | null> => {
      const existing = Object.values(operationsRef.current).find(
        (operation) =>
          operation.routeId === routeId &&
          ["confirming", "submitting", "pending", "unknown"].includes(
            operation.phase,
          ),
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
      update(id, {
        phase: "submitting",
        message: "已提交，正在等待服务器裁决",
      });
      try {
        const response = await apiRequest(routeId, input, {
          idempotencyKey: id,
        });
        const pending = response.status === 202;
        update(id, {
          phase: pending ? "pending" : "succeeded",
          message: pending
            ? "服务器已接收，最终结果仍在确认"
            : "结果已由服务器确认",
          result: response.data,
        });
        haptic(pending ? "warning" : "success");
        await refreshRouteScopes(routeId);
        return response.data;
      } catch (cause) {
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
    [update],
  );

  const hydrate = useCallback((incoming: readonly TypedOperationSummary[]) => {
    setOperations((current) => {
      const next = { ...current };
      for (const operation of incoming) {
        if (
          !isRecoverableRouteId(operation.use_case) ||
          next[operation.operation_id]
        )
          continue;
        next[operation.operation_id] = {
          id: operation.operation_id,
          routeId: operation.use_case,
          label: operationLabel(operation.use_case),
          phase: operation.status === "unknown" ? "unknown" : "pending",
          message:
            operation.status === "unknown"
              ? "原操作结果未知，需要继续查询"
              : "原操作仍在处理中",
          result: operation.result,
          errorCode: operation.error_code,
        };
      }
      return next;
    });
    setActiveId((current) => current ?? incoming[0]?.operation_id ?? null);
  }, []);

  const recover = useCallback(
    async (operation: RegisteredOperation) => {
      update(operation.id, { phase: "pending", message: "正在查询原操作" });
      try {
        const response = await apiRequest("operations.get", {
          operation_id: operation.id,
        });
        const recovered = parseRecoveredOperation(response.data);
        if (recovered.status === "succeeded") {
          update(operation.id, {
            phase: "succeeded",
            message: "原操作已确认成功",
            result: recovered.result,
            errorCode: null,
          });
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
      }
    },
    [update],
  );

  const value = useMemo<OperationRegistryValue>(
    () => ({
      run,
      isBlocked: (routeId) =>
        Object.values(operations).some(
          (operation) =>
            operation.routeId === routeId &&
            ["confirming", "submitting", "pending", "unknown"].includes(
              operation.phase,
            ),
        ),
      hydrate,
    }),
    [hydrate, operations, run],
  );

  const dismiss = () => {
    if (!active) return;
    setActiveId(null);
    if (active.phase === "succeeded" || active.phase === "failed") {
      setOperations((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== active.id),
        ),
      );
    }
  };

  return (
    <OperationRegistryContext.Provider value={value}>
      {children}
      {!active && unresolved.length > 0 && (
        <button
          className="operation-resume"
          onClick={() => setActiveId(unresolved[0]?.id ?? null)}
        >
          {unresolved.length} 个操作待确认
        </button>
      )}
      {active && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className={`operation-mark ${active.phase}`}>
              {active.phase === "succeeded"
                ? "✓"
                : active.phase === "failed"
                  ? "!"
                  : "…"}
            </div>
            <h2>{active.label}</h2>
            <p>{active.message}</p>
            <code>操作号 {active.id}</code>
            {(active.phase === "pending" || active.phase === "unknown") && (
              <Button onClick={() => void recover(active)}>查询原操作</Button>
            )}
            {(active.phase === "pending" ||
              active.phase === "unknown" ||
              active.phase === "succeeded" ||
              active.phase === "failed") && (
              <Button className="secondary" onClick={dismiss}>
                {active.phase === "pending" || active.phase === "unknown"
                  ? "稍后处理"
                  : "完成"}
              </Button>
            )}
          </div>
        </div>
      )}
    </OperationRegistryContext.Provider>
  );
}
