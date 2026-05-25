import {
  AlertTriangle,
  CheckCircle2,
  Gem,
  PackageMinus,
  RefreshCw,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CollectionDecomposeItemResponse,
  CollectionDecomposePreview,
  CollectionInventoryDetail,
  CollectionInventoryItem,
} from "../collection.types";
import { useDecomposeItem } from "../hooks/useDecomposeItem";
import { useItemDetail } from "../hooks/useItemDetail";

type DecomposePanelProps = {
  open: boolean;
  item: CollectionInventoryItem | null;
  items: CollectionInventoryItem[];
  onClose: () => void;
  onDecomposed?: (result: CollectionDecomposeItemResponse) => void;
};

export function DecomposePanel({
  item,
  items,
  onClose,
  onDecomposed,
  open,
}: DecomposePanelProps) {
  const { pushToast } = useFeedback();
  const [confirmed, setConfirmed] = useState(false);
  const detailQuery = useItemDetail(open ? item?.itemInstanceId : null, {
    enabled: open && Boolean(item),
  });
  const decomposeMutation = useDecomposeItem();

  useEffect(() => {
    if (!open) {
      setConfirmed(false);
      return;
    }

    setConfirmed(false);
  }, [item?.itemInstanceId, open]);

  const sameAvailableItems = useMemo(
    () => getSameAvailableItems(item, items),
    [item, items],
  );

  if (!open || !item) {
    return null;
  }

  const detail = detailQuery.item;
  const displayItem = detail ?? item;
  const preview = detail?.decomposePreview ?? null;
  const itemInstanceId = item.itemInstanceId;
  const imageUrl =
    displayItem.thumbnailUrl ?? displayItem.imageUrl ?? displayItem.avatarUrl;
  const isListed = detail?.marketStatus?.isListed ?? item.status === "listed";
  const availableSameCount = getAvailableSameCount(
    detail,
    preview,
    sameAvailableItems.length,
  );
  const sameItemCount = getSameItemCount(detail, preview, availableSameCount);
  const decomposableCount = Math.max(availableSameCount - 1, 0);
  const expectedFgemsReward =
    preview?.fgemsReward ?? preview?.totalRewardFgems ?? null;
  const disabledReason = getDecomposeDisabledReason({
    availableSameCount,
    confirmed,
    detail,
    isDetailLoading: detailQuery.isLoading,
    isListed,
    isPending: decomposeMutation.isPending,
    item: displayItem,
    preview,
  });
  const canSubmit = disabledReason === null;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    try {
      const result = await decomposeMutation.mutateAsync({
        itemInstanceIds: [itemInstanceId],
        expectedFgemsReward,
      });

      onDecomposed?.(result);
      onClose();
    } catch (error) {
      pushToast({
        type: "error",
        title: "分解失败",
        message: getApiErrorMessage(error),
      });
    }
  }

  function handleClose() {
    if (!decomposeMutation.isPending) {
      onClose();
    }
  }

  return (
    <div className="upgrade-panel decompose-panel" role="presentation">
      <button
        aria-label="关闭分解面板"
        className="upgrade-panel__backdrop"
        disabled={decomposeMutation.isPending}
        onClick={handleClose}
        type="button"
      />
      <section
        aria-labelledby="decompose-panel-title"
        aria-modal="true"
        className="upgrade-panel__panel"
        role="dialog"
      >
        <header className="upgrade-panel__header">
          <div>
            <span>藏品分解</span>
            <h2 id="decompose-panel-title">{displayItem.name}</h2>
          </div>
          <button
            aria-label="关闭"
            disabled={decomposeMutation.isPending}
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
              <span>
                Lv.{formatCurrencyAmount(displayItem.level)} ·{" "}
                {displayItem.form?.displayName ?? "未分配形态"}
              </span>
            </div>
          </section>

          {detailQuery.isLoading ? (
            <PanelState title="同步分解预览" detail="正在读取服务端规则。" />
          ) : null}

          {detailQuery.isError ? (
            <PanelState
              tone="error"
              title="预览读取失败"
              detail={getApiErrorMessage(detailQuery.error)}
              onRetry={() => void detailQuery.refetch()}
            />
          ) : null}

          <section className="upgrade-panel__metrics" aria-label="分解预览">
            <DecomposeMetric
              icon="same"
              label="同款数量"
              value={formatOptionalNumber(sameItemCount)}
            />
            <DecomposeMetric
              icon="available"
              label="可分解数量"
              value={formatCurrencyAmount(decomposableCount)}
              tone={decomposableCount > 0 ? "positive" : "neutral"}
            />
            <DecomposeMetric
              icon="fgems"
              label="预计获得 Fgems"
              value={formatOptionalNumber(expectedFgemsReward)}
              tone={expectedFgemsReward ? "positive" : "neutral"}
            />
            <DecomposeMetric icon="decompose" label="本次分解" value="1 件" />
          </section>

          <section className="decompose-panel__warning" aria-label="分解提醒">
            <ShieldAlert aria-hidden="true" size={16} strokeWidth={2.4} />
            <div>
              <strong>分解后不可恢复</strong>
              <span>当前选中的藏品会由后端分解，奖励以后端返回为准。</span>
            </div>
          </section>

          <button
            aria-pressed={confirmed}
            className={`decompose-panel__confirm${
              confirmed ? " decompose-panel__confirm--checked" : ""
            }`}
            disabled={decomposeMutation.isPending}
            onClick={() => setConfirmed((value) => !value)}
            type="button"
          >
            {confirmed ? (
              <CheckCircle2 aria-hidden="true" size={16} strokeWidth={2.5} />
            ) : (
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            我确认分解后不可恢复
          </button>

          {disabledReason ? (
            <section className="upgrade-panel__notice" role="status">
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>{disabledReason}</span>
            </section>
          ) : null}

          {decomposeMutation.isError ? (
            <section className="upgrade-panel__notice" role="alert">
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>{getApiErrorMessage(decomposeMutation.error)}</span>
            </section>
          ) : null}
        </div>

        <footer className="upgrade-panel__footer">
          <button
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {decomposeMutation.isPending ? (
              <RefreshCw
                aria-hidden="true"
                className="upgrade-panel__spin"
                size={16}
                strokeWidth={2.5}
              />
            ) : (
              <PackageMinus aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {decomposeMutation.isPending ? "分解中" : "确认分解"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function DecomposeMetric({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: "available" | "decompose" | "fgems" | "same";
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

function getSameAvailableItems(
  item: CollectionInventoryItem | null,
  items: CollectionInventoryItem[],
): CollectionInventoryItem[] {
  if (!item) {
    return [];
  }

  const formId = item.form?.id ?? null;

  return items.filter(
    (candidate) =>
      candidate.status === "available" &&
      candidate.templateId === item.templateId &&
      (candidate.form?.id ?? null) === formId,
  );
}

function getAvailableSameCount(
  detail: CollectionInventoryDetail | null,
  preview: CollectionDecomposePreview | null,
  localAvailableCount: number,
): number {
  return Math.max(
    localAvailableCount,
    detail?.availableSameItemCount ?? 0,
    preview?.duplicateCount ?? 0,
  );
}

function getSameItemCount(
  detail: CollectionInventoryDetail | null,
  preview: CollectionDecomposePreview | null,
  availableSameCount: number,
): number {
  return Math.max(
    detail?.sameItemCount ?? 0,
    preview?.duplicateCount ?? 0,
    availableSameCount,
  );
}

function getDecomposeDisabledReason({
  availableSameCount,
  confirmed,
  detail,
  isDetailLoading,
  isListed,
  isPending,
  item,
  preview,
}: {
  availableSameCount: number;
  confirmed: boolean;
  detail: CollectionInventoryDetail | null;
  isDetailLoading: boolean;
  isListed: boolean;
  isPending: boolean;
  item: CollectionInventoryItem;
  preview: CollectionDecomposePreview | null;
}): string | null {
  if (isPending) {
    return "分解请求正在提交。";
  }

  if (isListed) {
    return "该藏品正在挂售中，不能分解。";
  }

  if (item.status !== "available") {
    return "该藏品当前状态不可分解。";
  }

  if (!item.isDecomposable) {
    return "该藏品不可分解。";
  }

  if (isDetailLoading) {
    return "正在同步分解预览。";
  }

  if (!detail || !preview) {
    return "分解预览暂不可用。";
  }

  if (availableSameCount < 2) {
    return "同模板、同形态的 available 藏品数量不足。";
  }

  if (
    preview.fgemsReward === null &&
    preview.totalRewardFgems === null &&
    preview.canDecompose
  ) {
    return "没有可用分解规则。";
  }

  if (!preview.canDecompose) {
    return getDecomposeReasonLabel(preview.reason) ?? "当前不能分解。";
  }

  if (!confirmed) {
    return "请先确认分解后不可恢复。";
  }

  return null;
}

function getDecomposeReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case "DECOMPOSE_REQUIRES_DUPLICATE":
      return "只能分解重复藏品。";
    case "DECOMPOSE_RULE_NOT_FOUND":
      return "没有可用分解规则。";
    case "ITEM_NOT_AVAILABLE":
      return "该藏品当前状态不可分解。";
    case "ITEM_NOT_DECOMPOSABLE":
      return "该藏品不可分解。";
    default:
      return reason;
  }
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "待同步"
    : formatCurrencyAmount(value);
}

function getMetricIcon(icon: "available" | "decompose" | "fgems" | "same") {
  switch (icon) {
    case "available":
      return PackageMinus;
    case "decompose":
      return PackageMinus;
    case "fgems":
      return Gem;
    case "same":
      return Users;
  }
}
