import { useCallback, useMemo, useState, type ReactNode } from "react";

import { apiRequest, ApiFailure } from "../../platform/api/client.ts";
import { refreshUserState } from "../../platform/query/index.ts";
import { useSession } from "../../platform/session/store.ts";
import { haptic, telegram } from "../../platform/telegram/index.ts";
import { Button } from "../ui/index.tsx";
import { OperationContext } from "./OperationContext.ts";

type Phase = "idle" | "confirming" | "submitting" | "succeeded" | "failed" | "unknown" | "recovering";
type State = { phase: Phase; label: string; message: string; operationId: string | null };
const initialState: State = { phase: "idle", label: "", message: "", operationId: null };

export function OperationProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState(initialState);
  const session = useSession();
  const restricted = !session || session.recovering || session.accountStatus === "banned";
  const run = useCallback(async <T,>(label: string, action: () => Promise<{ data: T; operationId: string | null }>): Promise<T | null> => {
    setState({ phase: "confirming", label, message: "正在确认本次操作", operationId: null });
    telegram()?.enableClosingConfirmation();
    await Promise.resolve();
    setState({ phase: "submitting", label, message: "已提交，正在确认真实结果", operationId: null });
    try {
      const response = await action();
      setState({ phase: "succeeded", label, message: "结果已由服务器确认", operationId: response.operationId });
      haptic("success");
      await refreshUserState();
      return response.data;
    } catch (cause) {
      const error = cause instanceof ApiFailure ? cause : new ApiFailure(0, "UNKNOWN_ERROR", "操作结果暂时无法确认", true, null);
      const unknown = error.code === "NETWORK_ERROR" && Boolean(error.operationId);
      setState({ phase: unknown ? "unknown" : "failed", label, message: unknown ? "网络中断，正在等待恢复原操作" : error.message, operationId: error.operationId });
      haptic("error");
      return null;
    } finally {
      telegram()?.disableClosingConfirmation();
    }
  }, []);
  const blocked = ["confirming", "submitting", "unknown", "recovering"].includes(state.phase);
  const value = useMemo(() => ({ blocked, run }), [blocked, run]);
  const recover = async () => {
    if (!state.operationId) return;
    const operationId = state.operationId;
    setState((current) => ({ ...current, phase: "recovering", message: "正在查询原操作" }));
    try {
      const response = await apiRequest("operations.get", { operation_id: operationId });
      if (response.data.status === "succeeded") {
        setState({ phase: "succeeded", label: state.label, message: "原操作已确认成功，页面数据已刷新", operationId });
        await refreshUserState();
      } else if (response.data.status === "failed") {
        setState({ phase: "failed", label: state.label, message: "原操作已确认失败，未重复提交", operationId });
        await refreshUserState();
      } else {
        setState({ phase: "unknown", label: state.label, message: "原操作仍在处理中，请稍后继续查询", operationId });
      }
    } catch (cause) {
      setState({ phase: "unknown", label: state.label, message: cause instanceof ApiFailure ? cause.message : "暂时无法查询原操作", operationId });
    }
  };
  return (
    <OperationContext.Provider value={value}>
      {children}
      {!restricted && state.phase !== "idle" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className={`operation-mark ${state.phase}`}>{state.phase === "succeeded" ? "✓" : state.phase === "failed" ? "!" : "…"}</div>
            <h2>{state.label}</h2>
            <p>{state.message}</p>
            {state.operationId && <code>操作号 {state.operationId}</code>}
            {!blocked && <Button onClick={() => setState(initialState)}>完成</Button>}
            {state.phase === "unknown" && <Button className="secondary" onClick={() => void recover()}>查询原操作</Button>}
          </div>
        </div>
      )}
    </OperationContext.Provider>
  );
}
