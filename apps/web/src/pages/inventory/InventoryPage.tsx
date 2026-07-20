import { Link2, ShoppingBag } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { DecompositionAction } from "../../domains/decomposition/index.ts";
import { EvolutionAction } from "../../domains/evolution/index.ts";
import {
  InventoryView,
  type InventoryItem,
} from "../../domains/inventory/index.ts";
import { Button } from "../../shared/ui/index.tsx";
import { focusTaskTarget } from "../../shared/navigation/focusTaskTarget.ts";
import { useOperationRegistry } from "../../workflows/operation-recovery/index.ts";

export function InventoryPage(): ReactNode {
  const navigate = useNavigate();
  const [params] = useSearchParams();
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
          disabled={blocked || !imageReady || item.available < 1}
          onClick={() =>
            navigate(`/market?sell=${encodeURIComponent(item.template_id)}`)
          }
        >
          <ShoppingBag />
          出售
        </Button>
      </TaskActionTarget>
      <TaskActionTarget active={requestedFocus === "mint"}>
        <Button
          disabled={blocked || !imageReady || item.available < 1}
          onClick={() =>
            navigate(`/mint/${encodeURIComponent(item.template_id)}`)
          }
        >
          <Link2 />
          Mint
        </Button>
      </TaskActionTarget>
    </>
  );
  return <InventoryView renderActions={actions} />;
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
