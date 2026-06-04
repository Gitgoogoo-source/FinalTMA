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
import { useFeedback } from "@/app/providers/FeedbackProvider";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  CollectionEvolutionPreview,
  CollectionEvolveItemResponse,
  CollectionInventoryItem,
} from "../collection.types";
import { useEvolveItem } from "../hooks/useEvolveItem";
import { useItemDetail } from "../hooks/useItemDetail";
import { getLocalEvolutionPreview } from "../localEvolutionPreviews";

const EMPTY_SELECTED_IDS: string[] = [];

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
  const { pushToast } = useFeedback();
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
  const displayItem = item;
  const detail = detailQuery.item;
  const serverPreview = detail?.evolutionPreview ?? null;
  const localPreview = useMemo(() => getLocalEvolutionPreview(item), [item]);
  const requiredCount =
    serverPreview?.requiredCount ?? localPreview?.requiredCount ?? 3;
  const serverSelectedIds = serverPreview?.selectedItemIds ?? EMPTY_SELECTED_IDS;
  const defaultSelectedIds = useMemo(
    () =>
      serverSelectedIds.length > 0
        ? serverSelectedIds
        : getDefaultSelectedIds(sameAvailableItems, requiredCount),
    [requiredCount, sameAvailableItems, serverSelectedIds],
  );
  const selectionSeed = open
    ? `${item?.itemInstanceId ?? "none"}:${defaultSelectedIds.join("|")}:${
        serverPreview?.availableSameItems ?? "local"
      }`
    : "";

  useEffect(() => {
    if (!open) {
      selectionSeedRef.current = "";
      setSelectedIds((current) =>
        current.length > 0 ? EMPTY_SELECTED_IDS : current,
      );
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
  const mainReturnItemId =
    serverPreview?.mainReturnItemId ?? getMainReturnItemId(selectedItems);
  const targetImageUrl =
    serverPreview?.targetImageUrl ?? localPreview?.targetImageUrl ?? null;
  const targetName = serverPreview?.targetName ?? localPreview?.targetName;
  const availableSameCount =
    serverPreview?.availableSameItems ?? sameAvailableItems.length;
  const isServerSelection =
    serverSelectedIds.length > 0 &&
    sameAvailableItems.length < serverSelectedIds.length;
  const isListed = item.status === "listed";
  const disabledReason = getEvolveDisabledReason({
    detailError: detailQuery.isError,
    isDetailLoading: detailQuery.isLoading,
    isListed,
    isPending: evolveMutation.isPending,
    item: displayItem,
    availableSameCount,
    requiredCount,
    serverPreview,
    selectedCount: selectedIds.length,
  });
  const canSubmit = disabledReason === null;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    try {
      const result = await evolveMutation.mutateAsync({
        sourceItemInstanceIds: selectedIds,
      });

      onEvolved?.(result);
      onClose();
    } catch (error) {
      pushToast({
        type: "error",
        title: "进化失败",
        message: getApiErrorMessage(error),
      });
    }
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
    <div
      className="upgrade-panel evolve-panel growth-panel--liquid-glass evolve-panel--liquid-glass"
      role="presentation"
    >
      <button
        aria-label="关闭进化面板"
        className="upgrade-panel__backdrop evolve-panel__backdrop"
        disabled={evolveMutation.isPending}
        onClick={handleClose}
        type="button"
      />
      <section
        aria-labelledby="evolve-panel-title"
        aria-modal="true"
        className="upgrade-panel__panel evolve-panel__panel"
        role="dialog"
      >
        <header className="upgrade-panel__header evolve-panel__header">
          <div>
            <span>藏品进化</span>
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

        <div
          className="upgrade-panel__body evolve-panel__body"
          aria-live="polite"
        >
          <section
            className="upgrade-panel__item evolve-panel__item"
            aria-label="当前藏品"
          >
            <div className="upgrade-panel__thumb evolve-panel__thumb">
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

          <section className="evolve-panel__target" aria-label="目标藏品">
            <div className="evolve-panel__target-image">
              {targetImageUrl ? (
                <img
                  src={targetImageUrl}
                  alt={targetName ?? "目标藏品"}
                />
              ) : (
                <PackageCheck aria-hidden="true" size={24} strokeWidth={2.3} />
              )}
            </div>
            <div className="evolve-panel__target-copy">
              <span>目标藏品</span>
              <strong>{targetName ?? "提交后确认"}</strong>
              <em>{serverPreview ? "服务端预览" : "本地展示预览"}</em>
            </div>
          </section>

          <section
            className="upgrade-panel__metrics evolve-panel__metrics"
            aria-label="进化预览"
          >
            <EvolveMetric
              icon="users"
              label="同款可用数量"
              value={formatOptionalNumber(availableSameCount)}
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
              value={formatOptionalNumber(serverPreview?.kcoinCost)}
            />
            <EvolveMetric
              icon="rate"
              label="成功率"
              value={formatSuccessRate(serverPreview?.successRateBps)}
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
                进化失败时返还主藏品；材料消耗和 KCOIN 以后端结果为准。
              </span>
            </div>
          </section>

          <section
            className="evolve-panel__materials"
            aria-label="选择进化材料"
          >
            <div className="evolve-panel__material-header">
              <strong>选择 3 个同款源藏品</strong>
              <span>
                {formatCurrencyAmount(selectedIds.length)} /{" "}
                {formatCurrencyAmount(requiredCount)}
              </span>
            </div>

            {detailQuery.isLoading ? (
              <div className="evolve-panel__placeholder">
                正在同步服务端材料。
              </div>
            ) : detailQuery.isError ? (
              <div className="evolve-panel__placeholder">
                进化预览读取失败。
              </div>
            ) : selectedIds.length > 0 ? (
              <div className="evolve-panel__material-list">
                {selectedIds.map((itemInstanceId, index) => {
                  const candidate = sameAvailableItems.find(
                    (sameItem) => sameItem.itemInstanceId === itemInstanceId,
                  );

                  return candidate ? (
                    <MaterialButton
                      disabled={evolveMutation.isPending || isServerSelection}
                      isCurrent={candidate.itemInstanceId === item.itemInstanceId}
                      isMain={candidate.itemInstanceId === mainReturnItemId}
                      isSelected={selectedIds.includes(candidate.itemInstanceId)}
                      item={candidate}
                      key={candidate.itemInstanceId}
                      onToggle={() =>
                        handleToggleMaterial(candidate.itemInstanceId)
                      }
                    />
                  ) : (
                    <MaterialPlaceholder
                      index={index}
                      isCurrent={itemInstanceId === item.itemInstanceId}
                      isMain={itemInstanceId === mainReturnItemId}
                      itemInstanceId={itemInstanceId}
                      key={itemInstanceId}
                    />
                  );
                })}
              </div>
            ) : sameAvailableItems.length === 0 ? (
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
            className={`upgrade-panel__balance evolve-panel__balance upgrade-panel__balance--${getBalanceTone(
              canSubmit,
            )}`}
            aria-label="KCOIN 余额"
          >
            <strong>{getBalanceLabel(canSubmit)}</strong>
            <span>{getBalanceDetail()}</span>
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

        <footer className="upgrade-panel__footer evolve-panel__footer">
          <button
            className="evolve-panel__submit"
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
            {evolveMutation.isPending ? "进化中" : "确认进化"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MaterialPlaceholder({
  index,
  isCurrent,
  isMain,
  itemInstanceId,
}: {
  index: number;
  isCurrent: boolean;
  isMain: boolean;
  itemInstanceId: string;
}) {
  return (
    <div className="evolve-panel__material-button evolve-panel__material-button--selected">
      <div className="evolve-panel__material-thumb">
        <PackageCheck aria-hidden="true" size={18} strokeWidth={2.4} />
      </div>
      <div className="evolve-panel__material-copy">
        <strong>材料 {formatCurrencyAmount(index + 1)}</strong>
        <span>服务端已选择候选 {formatShortId(itemInstanceId)}</span>
        <div className="evolve-panel__material-badges">
          <em>已选</em>
          {isMain ? <em>主藏品</em> : null}
          {isCurrent ? <em>当前</em> : null}
        </div>
      </div>
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
  sameAvailableItems: CollectionInventoryItem[],
  requiredCount: number,
): string[] {
  return sameAvailableItems
    .slice(0, requiredCount)
    .map((candidate) => candidate.itemInstanceId);
}

function getMainReturnItemId(
  selectedItems: CollectionInventoryItem[],
): string | null {
  return (
    [...selectedItems].sort(compareMaterialItems)[0]?.itemInstanceId ?? null
  );
}

function getEvolveDisabledReason({
  detailError,
  isDetailLoading,
  isListed,
  isPending,
  item,
  availableSameCount,
  requiredCount,
  serverPreview,
  selectedCount,
}: {
  detailError: boolean;
  isDetailLoading: boolean;
  isListed: boolean;
  isPending: boolean;
  item: CollectionInventoryItem;
  availableSameCount: number;
  requiredCount: number;
  serverPreview: CollectionEvolutionPreview | null;
  selectedCount: number;
}): string | null {
  if (isPending) {
    return "进化请求正在提交。";
  }

  if (isListed) {
    return "该藏品正在挂售中，不能进化。";
  }

  if (item.status !== "available") {
    return "该藏品当前状态不可进化。";
  }

  if (!item.isEvolvable) {
    return "该藏品不可进化。";
  }

  if (isDetailLoading) {
    return "正在同步进化预览。";
  }

  if (detailError) {
    return "进化预览读取失败。";
  }

  if (serverPreview && !serverPreview.canEvolve) {
    return getEvolveReasonLabel(serverPreview.reason) ?? "当前不能进化。";
  }

  if (availableSameCount < requiredCount) {
    return "同款可用藏品数量不足。";
  }

  if (selectedCount < requiredCount) {
    return `请选择 ${formatCurrencyAmount(requiredCount)} 个同款可用藏品。`;
  }

  return null;
}

function getEvolveReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case "ITEM_NOT_AVAILABLE":
      return "该藏品当前状态不可进化。";
    case "ITEM_LOCKED":
      return "该藏品正在锁定中，不能进化。";
    case "ITEM_MINTING":
      return "该藏品正在 Mint 流程中，不能进化。";
    case "ITEM_NOT_EVOLVABLE":
      return "该藏品不可进化。";
    case "EVOLVE_NOT_ENOUGH_ITEMS":
      return "同款可用藏品数量不足。";
    case "EVOLVE_RULE_NOT_FOUND":
      return "没有可用进化规则。";
    case "INSUFFICIENT_KCOIN":
      return "KCOIN 余额不足。";
    default:
      return reason;
  }
}

function getBalanceTone(canSubmit: boolean): "neutral" | "ready" {
  return canSubmit ? "ready" : "neutral";
}

function getBalanceLabel(canSubmit: boolean): string {
  return canSubmit ? "KCOIN 提交后校验" : "KCOIN 等待材料";
}

function getBalanceDetail(): string {
  return "余额、消耗和概率由服务端在确认进化时校验。";
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

  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
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
