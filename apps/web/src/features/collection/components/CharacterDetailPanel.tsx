import {
  AlertTriangle,
  ChevronRight,
  PackageMinus,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Swords,
  Tag,
} from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";
import { useWalletStatus } from "@/features/wallet/hooks/useWalletStatus";
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
import { MintButton } from "./MintButton";

type CharacterDetailPanelProps = {
  item: CollectionInventoryItem;
  isMinting?: boolean;
  onCancelSell?: (target: {
    itemInstanceId: string;
    listingId: string | null;
    unitPriceKcoin: number | null;
  }) => void;
  onDecompose?: () => void;
  onEvolve?: () => void;
  onMint?: (itemInstanceId: string) => void;
  onSell?: () => void;
  onUpgrade?: () => void;
};

type DetailActionTone = "primary" | "secondary" | "danger";

export function CharacterDetailPanel({
  isMinting = false,
  item,
  onCancelSell,
  onDecompose,
  onEvolve,
  onMint,
  onSell,
  onUpgrade,
}: CharacterDetailPanelProps) {
  const detailQuery = useItemDetail(item.itemInstanceId);
  const walletStatusQuery = useWalletStatus();
  const detail = detailQuery.item;
  const displayItem = detail ?? item;
  const imageUrl =
    displayItem.imageUrl ?? displayItem.thumbnailUrl ?? displayItem.avatarUrl;
  const isListed = isItemListed(displayItem, detail);
  const isAvailable = displayItem.status === "available" && !isListed;
  const canOpenUpgradePanel = canOpenUpgrade(displayItem, detail, isAvailable);
  const lockReason = detail?.activeLock?.reason ?? null;
  const effectiveMintStatus = getEffectiveMintStatus(displayItem, detail);
  const mintStatusLabel = getMintStatusLabel(effectiveMintStatus);
  const blockReason = getBlockedReason(displayItem, detail, isListed);
  const mintEligibility = getMintEligibility(displayItem, detail, {
    isListed,
    walletVerified: walletStatusQuery.data?.status === "verified",
  });

  return (
    <section
      aria-label="当前选中藏品"
      aria-live="polite"
      className={`character-detail-panel character-detail-panel--${displayItem.rarity.code}`}
    >
      <header className="character-detail-panel__header">
        <div className="character-detail-panel__copy">
          <span className="character-detail-panel__kicker">
            <Sparkles aria-hidden="true" size={15} strokeWidth={2.4} />
            {displayItem.rarity.label}
          </span>
          <h1>{displayItem.name}</h1>
          <p>{buildDescription(displayItem)}</p>
        </div>
        <ItemStatusBadge
          status={displayItem.status}
          isListed={isListed}
          lockReason={lockReason}
        />
      </header>

      <div className="character-detail-panel__media">
        <span className="character-detail-panel__shadow" aria-hidden="true" />
        {imageUrl ? (
          <img src={imageUrl} alt={displayItem.name} />
        ) : (
          <span className="character-detail-panel__fallback" aria-hidden="true">
            {displayItem.name.slice(0, 1)}
          </span>
        )}
      </div>

      {detailQuery.isLoading || detailQuery.isFetching ? (
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

      <section className="character-detail-summary" aria-label="藏品完整信息">
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
          value={getBooleanLabel(canUpgrade(displayItem, detail, isAvailable))}
        />
        <DetailMetric
          label="是否可合成"
          value={getBooleanLabel(canEvolve(displayItem, detail, isAvailable))}
        />
        <DetailMetric
          label="是否可分解"
          value={getBooleanLabel(
            canDecompose(displayItem, detail, isAvailable),
          )}
        />
        <DetailMetric
          label="是否可 Mint"
          value={getBooleanLabel(mintEligibility.canShowEntry)}
        />
        <DetailMetric label="Mint 状态" value={mintStatusLabel} />
      </section>

      {displayItem.description ? (
        <p className="character-detail-description">
          {displayItem.description}
        </p>
      ) : null}

      {blockReason ? (
        <section className="character-detail-notice" aria-label="状态限制">
          <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.4} />
          <span>{blockReason}</span>
        </section>
      ) : null}

      <section className="character-detail-actions" aria-label="藏品操作">
        {isListed ? (
          <DetailButtonAction
            disabled={!onCancelSell}
            icon="tag"
            label="下架"
            onClick={() =>
              onCancelSell?.({
                itemInstanceId: displayItem.itemInstanceId,
                listingId: detail?.marketStatus?.listingId ?? null,
                unitPriceKcoin: detail?.marketStatus?.unitPrice ?? null,
              })
            }
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
            <DetailButtonAction
              disabled={!displayItem.isTradeable || !onSell}
              icon="shopping"
              label="出售"
              onClick={onSell}
            />
            <DetailButtonAction
              disabled={
                !canDecompose(displayItem, detail, isAvailable) || !onDecompose
              }
              icon="decompose"
              label="分解"
              onClick={onDecompose}
              tone="danger"
            />
            {mintEligibility.canShowEntry ? (
              <MintButton
                disabled={!onMint}
                label={mintEligibility.actionLabel}
                loading={isMinting}
                onClick={() => onMint?.(displayItem.itemInstanceId)}
              />
            ) : null}
          </>
        ) : null}
      </section>
    </section>
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
  icon: "decompose" | "shopping" | "sparkles" | "swords" | "tag";
  label: string;
  onClick: (() => void) | undefined;
  tone?: DetailActionTone;
}) {
  const Icon = getActionIcon(icon);

  return (
    <button
      className={`character-detail-action character-detail-action--${tone}`}
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

function getMintEligibility(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail | null,
  options: {
    isListed: boolean;
    walletVerified: boolean;
  },
): { actionLabel: string; canShowEntry: boolean } {
  const mintStatus = normalizeMintStatus(getEffectiveMintStatus(item, detail));

  const isMintable = detail?.isMintable ?? item.isMintable;

  if (!detail || !options.walletVerified || !isMintable) {
    return {
      actionLabel: "Mint NFT",
      canShowEntry: false,
    };
  }

  if (options.isListed || detail.activeLock || detail.status !== "available") {
    return {
      actionLabel: "Mint NFT",
      canShowEntry: false,
    };
  }

  if (mintStatus !== "not_minted" && mintStatus !== "failed") {
    return {
      actionLabel: "Mint NFT",
      canShowEntry: false,
    };
  }

  return {
    actionLabel: mintStatus === "failed" ? "重试 Mint" : "Mint NFT",
    canShowEntry: true,
  };
}

function getEffectiveMintStatus(
  item: CollectionInventoryItem,
  detail: CollectionInventoryDetail | null,
): string | null {
  const onchainStatus = normalizeMintStatus(detail?.onchainStatus?.mintStatus);

  if (onchainStatus && onchainStatus !== "none") {
    return onchainStatus;
  }

  return detail?.nftMintStatus ?? item.nftMintStatus;
}

function normalizeMintStatus(status: string | null | undefined): string {
  return String(status ?? "")
    .trim()
    .toLowerCase();
}

function buildDescription(item: CollectionInventoryItem): string {
  if (item.description) {
    return item.description;
  }

  const meta = [
    item.series?.displayName,
    item.form?.displayName,
    item.subtitle,
  ].filter(isString);

  if (meta.length > 0) {
    return meta.join(" · ");
  }

  return "已进入你的库存，可在后续阶段用于成长、交易和链上 Mint。";
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
