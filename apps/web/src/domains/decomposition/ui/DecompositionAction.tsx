import { Flame } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { DecompositionConfirmationDialog } from "./DecompositionConfirmationDialog.tsx";

type InventoryItem = RouteOutput<"inventory.list">["items"][number];

export function DecompositionAction({
  item,
  imageReady,
  disabled,
}: {
  item: InventoryItem;
  imageReady: boolean;
  disabled: boolean;
}): ReactNode {
  const { run } = useOperationRegistry();
  const [confirming, setConfirming] = useState(false);
  const detail = useApiQuery(
    "inventory.detail",
    { template_id: item.template_id },
    confirming,
  );
  const confirm = async (quantity: number) => {
    setConfirming(false);
    await run("正在确认分解结果", "inventory.decompose", {
      template_id: item.template_id,
      quantity,
    });
  };
  return (
    <>
      <Button
        disabled={disabled || !imageReady || item.available < 1}
        onClick={() => {
          setConfirming(true);
          void detail.refetch();
        }}
      >
        <Flame />
        分解
      </Button>
      {confirming && detail.data && !detail.isFetching && !detail.isError ? (
        <DecompositionConfirmationDialog
          item={detail.data}
          onCancel={() => setConfirming(false)}
          onConfirm={(quantity) => void confirm(quantity)}
        />
      ) : null}
      {confirming && (!detail.data || detail.isFetching || detail.isError) ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="decomposition-loading-title"
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
        </div>
      ) : null}
    </>
  );
}
