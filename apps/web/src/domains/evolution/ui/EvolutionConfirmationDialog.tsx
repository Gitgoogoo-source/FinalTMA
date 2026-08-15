import {
  ArrowRight,
  Gem,
  PackageOpen,
  Plus,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import { InventoryActionDialogHeader } from "../../../shared/ui/InventoryActionDialogHeader.tsx";
import { QuantityControl } from "../../../shared/ui/QuantityControl.tsx";
import type { EvolutionRarity, EvolutionRoute } from "../config.ts";
import { localized, t, tp } from "../../../platform/i18n/index.ts";

type EvolutionSource = {
  template_id: string;
  name: string;
  rarity: EvolutionRarity;
  stage: number;
  available: number;
  image_thumbnail_url: string;
};

const rarityLabels: Record<EvolutionRarity, string> = localized({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
});

export function EvolutionConfirmationDialog({
  source,
  route,
  targetImageUrl,
  availableFgems,
  onCancel,
  onConfirm,
}: {
  source: EvolutionSource;
  route: EvolutionRoute;
  targetImageUrl: string | undefined;
  availableFgems: number | undefined;
  onCancel(): void;
  onConfirm(quantity: number): void;
}): ReactNode {
  const materialAttempts = Math.floor(source.available / 3);
  const affordableAttempts =
    availableFgems === undefined
      ? 0
      : Math.floor(availableFgems / route.fgems_cost);
  const maxAttempts = Math.min(materialAttempts, affordableAttempts);
  const maxQuantity = maxAttempts * 3;
  const [requestedQuantity, setRequestedQuantity] = useState(3);

  const quantity =
    maxQuantity < 3
      ? 3
      : requestedQuantity > maxQuantity
        ? maxQuantity
        : requestedQuantity;
  const attempts =
    Number.isInteger(quantity) && quantity >= 3 && quantity % 3 === 0
      ? quantity / 3
      : 0;
  const totalCost = attempts * route.fgems_cost;
  const valid =
    attempts >= 1 &&
    quantity <= source.available &&
    availableFgems !== undefined &&
    totalCost <= availableFgems;
  const unavailableReason = startUnavailableReason({
    available: source.available,
    availableFgems,
    cost: route.fgems_cost,
    valid,
  });

  return (
    <AppModal
      className="inventory-action-dialog-backdrop evolution-confirmation-backdrop"
      labelledBy="evolution-confirmation-title"
      onClose={onCancel}
    >
      <div className="modal inventory-action-dialog evolution-confirmation-modal">
        <InventoryActionDialogHeader
          titleId="evolution-confirmation-title"
          title={t("藏品进化")}
          subtitle={t("每 3 个相同藏品进化 1 次")}
        />

        <div className="evolution-confirmation-content">
          <EvolutionFusionPreview
            source={source}
            route={route}
            targetImageUrl={targetImageUrl}
          />

          <section
            className="evolution-rule-summary"
            aria-label={t("进化规则")}
          >
            <div className="evolution-rarity-change">
              <span>{rarityLabels[source.rarity]}</span>
              <ArrowRight aria-hidden="true" />
              <strong>{rarityLabels[route.target.rarity]}</strong>
            </div>
            <div>
              <ShieldCheck aria-hidden="true" />
              <span>{t("基础成功率")}</span>
              <strong>{route.success_rate_percent}%</strong>
            </div>
            <div>
              <Gem aria-hidden="true" />
              <span>{t("预计消耗")}</span>
              <strong>{totalCost} Fgems</strong>
            </div>
          </section>

          <div className="evolution-quantity-heading">
            <div>
              <strong>{t("批量进化")}</strong>
              <span>
                {tp("当前可用 ×{{0}} · 每次使用 3 个", [source.available])}
              </span>
            </div>
            <strong>{tp("{{0}} 次", [attempts])}</strong>
          </div>
          <QuantityControl
            label={t("进化材料数量")}
            value={quantity}
            min={3}
            max={Math.max(3, maxQuantity)}
            step={3}
            disabled={maxQuantity < 3}
            onChange={setRequestedQuantity}
          />

          <div className="evolution-risk-copy">
            <TriangleAlert aria-hidden="true" />
            <p>
              <span>
                {t(
                  "基础成功率不包含当前路线保底；提交后由系统按真实保底、材料和 Fgems 状态裁决。",
                )}
              </span>
              <span>
                {t(
                  "每次失败扣除 2 个材料并保留 1 个，整批变化全部写入或全部不写入。",
                )}
              </span>
            </p>
          </div>
          {unavailableReason ? (
            <p
              id="evolution-start-unavailable"
              className="evolution-start-unavailable"
              role="status"
            >
              {unavailableReason}
            </p>
          ) : null}
        </div>

        <footer className="evolution-confirmation-actions inventory-action-dialog-actions">
          <Button className="secondary" onClick={onCancel}>
            {t("取消")}
          </Button>
          <Button
            disabled={!valid}
            aria-describedby={
              unavailableReason ? "evolution-start-unavailable" : undefined
            }
            onClick={() => onConfirm(quantity)}
          >
            {t("开始进化")}
          </Button>
        </footer>
      </div>
    </AppModal>
  );
}

function EvolutionFusionPreview({
  source,
  route,
  targetImageUrl,
}: {
  source: EvolutionSource;
  route: EvolutionRoute;
  targetImageUrl: string | undefined;
}): ReactNode {
  return (
    <section
      className="evolution-fusion-preview"
      aria-label={tp("使用 3 个{{0}}进化为{{1}}", [
        t(source.name),
        t(route.target.name),
      ])}
    >
      <MaterialSlot source={source} index={0} className="material-one" />
      <Plus className="evolution-connector connector-one" aria-hidden="true" />
      <MaterialSlot source={source} index={1} className="material-two" />
      <Plus className="evolution-connector connector-two" aria-hidden="true" />
      <MaterialSlot source={source} index={2} className="material-three" />
      <ArrowRight
        className="evolution-connector connector-result"
        aria-hidden="true"
      />
      <article className="evolution-target-card">
        <CatalogImage
          url={targetImageUrl}
          alt={t(route.target.name)}
          variant="thumbnail"
          loading="eager"
        />
        <small>{t("目标藏品预览")}</small>
        <strong>{t(route.target.name)}</strong>
        <span>
          {tp("{{0}} · 第 {{1}} 阶", [
            rarityLabels[route.target.rarity],
            route.target.stage,
          ])}
        </span>
      </article>
    </section>
  );
}

function MaterialSlot({
  source,
  index,
  className,
}: {
  source: EvolutionSource;
  index: number;
  className: string;
}): ReactNode {
  const filled = source.available > index;
  return (
    <figure
      className={`evolution-material-slot ${className} ${filled ? "filled" : "empty"}`}
      aria-label={tp("材料藏品 {{0}}：{{1}}", [
        index + 1,
        filled ? t(source.name) : t("空缺"),
      ])}
    >
      {filled ? (
        <CatalogImage
          url={source.image_thumbnail_url}
          alt=""
          variant="thumbnail"
          loading="eager"
        />
      ) : (
        <span className="evolution-empty-material" aria-hidden="true">
          <PackageOpen />
        </span>
      )}
      <figcaption>{tp("材料藏品 {{0}}", [index + 1])}</figcaption>
    </figure>
  );
}

function startUnavailableReason({
  available,
  availableFgems,
  cost,
  valid,
}: {
  available: number;
  availableFgems: number | undefined;
  cost: number;
  valid: boolean;
}): string | null {
  if (available < 3)
    return tp("还缺 {{0}} 个相同藏品，集齐 3 个后即可开始", [3 - available]);
  if (availableFgems === undefined) return t("暂时无法开始进化");
  if (availableFgems < cost)
    return tp("Fgems 不足，本次至少需要 {{0}} Fgems", [cost]);
  if (!valid) return t("材料数量必须是 3 的正整数倍");
  return null;
}
