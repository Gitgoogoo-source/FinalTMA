import { Dna } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { EvolutionConfirmationDialog } from "./EvolutionConfirmationDialog.tsx";

type Preview = RouteOutput<"inventory.evolution_preview">;

const reasonLabels: Record<
  NonNullable<Preview["eligibility"]["reason"]>,
  string
> = {
  final_stage: "该藏品已经是最终形态，无法继续进化",
  target_unavailable: "当前藏品暂不支持进化",
  insufficient_materials: "可用藏品数量不足，需要 3 个相同藏品",
  insufficient_fgems: "Fgems 不足，无法进化",
};

export function EvolutionAction({
  item,
  imageReady,
  disabled,
}: {
  item: {
    template_id: string;
    available: number;
    stage: number;
  };
  imageReady: boolean;
  disabled: boolean;
}): ReactNode {
  const { isBlocked, run } = useOperationRegistry();
  const [confirming, setConfirming] = useState(false);
  const preview = useApiQuery(
    "inventory.evolution_preview",
    { template_id: item.template_id },
    item.stage < 3,
  );
  const evolving = isBlocked("inventory.evolve");
  const reason = evolutionDisabledReason({
    item,
    imageReady,
    disabled,
    evolving,
    preview: preview.data,
    loading: preview.isLoading,
    failed: preview.isError,
  });
  const readyPreview = reason === null ? preview.data : undefined;

  const confirm = async () => {
    if (!readyPreview) return;
    setConfirming(false);
    await run("正在确认进化结果", "inventory.evolve", {
      template_id: readyPreview.source.template_id,
    });
  };

  return (
    <div className="evolution-action">
      <Button disabled={reason !== null} onClick={() => setConfirming(true)}>
        <Dna />
        进化
      </Button>
      {reason ? <small>{reason}</small> : null}
      {preview.isError ? (
        <button
          className="evolution-retry"
          onClick={() => void preview.refetch()}
        >
          重新加载
        </button>
      ) : null}
      {confirming && readyPreview ? (
        <EvolutionConfirmationDialog
          preview={readyPreview}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void confirm()}
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
  preview,
  loading,
  failed,
}: {
  item: { available: number; stage: number };
  imageReady: boolean;
  disabled: boolean;
  evolving: boolean;
  preview: Preview | undefined;
  loading: boolean;
  failed: boolean;
}): string | null {
  if (evolving) return "正在确认进化结果";
  if (disabled) return "正在处理，请勿重复点击";
  if (item.stage >= 3) return reasonLabels.final_stage;
  if (!preview && item.available < 3)
    return reasonLabels.insufficient_materials;
  if (!imageReady || loading) return "正在加载进化规则";
  if (failed || !preview) return "进化规则加载失败，请重新加载";
  return preview.eligibility.reason
    ? reasonLabels[preview.eligibility.reason]
    : null;
}
