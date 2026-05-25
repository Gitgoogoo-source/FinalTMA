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
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CollectionInventoryDetail,
  CollectionInventoryItem,
  CollectionUpgradeItemResponse,
  CollectionUpgradePreview,
} from "../collection.types";
import { useItemDetail } from "../hooks/useItemDetail";
import { useUpgradeItem } from "../hooks/useUpgradeItem";

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
  const detailQuery = useItemDetail(open ? item?.itemInstanceId : null, {
    enabled: open && Boolean(item),
  });
  const upgradeMutation = useUpgradeItem();

  if (!open || !item) {
    return null;
  }

  const detail = detailQuery.item;
  const displayItem = detail ?? item;
  const itemInstanceId = item.itemInstanceId;
  const preview = detail?.upgradePreview ?? null;
  const isListed = detail?.marketStatus?.isListed ?? item.status === "listed";
  const disabledReason = getUpgradeDisabledReason({
    detail,
    isDetailLoading: detailQuery.isLoading,
    isListed,
    isPending: upgradeMutation.isPending,
    item: displayItem,
    preview,
  });
  const canSubmit = disabledReason === null;
  const currentLevel = preview?.currentLevel ?? displayItem.level;
  const currentPower = preview?.currentPower ?? displayItem.power;
  const imageUrl =
    displayItem.thumbnailUrl ?? displayItem.imageUrl ?? displayItem.avatarUrl;

  async function handleSubmit() {
    if (!canSubmit || !preview) {
      return;
    }

    try {
      const result = await upgradeMutation.mutateAsync({
        itemInstanceId,
        expectedFgemsCost: preview.fgemsCost,
        targetLevel: preview.nextLevel ?? preview.targetLevel,
      });

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
    <div className="upgrade-panel" role="presentation">
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
            <h2 id="upgrade-panel-title">{displayItem.name}</h2>
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
                <img src={imageUrl} alt={displayItem.name} />
              ) : (
                <span aria-hidden="true">{displayItem.name.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{displayItem.name}</strong>
              <span>{displayItem.rarity.label}</span>
            </div>
          </section>

          {detailQuery.isLoading ? (
            <PanelState title="同步升级预览" detail="正在读取服务端规则。" />
          ) : null}

          {detailQuery.isError ? (
            <PanelState
              tone="error"
              title="预览读取失败"
              detail={getApiErrorMessage(detailQuery.error)}
              onRetry={() => void detailQuery.refetch()}
            />
          ) : null}

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

function PanelState({
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
      className={`upgrade-panel__state upgrade-panel__state--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {tone === "error" ? (
        <AlertTriangle aria-hidden="true" size={17} strokeWidth={2.4} />
      ) : (
        <RefreshCw
          aria-hidden="true"
          className="upgrade-panel__spin"
          size={17}
          strokeWidth={2.4}
        />
      )}
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

function getUpgradeDisabledReason({
  detail,
  isDetailLoading,
  isListed,
  isPending,
  item,
  preview,
}: {
  detail: CollectionInventoryDetail | null;
  isDetailLoading: boolean;
  isListed: boolean;
  isPending: boolean;
  item: CollectionInventoryItem;
  preview: CollectionUpgradePreview | null;
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

  if (isDetailLoading) {
    return "正在同步升级预览。";
  }

  if (!detail || !preview) {
    return "升级预览暂不可用。";
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
