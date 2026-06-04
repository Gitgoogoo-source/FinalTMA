import {
  AlertTriangle,
  ArrowUpRight,
  Gem,
  RefreshCw,
  Sparkles,
  Wallet,
  X,
  Zap,
} from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { useMyAssets } from "@/features/assets/hooks/useMyAssets";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CollectionInventoryItem,
  CollectionUpgradeItemInput,
  CollectionUpgradeItemResponse,
  CollectionUpgradePreview,
} from "../collection.types";
import { useUpgradeItem } from "../hooks/useUpgradeItem";
import { getLocalUpgradePreview } from "../localUpgradeRules";

type UpgradePanelProps = {
  open: boolean;
  item: CollectionInventoryItem | null;
  onClose: () => void;
  onUpgraded?: (result: CollectionUpgradeItemResponse) => void;
};

export function UpgradePanel({
  item,
  onClose,
  onUpgraded,
  open,
}: UpgradePanelProps) {
  const { pushToast } = useFeedback();
  const assetsQuery = useMyAssets({ enabled: false });
  const upgradeMutation = useUpgradeItem();

  if (!open || !item) {
    return null;
  }

  const selectedItem = item;
  const itemInstanceId = selectedItem.itemInstanceId;
  const userFgemsBalance = getCachedFgemsBalance(
    assetsQuery.data.assets.fgems.available,
    assetsQuery.data.updatedAt,
  );
  const preview = getLocalUpgradePreview(selectedItem, userFgemsBalance);
  const isListed = selectedItem.status === "listed";
  const disabledReason = getUpgradeDisabledReason({
    isListed,
    isPending: upgradeMutation.isPending,
    item: selectedItem,
    preview,
  });
  const canSubmit = disabledReason === null;
  const currentLevel = preview.currentLevel ?? selectedItem.level;
  const currentPower = preview.currentPower ?? selectedItem.power;
  const imageUrl =
    selectedItem.thumbnailUrl ??
    selectedItem.imageUrl ??
    selectedItem.avatarUrl;

  async function handleSubmit() {
    if (!canSubmit || !preview) {
      return;
    }

    try {
      const input: CollectionUpgradeItemInput = {
        itemInstanceId,
        expectedFgemsCost: preview.fgemsCost,
        targetLevel: preview.nextLevel ?? preview.targetLevel,
      };

      if (
        selectedItem.itemVersion !== undefined &&
        selectedItem.itemVersion !== null
      ) {
        input.expectedItemVersion = selectedItem.itemVersion;
      }

      const result = await upgradeMutation.mutateAsync(input);

      onUpgraded?.(result);
      onClose();
    } catch (error) {
      pushToast({
        type: "error",
        title: "升级失败",
        message: getApiErrorMessage(error),
      });
    }
  }

  function handleClose() {
    if (!upgradeMutation.isPending) {
      onClose();
    }
  }

  return (
    <div
      className="upgrade-panel growth-panel--liquid-glass"
      role="presentation"
    >
      <button
        aria-label="关闭升级面板"
        className="upgrade-panel__backdrop"
        disabled={upgradeMutation.isPending}
        onClick={handleClose}
        type="button"
      />
      <section
        aria-labelledby="upgrade-panel-title"
        aria-modal="true"
        className="upgrade-panel__panel"
        role="dialog"
      >
        <header className="upgrade-panel__header">
          <div>
            <span>藏品升级</span>
            <h2 id="upgrade-panel-title">{selectedItem.name}</h2>
          </div>
          <button
            aria-label="关闭"
            disabled={upgradeMutation.isPending}
            onClick={handleClose}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="upgrade-panel__body" aria-live="polite">
          <section className="upgrade-panel__item" aria-label="当前藏品">
            <div className="upgrade-panel__thumb">
              {imageUrl ? (
                <img src={imageUrl} alt={selectedItem.name} />
              ) : (
                <span aria-hidden="true">{selectedItem.name.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{selectedItem.name}</strong>
              <span>{selectedItem.rarity.label}</span>
            </div>
          </section>

          <section className="upgrade-panel__metrics" aria-label="升级预览">
            <UpgradeMetric
              icon="level"
              label="当前等级"
              value={`Lv.${formatCurrencyAmount(currentLevel)}`}
            />
            <UpgradeMetric
              icon="level"
              label="升级后等级"
              tone="positive"
              value={formatLevel(preview?.nextLevel ?? preview?.targetLevel)}
            />
            <UpgradeMetric
              icon="power"
              label="当前战力"
              value={formatCurrencyAmount(currentPower)}
            />
            <UpgradeMetric
              icon="power"
              label="升级后战力"
              tone="positive"
              value={formatOptionalNumber(preview?.powerAfter)}
            />
          </section>

          <section className="upgrade-panel__cost" aria-label="升级消耗">
            <UpgradeMetric
              icon="fgems"
              label="需要 Fgems"
              value={formatOptionalNumber(preview?.fgemsCost)}
            />
            <UpgradeMetric
              icon="wallet"
              label="当前 Fgems 余额"
              value={formatOptionalNumber(preview?.userFgemsBalance)}
            />
            <div
              className={`upgrade-panel__balance upgrade-panel__balance--${getBalanceTone(
                preview,
              )}`}
            >
              <strong>{getBalanceLabel(preview)}</strong>
              <span>{getBalanceDetail(preview)}</span>
            </div>
          </section>

          {disabledReason ? (
            <section className="upgrade-panel__notice" role="status">
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>{disabledReason}</span>
            </section>
          ) : null}

          {upgradeMutation.isError ? (
            <section className="upgrade-panel__notice" role="alert">
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>{getApiErrorMessage(upgradeMutation.error)}</span>
            </section>
          ) : null}
        </div>

        <footer className="upgrade-panel__footer">
          <button
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {upgradeMutation.isPending ? (
              <RefreshCw
                aria-hidden="true"
                className="upgrade-panel__spin"
                size={16}
                strokeWidth={2.5}
              />
            ) : (
              <Sparkles aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {upgradeMutation.isPending ? "升级中" : "确认升级"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function UpgradeMetric({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: "fgems" | "level" | "power" | "wallet";
  label: string;
  tone?: "neutral" | "positive";
  value: string;
}) {
  const Icon = getMetricIcon(icon);

  return (
    <div className={`upgrade-panel__metric upgrade-panel__metric--${tone}`}>
      <span>
        <Icon aria-hidden="true" size={14} strokeWidth={2.5} />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function getUpgradeDisabledReason({
  isListed,
  isPending,
  item,
  preview,
}: {
  isListed: boolean;
  isPending: boolean;
  item: CollectionInventoryItem;
  preview: CollectionUpgradePreview;
}): string | null {
  if (isPending) {
    return "升级请求正在提交。";
  }

  if (isListed) {
    return "该藏品正在挂售中，不能升级。";
  }

  if (item.status !== "available") {
    return "该藏品当前状态不可升级。";
  }

  if (!item.isUpgradeable) {
    return "该藏品不可升级。";
  }

  if (
    preview.nextLevel === null ||
    preview.fgemsCost === null ||
    preview.powerAfter === null
  ) {
    return getUpgradeReasonLabel(preview.reason) ?? "没有可用升级规则。";
  }

  if (preview.isBalanceEnough === false) {
    return "FGEMS 余额不足。";
  }

  if (!preview.canUpgrade) {
    return getUpgradeReasonLabel(preview.reason) ?? "当前不能升级。";
  }

  return null;
}

function getUpgradeReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case "INSUFFICIENT_FGEMS":
      return "FGEMS 余额不足。";
    case "ITEM_MAX_LEVEL":
      return "已达到最高等级。";
    case "UPGRADE_RULE_NOT_FOUND":
      return "没有可用升级规则。";
    case "ITEM_NOT_AVAILABLE":
      return "该藏品当前状态不可升级。";
    case "ITEM_NOT_UPGRADEABLE":
      return "该藏品不可升级。";
    default:
      return reason;
  }
}

function getBalanceTone(
  preview: CollectionUpgradePreview | null,
): "neutral" | "ready" | "blocked" {
  if (!preview || preview.isBalanceEnough === null) {
    return "neutral";
  }

  return preview.isBalanceEnough ? "ready" : "blocked";
}

function getBalanceLabel(preview: CollectionUpgradePreview | null): string {
  if (!preview || preview.isBalanceEnough === null) {
    return "余额待同步";
  }

  return preview.isBalanceEnough ? "余额足够" : "余额不足";
}

function getBalanceDetail(preview: CollectionUpgradePreview | null): string {
  if (!preview) {
    return "等待服务端返回。";
  }

  if (preview.userFgemsBalance === null || preview.fgemsCost === null) {
    return "余额或消耗未返回。";
  }

  const gap = preview.userFgemsBalance - preview.fgemsCost;

  if (gap >= 0) {
    return `升级后预计剩余 ${formatCurrencyAmount(gap)} Fgems。`;
  }

  return `还差 ${formatCurrencyAmount(Math.abs(gap))} Fgems。`;
}

function getCachedFgemsBalance(
  value: string | number | null | undefined,
  updatedAt: string | null,
): number | null {
  if (updatedAt === null) {
    return null;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function formatLevel(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "待同步"
    : `Lv.${formatCurrencyAmount(value)}`;
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "待同步"
    : formatCurrencyAmount(value);
}

function getMetricIcon(icon: "fgems" | "level" | "power" | "wallet") {
  switch (icon) {
    case "fgems":
      return Gem;
    case "level":
      return ArrowUpRight;
    case "power":
      return Zap;
    case "wallet":
      return Wallet;
  }
}
