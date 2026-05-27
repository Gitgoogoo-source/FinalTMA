import {
  AlertTriangle,
  ChevronRight,
  PackageMinus,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Swords,
  Tag,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";

import { getApiErrorMessage } from "@/api/errors";
import { APP_ROUTES } from "@/shared/constants/routes";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CollectionInventoryDetail,
  CollectionInventoryItem,
} from "../collection.types";
import { useItemDetail } from "../hooks/useItemDetail";

import {
  getCollectionLockReasonLabel,
  getCollectionStatusLabel,
  getMintStatusLabel,
  ItemStatusBadge,
} from "./ItemStatusBadge";

type CharacterDetailSheetProps = {
  open: boolean;
  item: CollectionInventoryItem;
  onClose: () => void;
  onDecompose?: () => void;
  onEvolve?: () => void;
  onUpgrade?: () => void;
};

type DetailActionTone = "primary" | "secondary" | "danger";

export function CharacterDetailSheet({
  item,
  onDecompose,
  onClose,
  onEvolve,
  onUpgrade,
  open,
}: CharacterDetailSheetProps) {
  const detailQuery = useItemDetail(open ? item.itemInstanceId : null, {
    enabled: open,
  });
  const detail = detailQuery.item;
  const displayItem = detail ?? item;
  const imageUrl =
    displayItem.imageUrl ?? displayItem.thumbnailUrl ?? displayItem.avatarUrl;
  const isListed = isItemListed(displayItem, detail);
  const isAvailable = displayItem.status === "available" && !isListed;
  const canOpenUpgradePanel = canOpenUpgrade(displayItem, detail, isAvailable);
  const lockReason = detail?.activeLock?.reason ?? null;
  const mintStatusLabel = getMintStatusLabel(
    detail?.onchainStatus?.mintStatus ?? displayItem.nftMintStatus,
  );
  const blockReason = getBlockedReason(displayItem, detail, isListed);

  if (!open) {
    return null;
  }

  return (
    <div className="character-detail-sheet" role="presentation">
      <button
        aria-label="关闭藏品详情"
        className="character-detail-sheet__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="character-detail-title"
        aria-modal="true"
        className="character-detail-sheet__panel"
        role="dialog"
      >
        <header className="character-detail-sheet__header">
          <div>
            <span>藏品详情</span>
            <h2 id="character-detail-title">{displayItem.name}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="character-detail-sheet__body" aria-live="polite">
          <div className="character-detail-sheet__hero">
            {imageUrl ? (
              <img src={imageUrl} alt={displayItem.name} />
            ) : (
              <span aria-hidden="true">{displayItem.name.slice(0, 1)}</span>
            )}
            <strong className="character-detail-sheet__rarity">
              {displayItem.rarity.label}
            </strong>
          </div>

          {detailQuery.isLoading ? (
            <DetailState title="详情同步中" detail="正在读取服务端详情。" />
          ) : null}

          {detailQuery.isError ? (
            <DetailState
              tone="error"
              title="详情读取失败"
              detail={getApiErrorMessage(detailQuery.error)}
              onRetry={() => void detailQuery.refetch()}
            />
          ) : null}

          <section
            className="character-detail-sheet__summary"
            aria-label="藏品完整信息"
          >
            <DetailMetric label="名称" value={displayItem.name} />
            <DetailMetric label="稀有度" value={displayItem.rarity.label} />
            <DetailMetric
              label="系列"
              value={displayItem.series?.displayName ?? "未分配"}
            />
            <DetailMetric
              label="形态"
              value={displayItem.form?.displayName ?? "未分配"}
            />
            <DetailMetric
              label="等级"
              value={`Lv.${formatCurrencyAmount(displayItem.level)}`}
            />
            <DetailMetric
              label="战力"
              value={formatCurrencyAmount(displayItem.power)}
            />
            <DetailMetric
              label="编号"
              value={
                displayItem.serialNo
                  ? `#${formatCurrencyAmount(displayItem.serialNo)}`
                  : "未编号"
              }
            />
            <DetailMetric
              label="状态"
              value={getCollectionStatusLabel(displayItem.status, isListed)}
            />
            <DetailMetric label="是否挂售" value={isListed ? "是" : "否"} />
            <DetailMetric
              label="是否可升级"
              value={getBooleanLabel(
                canUpgrade(displayItem, detail, isAvailable),
              )}
            />
            <DetailMetric
              label="是否可合成"
              value={getBooleanLabel(
                canEvolve(displayItem, detail, isAvailable),
              )}
            />
            <DetailMetric
              label="是否可分解"
              value={getBooleanLabel(
                canDecompose(displayItem, detail, isAvailable),
              )}
            />
            <DetailMetric
              label="是否可 Mint"
              value={getBooleanLabel(isAvailable && displayItem.isMintable)}
            />
            <DetailMetric label="Mint 状态" value={mintStatusLabel} />
          </section>

          {displayItem.description ? (
            <p className="character-detail-sheet__description">
              {displayItem.description}
            </p>
          ) : null}

          {blockReason ? (
            <section
              className="character-detail-sheet__notice"
              aria-label="状态限制"
            >
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>{blockReason}</span>
            </section>
          ) : null}

          <section
            className="character-detail-sheet__actions"
            aria-label="藏品操作"
          >
            {isListed ? (
              <DetailLinkAction
                icon="tag"
                label="下架"
                to={`${APP_ROUTES.trade}?tab=manage`}
              />
            ) : null}

            {isAvailable ? (
              <>
                <DetailButtonAction
                  disabled={!canOpenUpgradePanel || !onUpgrade}
                  icon="sparkles"
                  label="升级"
                  onClick={onUpgrade}
                  tone="primary"
                />
                <DetailButtonAction
                  disabled={
                    !canEvolve(displayItem, detail, isAvailable) || !onEvolve
                  }
                  icon="swords"
                  label="合成"
                  onClick={onEvolve}
                />
                <DetailLinkAction
                  disabled={!displayItem.isTradeable}
                  icon="shopping"
                  label="出售"
                  to={`${APP_ROUTES.trade}?tab=sell`}
                />
                <DetailButtonAction
                  disabled={
                    !canDecompose(displayItem, detail, isAvailable) ||
                    !onDecompose
                  }
                  icon="decompose"
                  label="分解"
                  onClick={onDecompose}
                  tone="danger"
                />
              </>
            ) : null}
          </section>

          <div className="character-detail-sheet__footer">
            <ItemStatusBadge
              status={displayItem.status}
              isListed={isListed}
              lockReason={lockReason}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailButtonAction({
  disabled,
  icon,
  label,
  onClick,
  tone = "secondary",
}: {
  disabled: boolean;
  icon: "decompose" | "sparkles" | "swords";
  label: string;
  onClick: (() => void) | undefined;
  tone?: DetailActionTone;
}) {
  const Icon = getActionIcon(icon);

  return (
    <button
      className={`character-detail-sheet__action character-detail-sheet__action--${tone}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={15} strokeWidth={2.5} />
      {label}
      <ChevronRight aria-hidden="true" size={14} strokeWidth={2.5} />
    </button>
  );
}

function DetailLinkAction({
  disabled = false,
  icon,
  label,
  to,
}: {
  disabled?: boolean;
  icon: "shopping" | "tag";
  label: string;
  to: string;
}) {
  const Icon = getActionIcon(icon);

  if (disabled) {
    return (
      <button
        className="character-detail-sheet__action character-detail-sheet__action--secondary"
        disabled
        type="button"
      >
        <Icon aria-hidden="true" size={15} strokeWidth={2.5} />
        {label}
        <ChevronRight aria-hidden="true" size={14} strokeWidth={2.5} />
      </button>
    );
  }

  return (
    <Link
      className="character-detail-sheet__action character-detail-sheet__action--secondary"
      to={to}
    >
      <Icon aria-hidden="true" size={15} strokeWidth={2.5} />
      {label}
      <ChevronRight aria-hidden="true" size={14} strokeWidth={2.5} />
    </Link>
  );
}

function DetailState({
  detail,
  onRetry,
  title,
  tone = "neutral",
}: {
  detail: string;
  onRetry?: () => void;
  title: string;
  tone?: "error" | "neutral";
}) {
  return (
    <div
      className={`character-detail-state character-detail-state--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {tone === "error" ? (
        <AlertTriangle aria-hidden="true" size={17} strokeWidth={2.4} />
      ) : null}
      <strong>{title}</strong>
      <span>{detail}</span>
      {onRetry ? (
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
          重试
        </button>
      ) : null}
    </div>
  );
}

function isItemListed(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail | null,
): boolean {
  return detail?.marketStatus?.isListed ?? item.status === "listed";
}

function canUpgrade(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail | null,
  isAvailable: boolean,
): boolean {
  return (
    isAvailable && (detail?.upgradePreview?.canUpgrade ?? item.isUpgradeable)
  );
}

function canOpenUpgrade(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail | null,
  isAvailable: boolean,
): boolean {
  return (
    isAvailable &&
    (detail?.isUpgradeable ?? item.isUpgradeable) &&
    item.status === "available"
  );
}

function canEvolve(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail | null,
  isAvailable: boolean,
): boolean {
  return (
    isAvailable && (detail?.evolutionPreview?.canEvolve ?? item.isEvolvable)
  );
}

function canDecompose(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail | null,
  isAvailable: boolean,
): boolean {
  return (
    isAvailable &&
    (detail?.decomposePreview?.canDecompose ?? item.isDecomposable)
  );
}

function getBlockedReason(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail | null,
  isListed: boolean,
): string | null {
  if (isListed) {
    return "该藏品正在挂售中，不能升级、合成、分解或 Mint。";
  }

  if (detail?.activeLock?.reason) {
    return `该藏品因${getCollectionLockReasonLabel(detail.activeLock.reason)}被锁定。`;
  }

  if (item.status === "locked" || item.status === "minting") {
    return `该藏品当前处于${getCollectionStatusLabel(item.status)}状态。`;
  }

  if (item.status && item.status !== "available") {
    return `该藏品当前状态为${getCollectionStatusLabel(item.status)}。`;
  }

  return null;
}

function getBooleanLabel(value: boolean): string {
  return value ? "是" : "否";
}

function getActionIcon(
  icon: "decompose" | "shopping" | "sparkles" | "swords" | "tag",
) {
  switch (icon) {
    case "decompose":
      return PackageMinus;
    case "shopping":
      return ShoppingBag;
    case "sparkles":
      return Sparkles;
    case "swords":
      return Swords;
    case "tag":
      return Tag;
  }
}
