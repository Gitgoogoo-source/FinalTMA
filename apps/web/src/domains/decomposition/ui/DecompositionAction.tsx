import { useState, type ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { useApiQuery } from "../../../platform/query/index.ts";
import { AppModal, Button } from "../../../shared/ui/index.tsx";
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
    await run(
      "分解仪式",
      "inventory.decompose",
      {
        template_id: item.template_id,
        quantity,
      },
      {
        presentation: {
          name: item.name,
          imagePath: item.image_detail_path,
        },
      },
    );
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
          onConfirm={(quantity) => void confirm(quantity)}
        />
      ) : null}
      {confirming && (!detail.data || detail.isFetching || detail.isError) ? (
        <AppModal
          labelledBy="decomposition-loading-title"
          onClose={() => setConfirming(false)}
        >
          <div className="modal inventory-quantity-modal">
            <h2 id="decomposition-loading-title">
              {detail.isError ? "分解仪式暂时无法开始" : "整理分解材料"}
            </h2>
            <p>
              {detail.isError
                ? "请稍后再试，本次不会消耗宠物。"
                : "晶辉即将显现。"}
            </p>
            {detail.isError ? (
              <Button onClick={() => void detail.refetch()}>再试一次</Button>
            ) : null}
            <Button className="secondary" onClick={() => setConfirming(false)}>
              返回
            </Button>
          </div>
        </AppModal>
      ) : null}
    </>
  );
}
