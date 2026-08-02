import { useState, type ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { evolutionRoute, type EvolutionRarity } from "../config.ts";
import { EvolutionConfirmationDialog } from "./EvolutionConfirmationDialog.tsx";

export function EvolutionAction({
  item,
  imageReady,
  disabled,
}: {
  item: {
    template_id: string;
    name: string;
    rarity: EvolutionRarity;
    available: number;
    stage: number;
    image_thumbnail_path: string;
  };
  imageReady: boolean;
  disabled: boolean;
}): ReactNode {
  const { isBlocked, run } = useOperationRegistry();
  const [confirming, setConfirming] = useState(false);
  const bootstrap = useApiQuery("identity.bootstrap");
  const route = evolutionRoute(item.template_id);
  const evolving = isBlocked("inventory.evolve");
  const reason = evolutionDisabledReason({
    item,
    imageReady,
    disabled,
    evolving,
    routeAvailable: Boolean(route),
  });

  const confirm = async (quantity: number) => {
    if (!route) return;
    setConfirming(false);
    await run("正在确认进化结果", "inventory.evolve", {
      template_id: item.template_id,
      quantity,
    });
  };

  return (
    <div className="evolution-action">
      <Button
        className="inventory-action-button inventory-action-button--evolve"
        aria-label={reason ? `进化：${reason}` : "进化"}
        disabled={reason !== null}
        title={reason ?? undefined}
        onClick={() => setConfirming(true)}
      >
        <img
          src="/assets/inventory/actions/evolve.png"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <span>进化</span>
      </Button>
      {confirming && route ? (
        <EvolutionConfirmationDialog
          source={item}
          route={route}
          availableFgems={bootstrap.data?.assets.fgems.available}
          onCancel={() => setConfirming(false)}
          onConfirm={(quantity) => void confirm(quantity)}
        />
      ) : null}
    </div>
  );
}

function evolutionDisabledReason({
  item,
  imageReady,
  disabled,
  evolving,
  routeAvailable,
}: {
  item: { stage: number };
  imageReady: boolean;
  disabled: boolean;
  evolving: boolean;
  routeAvailable: boolean;
}): string | null {
  if (evolving) return "正在确认进化结果";
  if (disabled) return "正在处理，请勿重复点击";
  if (item.stage >= 3) return "该藏品已经是最终形态，无法继续进化";
  if (!routeAvailable) return "当前藏品暂不支持进化";
  if (!imageReady) return "正在加载藏品图片";
  return null;
}
