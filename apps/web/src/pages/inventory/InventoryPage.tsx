import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { DecompositionAction } from "../../domains/decomposition/index.ts";
import { EvolutionAction } from "../../domains/evolution/index.ts";
import {
  InventoryView,
  SellQuantityDialog,
  type InventoryItem,
} from "../../domains/inventory/index.ts";
import { Button } from "../../shared/ui/index.tsx";
import { focusTaskTarget } from "../../shared/navigation/focusTaskTarget.ts";
import { usePageSearchParams } from "../../shared/navigation/pageActivity.tsx";
import { usePageModulePreparation } from "../../shared/navigation/pageModulePreparation.ts";
import { useOperationRegistry } from "../../workflows/operation-recovery/context.ts";
import "../../shared/styles/inventory-page.css";

export function InventoryPage(): ReactNode {
  const navigate = useNavigate();
  const preparePage = usePageModulePreparation();
  const [params] = usePageSearchParams();
  const [sellItem, setSellItem] = useState<InventoryItem | null>(null);
  const requestedFocus = params.get("focus");
  const { isBlocked } = useOperationRegistry();
  const blocked =
    isBlocked("inventory.evolve") || isBlocked("inventory.decompose");
  const actions = (item: InventoryItem, imageReady: boolean) => (
    <>
      <TaskActionTarget active={requestedFocus === "evolution"}>
        <EvolutionAction
          item={item}
          imageReady={imageReady}
          disabled={blocked}
        />
      </TaskActionTarget>
      <TaskActionTarget active={requestedFocus === "decomposition"}>
        <DecompositionAction
          item={item}
          imageReady={imageReady}
          disabled={blocked}
        />
      </TaskActionTarget>
      <TaskActionTarget active={false}>
        <Button
          className="inventory-action-button inventory-action-button--sell"
          disabled={blocked || !imageReady || item.available < 1}
          onClick={() => setSellItem(item)}
        >
          <span>出售</span>
        </Button>
      </TaskActionTarget>
    </>
  );
  return (
    <>
      <InventoryView renderActions={actions} />
      {sellItem ? (
        <SellQuantityDialog
          item={sellItem}
          onCancel={() => setSellItem(null)}
          onConfirm={(quantity) => {
            const templateId = sellItem.template_id;
            setSellItem(null);
            const path = `/market?sell=${encodeURIComponent(templateId)}&quantity=${quantity}`;
            preparePage(path);
            navigate(path);
          }}
        />
      ) : null}
    </>
  );
}

function TaskActionTarget({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}): ReactNode {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    return focusTaskTarget(target.current);
  }, [active]);
  return (
    <div ref={target} className="inventory-action-target" tabIndex={-1}>
      {children}
    </div>
  );
}
