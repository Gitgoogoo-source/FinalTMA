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
  const isPreparing = confirming && detail.isFetching;
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
        aria-busy={isPreparing}
        disabled={disabled || !imageReady || item.available < 1 || isPreparing}
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
        <span>
          {isPreparing ? "准备分解" : detail.isError ? "重试分解" : "分解"}
        </span>
      </Button>
      {confirming && detail.data && !detail.isFetching && !detail.isError ? (
        <DecompositionConfirmationDialog
          item={detail.data}
          onCancel={() => setConfirming(false)}
          onConfirm={(quantity) => void confirm(quantity)}
        />
      ) : null}
    </>
  );
}
