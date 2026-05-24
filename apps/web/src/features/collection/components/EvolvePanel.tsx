import {
  AlertTriangle,
  Coins,
  PackageCheck,
  Percent,
  RefreshCw,
  ShieldCheck,
  Swords,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessage } from "@/api/errors";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CollectionEvolveItemResponse,
  CollectionEvolutionPreview,
  CollectionInventoryDetail,
  CollectionInventoryItem,
} from "../collection.types";
import { useEvolveItem } from "../hooks/useEvolveItem";
import { useItemDetail } from "../hooks/useItemDetail";

type EvolvePanelProps = {
  open: boolean;
  item: CollectionInventoryItem | null;
  items: CollectionInventoryItem[];
  onClose: () => void;
  onEvolved?: (result: CollectionEvolveItemResponse) => void;
};

export function EvolvePanel({
  item,
  items,
  onClose,
  onEvolved,
  open,
}: EvolvePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionSeedRef = useRef<string>("");
  const detailQuery = useItemDetail(open ? item?.itemInstanceId : null, {
    enabled: open && Boolean(item),
  });
  const evolveMutation = useEvolveItem();

  const sameAvailableItems = useMemo(
    () => getSameAvailableItems(item, items),
    [item, items],
  );
  const detail = detailQuery.item;
  const displayItem = detail ?? item;
  const preview = detail?.evolutionPreview ?? null;
  const requiredCount = preview?.requiredCount ?? 3;
  const defaultSelectedIds = useMemo(
    () => getDefaultSelectedIds(preview, sameAvailableItems, requiredCount),
    [preview, requiredCount, sameAvailableItems],
  );
  const selectionSeed = open
    ? `${item?.itemInstanceId ?? "none"}:${defaultSelectedIds.join("|")}`
    : "";

  useEffect(() => {
    if (!open) {
      selectionSeedRef.current = "";
      setSelectedIds([]);
      return;
    }

    if (selectionSeed && selectionSeed !== selectionSeedRef.current) {
      selectionSeedRef.current = selectionSeed;
      setSelectedIds(defaultSelectedIds);
    }
  }, [defaultSelectedIds, open, selectionSeed]);

  if (!open || !item || !displayItem) {
    return null;
  }

  const imageUrl =
    displayItem.thumbnailUrl ?? displayItem.imageUrl ?? displayItem.avatarUrl;
  const selectedItems = selectedIds
    .map((id) =>
      sameAvailableItems.find((candidate) => candidate.itemInstanceId === id),
    )
    .filter((candidate): candidate is CollectionInventoryItem =>
      Boolean(candidate),
    );
  const mainReturnItemId = getMainReturnItemId(
    selectedIds,
    selectedItems,
    preview,
  );
  const targetImageUrl =
    preview?.targetImageUrl ?? displayItem.imageUrl ?? displayItem.thumbnailUrl;
  const isListed = detail?.marketStatus?.isListed ?? item.status === "listed";
  const disabledReason = getEvolveDisabledReason({
    detail,
    isDetailLoading: detailQuery.isLoading,
    isListed,
    isPending: evolveMutation.isPending,
    item: displayItem,
    localAvailableCount: sameAvailableItems.length,
    preview,
    requiredCount,
    selectedCount: selectedIds.length,
  });
  const canSubmit = disabledReason === null;

  async function handleSubmit() {
    if (!canSubmit || !preview) {
      return;
    }

    const result = await evolveMutation.mutateAsync({
      sourceItemInstanceIds: selectedIds,
      targetFormId: preview.targetFormId,
      expectedKcoinCost: preview.kcoinCost,
      expectedSuccessRateBps: preview.successRateBps,
      expectedReturnItemInstanceId: mainReturnItemId,
    });

    onEvolved?.(result);
    onClose();
  }

  function handleClose() {
    if (!evolveMutation.isPending) {
      onClose();
    }
  }

  function handleToggleMaterial(itemInstanceId: string) {
    if (evolveMutation.isPending) {
      return;
    }

    setSelectedIds((current) => {
      if (current.includes(itemInstanceId)) {
        return current.filter((id) => id !== itemInstanceId);
      }

      if (current.length < requiredCount) {
        return [...current, itemInstanceId];
      }

      return [...current.slice(0, requiredCount - 1), itemInstanceId];
    });
  }

  return (
    <div className="upgrade-panel evolve-panel" role="presentation">
      <button
        aria-label="关闭合成面板"
        className="upgrade-panel__backdrop"
        disabled={evolveMutation.isPending}
        onClick={handleClose}
        type="button"
      />
      <section
        aria-labelledby="evolve-panel-title"
        aria-modal="true"
        className="upgrade-panel__panel"
        role="dialog"
      >
        <header className="upgrade-panel__header">
          <div>
            <span>合成 / 进化</span>
            <h2 id="evolve-panel-title">{displayItem.name}</h2>
          </div>
          <button
            aria-label="关闭"
            disabled={evolveMutation.isPending}
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
            <PanelState title="同步合成预览" detail="正在读取服务端规则。" />
          ) : null}

          {detailQuery.isError ? (
            <PanelState
              tone="error"
              title="预览读取失败"
              detail={getApiErrorMessage(detailQuery.error)}
              onRetry={() => void detailQuery.refetch()}
            />
          ) : null}

          <section className="evolve-panel__target" aria-label="目标形态">
            <div className="evolve-panel__target-image">
              {targetImageUrl ? (
                <img
                  src={targetImageUrl}
                  alt={preview?.targetName ?? "目标形态"}
                />
              ) : (
                <PackageCheck aria-hidden="true" size={24} strokeWidth={2.3} />
              )}
            </div>
            <div className="evolve-panel__target-copy">
              <span>目标形态</span>
              <strong>{preview?.targetName ?? "待同步"}</strong>
              <em>
                {preview?.targetFormId ? "服务端规则已返回" : "等待规则返回"}
              </em>
            </div>
          </section>

          <section className="upgrade-panel__metrics" aria-label="合成预览">
            <EvolveMetric
              icon="users"
              label="同款 available 数量"
              value={formatOptionalNumber(
                preview?.availableSameItems ?? sameAvailableItems.length,
              )}
            />
            <EvolveMetric
              icon="materials"
              label="已选择材料"
              value={`${formatCurrencyAmount(selectedIds.length)} / ${formatCurrencyAmount(
                requiredCount,
              )}`}
              tone={
                selectedIds.length === requiredCount ? "positive" : "neutral"
              }
            />
            <EvolveMetric
              icon="kcoin"
              label="KCOIN 消耗"
              value={formatOptionalNumber(preview?.kcoinCost)}
            />
            <EvolveMetric
              icon="rate"
              label="成功率"
              value={formatSuccessRate(preview?.successRateBps)}
            />
          </section>

          <section className="evolve-panel__rule" aria-label="失败返还说明">
            <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.4} />
            <div>
              <strong>
                {mainReturnItemId
                  ? `主藏品 ${formatShortId(mainReturnItemId)}`
                  : "主藏品待选择"}
              </strong>
              <span>
                合成失败时返还主藏品；材料消耗和 KCOIN 以后端结果为准。
              </span>
            </div>
          </section>

          <section
            className="evolve-panel__materials"
            aria-label="选择合成材料"
          >
            <div className="evolve-panel__material-header">
              <strong>选择 3 个同款材料</strong>
              <span>
                {formatCurrencyAmount(selectedIds.length)} /{" "}
                {formatCurrencyAmount(requiredCount)}
              </span>
            </div>

            {sameAvailableItems.length === 0 ? (
              <div className="evolve-panel__placeholder">
                没有同款可用藏品。
              </div>
            ) : (
              <div className="evolve-panel__material-list">
                {sameAvailableItems.map((candidate) => (
                  <MaterialButton
                    disabled={evolveMutation.isPending}
                    isCurrent={candidate.itemInstanceId === item.itemInstanceId}
                    isMain={candidate.itemInstanceId === mainReturnItemId}
                    isSelected={selectedIds.includes(candidate.itemInstanceId)}
                    item={candidate}
                    key={candidate.itemInstanceId}
                    onToggle={() =>
                      handleToggleMaterial(candidate.itemInstanceId)
                    }
                  />
                ))}
              </div>
            )}
          </section>

          <section
            className={`upgrade-panel__balance upgrade-panel__balance--${getBalanceTone(
              preview,
            )}`}
            aria-label="KCOIN 余额"
          >
            <strong>{getBalanceLabel(preview)}</strong>
            <span>{getBalanceDetail(preview)}</span>
          </section>

          {disabledReason ? (
            <section className="upgrade-panel__notice" role="status">
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>{disabledReason}</span>
            </section>
          ) : null}

          {evolveMutation.isError ? (
            <section className="upgrade-panel__notice" role="alert">
              <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>{getApiErrorMessage(evolveMutation.error)}</span>
            </section>
          ) : null}
        </div>

        <footer className="upgrade-panel__footer">
          <button
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {evolveMutation.isPending ? (
              <RefreshCw
                aria-hidden="true"
                className="upgrade-panel__spin"
                size={16}
                strokeWidth={2.5}
              />
            ) : (
              <Swords aria-hidden="true" size={16} strokeWidth={2.5} />
            )}
            {evolveMutation.isPending ? "合成中" : "确认合成"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MaterialButton({
  disabled,
  isCurrent,
  isMain,
  isSelected,
  item,
  onToggle,
}: {
  disabled: boolean;
  isCurrent: boolean;
  isMain: boolean;
  isSelected: boolean;
  item: CollectionInventoryItem;
  onToggle: () => void;
}) {
  const imageUrl = item.thumbnailUrl ?? item.imageUrl ?? item.avatarUrl;

  return (
    <button
      aria-pressed={isSelected}
      className={`evolve-panel__material-button${
        isSelected ? " evolve-panel__material-button--selected" : ""
      }`}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <div className="evolve-panel__material-thumb">
        {imageUrl ? (
          <img src={imageUrl} alt={item.name} />
        ) : (
          <span aria-hidden="true">{item.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="evolve-panel__material-copy">
        <strong>{item.name}</strong>
        <span>
          Lv.{formatCurrencyAmount(item.level)} · 战力{" "}
          {formatCurrencyAmount(item.power)}
        </span>
        <div className="evolve-panel__material-badges">
          {isSelected ? <em>已选</em> : null}
          {isMain ? <em>主藏品</em> : null}
          {isCurrent ? <em>当前</em> : null}
        </div>
      </div>
    </button>
  );
}

function EvolveMetric({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: "kcoin" | "materials" | "rate" | "users";
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

  return items
    .filter(
      (candidate) =>
        candidate.status === "available" &&
        candidate.templateId === item.templateId &&
        (candidate.form?.id ?? null) === formId,
    )
    .sort(compareMaterialItems);
}

function compareMaterialItems(
  left: CollectionInventoryItem,
  right: CollectionInventoryItem,
): number {
  if (right.level !== left.level) {
    return right.level - left.level;
  }

  if (right.power !== left.power) {
    return right.power - left.power;
  }

  return getTime(left.obtainedAt) - getTime(right.obtainedAt);
}

function getDefaultSelectedIds(
  preview: CollectionEvolutionPreview | null,
  sameAvailableItems: CollectionInventoryItem[],
  requiredCount: number,
): string[] {
  const availableIds = new Set(
    sameAvailableItems.map((candidate) => candidate.itemInstanceId),
  );
  const previewIds =
    preview?.selectedItemIds.filter((id) => availableIds.has(id)) ?? [];

  if (previewIds.length >= requiredCount) {
    return previewIds.slice(0, requiredCount);
  }

  return sameAvailableItems
    .slice(0, requiredCount)
    .map((candidate) => candidate.itemInstanceId);
}

function getMainReturnItemId(
  selectedIds: string[],
  selectedItems: CollectionInventoryItem[],
  preview: CollectionEvolutionPreview | null,
): string | null {
  if (
    preview?.mainReturnItemId &&
    selectedIds.includes(preview.mainReturnItemId) &&
    hasSameIds(selectedIds, preview.selectedItemIds)
  ) {
    return preview.mainReturnItemId;
  }

  return (
    [...selectedItems].sort(compareMaterialItems)[0]?.itemInstanceId ?? null
  );
}

function hasSameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function getEvolveDisabledReason({
  detail,
  isDetailLoading,
  isListed,
  isPending,
  item,
  localAvailableCount,
  preview,
  requiredCount,
  selectedCount,
}: {
  detail: CollectionInventoryDetail | null;
  isDetailLoading: boolean;
  isListed: boolean;
  isPending: boolean;
  item: CollectionInventoryItem;
  localAvailableCount: number;
  preview: CollectionEvolutionPreview | null;
  requiredCount: number;
  selectedCount: number;
}): string | null {
  if (isPending) {
    return "合成请求正在提交。";
  }

  if (isListed) {
    return "该藏品正在挂售中，不能合成。";
  }

  if (item.status !== "available") {
    return "该藏品当前状态不可合成。";
  }

  if (!item.isEvolvable) {
    return "该藏品不可合成。";
  }

  if (isDetailLoading) {
    return "正在同步合成预览。";
  }

  if (!detail || !preview) {
    return "合成预览暂不可用。";
  }

  const availableCount = Math.max(
    localAvailableCount,
    preview.availableSameItems ?? 0,
    preview.selectedItemIds.length,
  );

  if (availableCount < requiredCount) {
    return "同款 available 藏品数量不足。";
  }

  if (selectedCount < requiredCount) {
    return `请选择 ${formatCurrencyAmount(requiredCount)} 个同款可用藏品。`;
  }

  if (
    preview.kcoinCost === null ||
    preview.successRateBps === null ||
    preview.targetFormId === null
  ) {
    return getEvolveReasonLabel(preview.reason) ?? "没有可用合成规则。";
  }

  if (preview.isBalanceEnough === false) {
    return "KCOIN 余额不足。";
  }

  if (!preview.canEvolve) {
    return getEvolveReasonLabel(preview.reason) ?? "当前不能合成。";
  }

  return null;
}

function getEvolveReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case "INSUFFICIENT_KCOIN":
      return "KCOIN 余额不足。";
    case "EVOLVE_ITEM_COUNT_INVALID":
      return "合成必须选择 3 个藏品。";
    case "EVOLVE_DUPLICATE_ITEM_IDS":
      return "合成材料不能重复。";
    case "EVOLVE_REQUIRES_SAME_TEMPLATE_AND_FORM":
      return "合成需要 3 个同模板、同形态藏品。";
    case "EVOLVE_RULE_NOT_FOUND":
    case "NO_NEXT_FORM":
      return "没有可用合成规则，或已经是最高形态。";
    case "ITEM_NOT_AVAILABLE":
    case "ITEM_NOT_EVOLVABLE":
      return "该藏品当前不可合成。";
    default:
      return reason;
  }
}

function getBalanceTone(
  preview: CollectionEvolutionPreview | null,
): "neutral" | "ready" | "blocked" {
  if (!preview || preview.isBalanceEnough === null) {
    return "neutral";
  }

  return preview.isBalanceEnough ? "ready" : "blocked";
}

function getBalanceLabel(preview: CollectionEvolutionPreview | null): string {
  if (!preview || preview.isBalanceEnough === null) {
    return "KCOIN 余额待同步";
  }

  return preview.isBalanceEnough ? "KCOIN 余额足够" : "KCOIN 余额不足";
}

function getBalanceDetail(preview: CollectionEvolutionPreview | null): string {
  if (!preview) {
    return "等待服务端返回。";
  }

  if (preview.userKcoinBalance === null || preview.kcoinCost === null) {
    return "余额或消耗未返回。";
  }

  const gap = preview.userKcoinBalance - preview.kcoinCost;

  if (gap >= 0) {
    return `合成后预计剩余 ${formatCurrencyAmount(gap)} KCOIN。`;
  }

  return `还差 ${formatCurrencyAmount(Math.abs(gap))} KCOIN。`;
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "待同步"
    : formatCurrencyAmount(value);
}

function formatSuccessRate(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "待同步";
  }

  const percent = value / 100;
  return `${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
  }).format(percent)}%`;
}

function formatShortId(value: string): string {
  return value.slice(0, 8);
}

function getTime(value: string | null): number {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getMetricIcon(icon: "kcoin" | "materials" | "rate" | "users") {
  switch (icon) {
    case "kcoin":
      return Coins;
    case "materials":
      return PackageCheck;
    case "rate":
      return Percent;
    case "users":
      return Users;
  }
}
