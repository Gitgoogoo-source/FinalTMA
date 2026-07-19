import { Link2, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { DecompositionAction } from "../../domains/decomposition/index.ts";
import { EvolutionAction } from "../../domains/evolution/index.ts";
import {
  InventoryView,
  type InventoryItem,
} from "../../domains/inventory/index.ts";
import { Button } from "../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../workflows/operation-recovery/index.ts";

export function InventoryPage(): ReactNode {
  const navigate = useNavigate();
  const { isBlocked } = useOperationRegistry();
  const blocked =
    isBlocked("inventory.evolve") || isBlocked("inventory.decompose");
  const actions = (item: InventoryItem, imageReady: boolean) => (
    <>
      <EvolutionAction item={item} imageReady={imageReady} disabled={blocked} />
      <DecompositionAction
        item={item}
        imageReady={imageReady}
        disabled={blocked}
      />
      <Button
        disabled={blocked || !imageReady || item.available < 1}
        onClick={() =>
          navigate(`/market?sell=${encodeURIComponent(item.template_id)}`)
        }
      >
        <ShoppingBag />
        出售
      </Button>
      <Button
        disabled={blocked || !imageReady || item.available < 1}
        onClick={() =>
          navigate(`/mint/${encodeURIComponent(item.template_id)}`)
        }
      >
        <Link2 />
        Mint
      </Button>
    </>
  );
  return <InventoryView renderActions={actions} />;
}
