import { useCallback, useMemo, useState, type ReactNode } from "react";

import { apiRequest, ApiFailure } from "../../platform/api/client.ts";
import { refreshUserState } from "../../platform/query/index.ts";
import { useSession } from "../../platform/session/store.ts";
import { haptic, telegram } from "../../platform/telegram/index.ts";
import { child, records, text } from "../lib/data.ts";
import { Badge, Button, CatalogImage } from "../ui/index.tsx";
import { OperationContext } from "./OperationContext.ts";

type State = {
  phase: "idle" | "pending" | "succeeded" | "failed";
  label: string;
  message: string;
  result: Record<string, unknown> | null;
  operationId: string | null;
};
const initialState: State = {
  phase: "idle",
  label: "",
  message: "",
  result: null,
  operationId: null,
};

export function OperationProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [state, setState] = useState(initialState);
  const session = useSession();
  const restricted =
    !session || session.recovering || session.accountStatus === "banned";
  const run = useCallback(
    async <T extends Record<string, unknown>>(
      label: string,
      action: () => Promise<{ data: T; operationId: string | null }>,
    ): Promise<T | null> => {
      setState({
        phase: "pending",
        label,
        message: "正在处理，请稍候",
        result: null,
        operationId: null,
      });
      telegram()?.enableClosingConfirmation();
      try {
        const response = await action();
        setState({
          phase: "succeeded",
          label,
          message: response.operationId ? "结果已由服务器确认" : "操作已完成",
          result: response.data,
          operationId: response.operationId,
        });
        haptic("success");
        await refreshUserState();
        return response.data;
      } catch (cause) {
        const error =
          cause instanceof ApiFailure
            ? cause
            : new ApiFailure(
                0,
                "UNKNOWN_ERROR",
                "结果暂时无法确认，请重新查询原操作",
                true,
                null,
              );
        setState({
          phase: "failed",
          label,
          message: error.message,
          result: null,
          operationId: error.operationId,
        });
        haptic("error");
        return null;
      } finally {
        telegram()?.disableClosingConfirmation();
      }
    },
    [],
  );
  const value = useMemo(
    () => ({ blocked: state.phase === "pending", run }),
    [run, state.phase],
  );
  const recover = async () => {
    if (!state.operationId) return;
    const operationId = state.operationId;
    setState((current) => ({
      ...current,
      phase: "pending",
      message: "正在查询原操作",
    }));
    try {
      const response = await apiRequest("operations.result", {
        operation_id: operationId,
      });
      const status = text(response.data.status, "unknown");
      if (status === "succeeded") {
        setState({
          phase: "succeeded",
          label: state.label,
          message: "已恢复服务器确认结果",
          result: child(response.data, "result"),
          operationId,
        });
        await refreshUserState();
      } else {
        setState({
          phase: "failed",
          label: state.label,
          message:
            status === "failed"
              ? "服务器已确认原操作失败"
              : "原操作仍在处理中，请稍后再次查询",
          result: status === "failed" ? child(response.data, "result") : null,
          operationId,
        });
      }
    } catch (cause) {
      setState({
        phase: "failed",
        label: state.label,
        message:
          cause instanceof ApiFailure
            ? cause.message
            : "暂时无法查询原操作，请稍后重试",
        result: null,
        operationId,
      });
    }
  };
  return (
    <OperationContext.Provider value={value}>
      {children}
      {!restricted && state.phase !== "idle" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className={`operation-mark ${state.phase}`}>
              {state.phase === "pending"
                ? "…"
                : state.phase === "succeeded"
                  ? "✓"
                  : "!"}
            </div>
            <h2>{state.label}</h2>
            <p>{state.message}</p>
            {state.operationId && <code>操作号 {state.operationId}</code>}
            {state.result && <ResultSummary result={state.result} />}
            {state.phase !== "pending" && (
              <div className="button-row">
                {state.phase === "failed" && state.operationId && (
                  <Button className="secondary" onClick={() => void recover()}>
                    查询原操作
                  </Button>
                )}
                <Button onClick={() => setState(initialState)}>完成</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </OperationContext.Provider>
  );
}

function ResultSummary({
  result,
}: {
  result: Record<string, unknown>;
}): ReactNode {
  const rewards = records(result.results ?? result.rewards);
  const entries = Object.entries(result)
    .filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value),
    )
    .slice(0, 6);
  return (
    <div className="result-panel">
      {rewards.length > 0 && (
        <div className="reward-results">
          {rewards.map((reward, index) => (
            <article
              key={`${text(reward.template_id, text(reward.kind))}-${index}`}
            >
              {Boolean(reward.image_path) && (
                <CatalogImage
                  path={reward.image_path}
                  alt={text(reward.name, "服务器确认结果")}
                />
              )}
              <div>
                {Boolean(reward.rarity) && <Badge>{text(reward.rarity)}</Badge>}
                <strong>{text(reward.name, text(reward.kind, "奖励"))}</strong>
                {reward.amount !== undefined && (
                  <span>×{text(reward.amount)}</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <dl className="result-summary">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
