import { ArrowRight, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { Badge, Button, CatalogImage } from "../../../shared/ui/index.tsx";

type Preview = RouteOutput<"inventory.evolution_preview">;
type Rarity = Preview["source"]["rarity"];

const rarityLabels: Record<Rarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

export function EvolutionConfirmationDialog({
  preview,
  onCancel,
  onConfirm,
}: {
  preview: Preview;
  onCancel(): void;
  onConfirm(): void;
}): ReactNode {
  const { target, pity, success_rate_percent: successRate } = preview;
  if (!preview.eligibility.eligible || !target || !pity || !successRate)
    return null;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evolution-confirmation-title"
    >
      <div className="modal evolution-confirmation-modal">
        <header>
          <ShieldCheck aria-hidden="true" />
          <div>
            <small>进化结果不可撤销</small>
            <h2 id="evolution-confirmation-title">确认进化该藏品？</h2>
          </div>
        </header>
        <div className="evolution-route-preview">
          <EvolutionTemplateCard
            template={preview.source}
            label="材料藏品 ×3"
          />
          <ArrowRight aria-hidden="true" />
          <EvolutionTemplateCard template={target} label="成功获得 ×1" />
        </div>
        <dl className="result-summary">
          <div>
            <dt>当前可用数量</dt>
            <dd>{preview.materials.available}</dd>
          </div>
          <div>
            <dt>基础成功率</dt>
            <dd>{successRate}%</dd>
          </div>
          <div>
            <dt>本次消耗</dt>
            <dd>{preview.fgems.cost} Fgems</dd>
          </div>
          <div>
            <dt>当前 Fgems</dt>
            <dd>{preview.fgems.available}</dd>
          </div>
          <div>
            <dt>失败损耗</dt>
            <dd>扣材料 ×2 与 Fgems，保留材料 ×1</dd>
          </div>
          <div>
            <dt>路线保底</dt>
            <dd>
              已连续失败 {pity.failure_count} 次 · 第 {pity.guarantee_attempt}{" "}
              次必成
            </dd>
          </div>
          <div>
            <dt>距离必成</dt>
            <dd>{pityDistanceLabel(pity)}</dd>
          </div>
        </dl>
        {pity.guaranteed_this_attempt ? (
          <Badge>本次进化已触发保底，必定成功</Badge>
        ) : null}
        <p className="evolution-risk-copy">
          成功扣除 3 个材料；失败扣除 2 个材料并保留 1 个。两种结果都会扣除本次
          Fgems。
        </p>
        <div className="button-row">
          <Button className="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={onConfirm}>确认进化</Button>
        </div>
      </div>
    </div>
  );
}

function EvolutionTemplateCard({
  template,
  label,
}: {
  template: Preview["source"];
  label: string;
}): ReactNode {
  return (
    <article>
      <CatalogImage
        path={template.image_thumbnail_path}
        alt={template.name}
        variant="thumbnail"
        loading="eager"
      />
      <strong>{template.name}</strong>
      <span>
        {rarityLabels[template.rarity]} · 第 {template.stage} 阶
      </span>
      <small>{label}</small>
    </article>
  );
}

function pityDistanceLabel(pity: NonNullable<Preview["pity"]>): string {
  if (pity.guaranteed_this_attempt) return "本次必定成功";
  if (pity.failures_until_guaranteed === 0) return "下次进化必定成功";
  return `再失败 ${pity.failures_until_guaranteed} 次后，下次进化必定成功`;
}
