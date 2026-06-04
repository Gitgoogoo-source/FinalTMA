import {
  AlertTriangle,
  Gem,
  PackageMinus,
  RefreshCw,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { useMemo } from "react";

import { getApiErrorMessage } from "@/api/errors";
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CollectionDecomposeItemResponse,
  CollectionInventoryGroup,
  CollectionInventoryItem,
} from "../collection.types";
import { useDecomposeItem } from "../hooks/useDecomposeItem";

type DecomposePanelProps = {
  open: boolean;
  item: CollectionInventoryItem | null;
  group?: CollectionInventoryGroup | null;
  items: CollectionInventoryItem[];
  onClose: () => void;
  onDecomposed?: (result: CollectionDecomposeItemResponse) => void;
};

export function DecomposePanel({
  group,
  item,
  items,
  onClose,
  onDecomposed,
  open,
}: DecomposePanelProps) {
  const { pushToast } = useFeedback();
  const decomposeMutation = useDecomposeItem();

  const sameAvailableItems = useMemo(
    () => getSameAvailableItems(item, items),
    [item, items],
  );

  if (!open || !item) {
    return null;
  }

  const itemInstanceId = item.itemInstanceId;
  const imageUrl = item.thumbnailUrl ?? item.imageUrl ?? item.avatarUrl;
  const availableSameCount = group?.availableCount ?? sameAvailableItems.length;
  const sameItemCount = Math.max(
    group?.ownedCount ?? 0,
    availableSameCount,
    sameAvailableItems.length,
  );
  const decomposableCount = Math.max(availableSameCount - 1, 0);
  const expectedFgemsReward = getLocalDecomposeRewardFgems(item);
  const disabledReason = getDecomposeDisabledReason({
    availableSameCount,
    expectedFgemsReward,
    isListed: item.status === "listed",
    isPending: decomposeMutation.isPending,
    item,
  });
  const canSubmit = disabledReason === null;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    try {
      const result = await decomposeMutation.mutateAsync({
        itemInstanceIds: [itemInstanceId],
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
    <div
      className="upgrade-panel decompose-panel growth-panel--liquid-glass"
      role="presentation"
    >
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
            <h2 id="decompose-panel-title">{item.name}</h2>
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
                <img src={imageUrl} alt={item.name} />
              ) : (
                <span aria-hidden="true">{item.name.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>{item.name}</strong>
              <span>
                Lv.{formatCurrencyAmount(item.level)} ·{" "}
                {item.form?.displayName ?? "未分配形态"}
              </span>
            </div>
          </section>

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
            <DecomposeMetric icon="reward" label="额外道具" value="无" />
            <DecomposeMetric icon="decompose" label="本次分解" value="1 件" />
          </section>

          <section className="decompose-panel__warning" aria-label="分解提醒">
            <ShieldAlert aria-hidden="true" size={16} strokeWidth={2.4} />
            <div>
              <strong>分解后不可恢复</strong>
              <span>当前选中的藏品会由后端分解，奖励以后端返回为准。</span>
            </div>
          </section>

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
  icon: "available" | "decompose" | "fgems" | "reward" | "same";
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

function getDecomposeDisabledReason({
  availableSameCount,
  expectedFgemsReward,
  isListed,
  isPending,
  item,
}: {
  availableSameCount: number;
  expectedFgemsReward: number | null;
  isListed: boolean;
  isPending: boolean;
  item: CollectionInventoryItem;
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

  if (availableSameCount < 2) {
    return "同模板、同形态的 available 藏品数量不足。";
  }

  if (expectedFgemsReward === null) {
    return "没有本地分解奖励配置。";
  }

  return null;
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "待配置"
    : formatCurrencyAmount(value);
}

function getLocalDecomposeRewardFgems(
  item: CollectionInventoryItem,
): number | null {
  const rarityCode = item.rarity.code.toLowerCase();
  const formIndex = item.form?.index ?? 1;

  return DECOMPOSE_REWARD_FGEMS[rarityCode]?.[formIndex] ?? null;
}

const DECOMPOSE_REWARD_FGEMS: Record<string, Record<number, number>> = {
  common: {
    1: 5,
    2: 15,
    3: 40,
  },
  epic: {
    1: 50,
    2: 150,
    3: 400,
  },
  legendary: {
    1: 150,
    2: 450,
    3: 1200,
  },
  rare: {
    1: 15,
    2: 45,
    3: 120,
  },
};

function getMetricIcon(
  icon: "available" | "decompose" | "fgems" | "reward" | "same",
) {
  switch (icon) {
    case "available":
      return PackageMinus;
    case "decompose":
      return PackageMinus;
    case "fgems":
      return Gem;
    case "reward":
      return PackageMinus;
    case "same":
      return Users;
  }
}
