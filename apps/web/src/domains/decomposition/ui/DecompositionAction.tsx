import { useRef, useState, type ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import {
  ApiFailure,
  apiRequest,
  newIdempotencyKey,
} from "../../../platform/api/client.ts";
import { useApiQuery } from "../../../platform/query/index.ts";
import { AppModal, Button } from "../../../shared/ui/index.tsx";
import { DecompositionConfirmationDialog } from "./DecompositionConfirmationDialog.tsx";

type InventoryItem = RouteOutput<"inventory.list">["items"][number];
type SubmissionFeedback = "success" | "failed";

export function DecompositionAction({
  item,
  imageReady,
  disabled,
}: {
  item: InventoryItem;
  imageReady: boolean;
  disabled: boolean;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<SubmissionFeedback | null>(null);
  const latestSubmissionId = useRef<string | null>(null);
  const detail = useApiQuery(
    "inventory.detail",
    { template_id: item.template_id },
    confirming,
  );
  const confirm = (quantity: number) => {
    setConfirming(false);
    try {
      const operationId = newIdempotencyKey();
      latestSubmissionId.current = operationId;
      const request = apiRequest(
        "inventory.decompose",
        { template_id: item.template_id, quantity },
        { idempotencyKey: operationId },
      );
      setFeedback("success");
      void request.catch((cause: unknown) => {
        if (
          latestSubmissionId.current === operationId &&
          requestWasNotSent(cause)
        )
          setFeedback("failed");
      });
    } catch {
      latestSubmissionId.current = null;
      setFeedback("failed");
    }
  };
  return (
    <>
      <Button
        className="inventory-action-button inventory-action-button--decompose"
        disabled={disabled || !imageReady || item.available < 1}
        onClick={() => {
          setConfirming(true);
          void detail.refetch();
        }}
      >
        <img
          src="/assets/inventory/actions/decompose.png"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <span>分解</span>
      </Button>
      {confirming && detail.data && !detail.isFetching && !detail.isError ? (
        <DecompositionConfirmationDialog
          item={detail.data}
          onCancel={() => setConfirming(false)}
          onConfirm={confirm}
        />
      ) : null}
      {confirming && (!detail.data || detail.isFetching || detail.isError) ? (
        <AppModal
          labelledBy="decomposition-loading-title"
          onClose={() => setConfirming(false)}
        >
          <div className="modal inventory-quantity-modal">
            <h2 id="decomposition-loading-title">
              {detail.isError ? "分解信息加载失败" : "正在加载最新分解信息"}
            </h2>
            <p>
              {detail.isError
                ? "未确认最新可用数量与分解产出，本次不会提交。"
                : "正在确认真实可用数量与单个分解产出。"}
            </p>
            {detail.isError ? (
              <Button onClick={() => void detail.refetch()}>重新加载</Button>
            ) : null}
            <Button className="secondary" onClick={() => setConfirming(false)}>
              取消
            </Button>
          </div>
        </AppModal>
      ) : null}
      {feedback ? (
        <AppModal
          labelledBy="decomposition-submission-title"
          onClose={() => setFeedback(null)}
        >
          <div className="modal inventory-quantity-modal">
            <div className={`operation-mark ${feedback}`}>
              {feedback === "success" ? "✓" : "!"}
            </div>
            <h2 id="decomposition-submission-title">
              {feedback === "success" ? "分解成功" : "提交失败"}
            </h2>
            {feedback === "failed" ? (
              <p>分解请求未能发出，请检查网络后重试。</p>
            ) : null}
            <Button className="secondary" onClick={() => setFeedback(null)}>
              完成
            </Button>
          </div>
        </AppModal>
      ) : null}
    </>
  );
}

function requestWasNotSent(cause: unknown): boolean {
  if (cause instanceof ApiFailure) return cause.code === "NETWORK_ERROR";
  return !(cause instanceof DOMException && cause.name === "AbortError");
}
