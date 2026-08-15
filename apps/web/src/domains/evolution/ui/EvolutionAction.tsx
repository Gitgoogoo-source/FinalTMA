import { useState, type ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { useCatalogQuery } from "../../../platform/query/useCatalogQuery.ts";
import { Button } from "../../../shared/ui/Button.tsx";
import {
  useOperationBlocked,
  useOperationCommands,
} from "../../../workflows/operation-recovery/context.ts";
import { evolutionRoute, type EvolutionRarity } from "../config.ts";
import { EvolutionConfirmationDialog } from "./EvolutionConfirmationDialog.tsx";
import { t, tp } from "../../../platform/i18n/index.ts";

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
    image_thumbnail_url: string;
  };
  imageReady: boolean;
  disabled: boolean;
}): ReactNode {
  const { preload, run } = useOperationCommands();
  const [confirming, setConfirming] = useState(false);
  const summary = useApiQuery("identity.summary");
  const catalog = useCatalogQuery(confirming);
  const route = evolutionRoute(item.template_id);
  const target = route
    ? catalog.data?.templates.find(
        (template) => template.id === route.target.template_id,
      )
    : undefined;
  const evolving = useOperationBlocked("inventory.evolve");
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
    await run(t("进化仪式进行中"), "inventory.evolve", {
      template_id: item.template_id,
      quantity,
    });
  };

  return (
    <div className="evolution-action">
      <Button
        className="inventory-action-button inventory-action-button--evolve"
        aria-label={reason ? tp("进化：{{0}}", [reason]) : t("进化")}
        disabled={reason !== null}
        title={reason ?? undefined}
        onPointerDown={() => preload("inventory.evolve")}
        onFocus={() => preload("inventory.evolve")}
        onClick={() => setConfirming(true)}
      >
        <span>{t("进化")}</span>
      </Button>
      {confirming && route ? (
        <EvolutionConfirmationDialog
          source={item}
          route={route}
          targetImageUrl={target?.image_thumbnail_url}
          availableFgems={summary.data?.assets.fgems.available}
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
  if (evolving) return t("进化仪式进行中");
  if (disabled) return t("进化仪式尚未结束");
  if (item.stage >= 3) return t("该藏品已经是最终形态，无法继续进化");
  if (!routeAvailable) return t("当前藏品暂不支持进化");
  if (!imageReady) return t("藏品形象尚未就绪");
  return null;
}
