import { Images, PackageOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useFeedback } from "@/app/providers/FeedbackProvider";
import { getApiErrorMessage } from "@/api/errors";
import { MintQueueSheet } from "@/features/wallet/components/MintQueueSheet";
import { useMarketSellRules } from "@/features/trade/hooks/useMarketSellRules";
import { useCreateMint } from "@/features/wallet/hooks/useCreateMint";
import { useMintQueue } from "@/features/wallet/hooks/useMintQueue";
import { APP_ROUTES } from "@/shared/constants/routes";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import { CharacterDetailPanel } from "../components/CharacterDetailPanel";
import { CharacterGrid } from "../components/CharacterGrid";
import { CollectionCancelEntry } from "../components/CollectionCancelEntry";
import { CollectionSellEntry } from "../components/CollectionSellEntry";
import { DecomposePanel } from "../components/DecomposePanel";
import { EvolvePanel } from "../components/EvolvePanel";
import { GrowthResultModal } from "../components/GrowthResultModal";
import { UpgradePanel } from "../components/UpgradePanel";
import type {
  CollectionDecomposeItemResponse,
  CollectionEvolveItemResponse,
  CollectionUpgradeItemResponse,
} from "../collection.types";
import { useCancelInventorySell } from "../hooks/useCancelInventorySell";
import { useInventory } from "../hooks/useInventory";
import { useSellInventoryItem } from "../hooks/useSellInventoryItem";

export function CollectionPage() {
  const { pushToast } = useFeedback();
  const inventoryQuery = useInventory();
  const createMintMutation = useCreateMint();
  const sellInventoryMutation = useSellInventoryItem();
  const cancelSellMutation = useCancelInventorySell();
  const sellRulesQuery = useMarketSellRules();
  const items = inventoryQuery.items;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isSellOpen, setIsSellOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isEvolveOpen, setIsEvolveOpen] = useState(false);
  const [isDecomposeOpen, setIsDecomposeOpen] = useState(false);
  const [isMintQueueOpen, setIsMintQueueOpen] = useState(false);
  const [cancelSellTarget, setCancelSellTarget] = useState<{
    itemInstanceId: string;
    listingId: string | null;
    unitPriceKcoin: number | null;
  } | null>(null);
  const mintQueueQuery = useMintQueue({
    enabled: isMintQueueOpen,
  });
  const [upgradeResult, setUpgradeResult] =
    useState<CollectionUpgradeItemResponse | null>(null);
  const [evolveResult, setEvolveResult] =
    useState<CollectionEvolveItemResponse | null>(null);
  const [decomposeResult, setDecomposeResult] =
    useState<CollectionDecomposeItemResponse | null>(null);
  const selectedItem = useMemo(
    () =>
      items.find((item) => item.itemInstanceId === selectedItemId) ??
      items[0] ??
      null,
    [items, selectedItemId],
  );

  useEffect(() => {
    if (items.length === 0) {
      setSelectedItemId(null);
      setIsSellOpen(false);
      setIsUpgradeOpen(false);
      setIsEvolveOpen(false);
      setIsDecomposeOpen(false);
      setIsMintQueueOpen(false);
      setCancelSellTarget(null);
      setUpgradeResult(null);
      setEvolveResult(null);
      setDecomposeResult(null);
      return;
    }

    if (!selectedItem) {
      return;
    }

    if (selectedItem.itemInstanceId !== selectedItemId) {
      setSelectedItemId(selectedItem.itemInstanceId);
    }
  }, [items, selectedItem, selectedItemId]);

  function handleOpenUpgrade() {
    setIsSellOpen(false);
    setIsEvolveOpen(false);
    setIsDecomposeOpen(false);
    setIsUpgradeOpen(true);
  }

  function handleOpenEvolve() {
    setIsSellOpen(false);
    setIsUpgradeOpen(false);
    setIsDecomposeOpen(false);
    setIsEvolveOpen(true);
  }

  function handleOpenDecompose() {
    setIsSellOpen(false);
    setIsUpgradeOpen(false);
    setIsEvolveOpen(false);
    setIsDecomposeOpen(true);
  }

  function handleOpenSell() {
    setIsUpgradeOpen(false);
    setIsEvolveOpen(false);
    setIsDecomposeOpen(false);
    setIsSellOpen(true);
  }

  function handleOpenCancelSell(target: {
    itemInstanceId: string;
    listingId: string | null;
    unitPriceKcoin: number | null;
  }) {
    setIsUpgradeOpen(false);
    setIsEvolveOpen(false);
    setIsDecomposeOpen(false);
    setCancelSellTarget(target);
  }

  function handleConfirmSell(unitPriceKcoin: number) {
    if (!selectedItem || sellInventoryMutation.isPending) {
      return;
    }

    sellInventoryMutation.mutate(
      {
        itemInstanceId: selectedItem.itemInstanceId,
        unitPriceKcoin,
      },
      {
        onSuccess: (result) => {
          setIsSellOpen(false);
          pushToast({
            type: "success",
            title: "上架成功",
            message: `预计到手 ${formatCurrencyAmount(
              result.expectedNetAmountKcoin,
            )} K-coin，库存和市场正在刷新。`,
          });
        },
        onError: (error) => {
          pushToast({
            type: "error",
            title: "上架失败",
            message: getApiErrorMessage(error),
          });
        },
      },
    );
  }

  function handleConfirmCancelSell() {
    if (!cancelSellTarget || cancelSellMutation.isPending) {
      return;
    }

    cancelSellMutation.mutate(
      {
        itemInstanceId: cancelSellTarget.itemInstanceId,
        listingId: cancelSellTarget.listingId,
      },
      {
        onSuccess: (result) => {
          setCancelSellTarget(null);
          pushToast({
            type: "success",
            title: "下架成功",
            message:
              result.releasedItemInstanceIds.length > 0
                ? `已释放 ${formatCurrencyAmount(
                    result.releasedItemInstanceIds.length,
                  )} 个未售出藏品。`
                : "挂单已下架，库存正在刷新。",
          });
        },
        onError: (error) => {
          pushToast({
            type: "error",
            title: "下架失败",
            message: getApiErrorMessage(error),
          });
        },
      },
    );
  }

  function handleCreateMint(
    itemInstanceId: string,
    blockingMessages: string[],
  ) {
    if (blockingMessages.length > 0) {
      pushToast({
        type: "info",
        title: "暂不能 Mint",
        message: blockingMessages.join(" "),
      });
      return;
    }

    if (createMintMutation.isPending) {
      return;
    }

    createMintMutation.mutate(
      {
        itemInstanceId,
      },
      {
        onSuccess: (result) => {
          setSelectedItemId(result.itemInstanceId);
          setIsMintQueueOpen(true);
          pushToast({
            type: "success",
            title: "Mint 已入队",
            message: "藏品已锁定，队列状态以服务端为准。",
          });
        },
        onError: (error) => {
          pushToast({
            type: "error",
            title: "Mint 入队失败",
            message: getApiErrorMessage(error),
          });
        },
      },
    );
  }

  function handleCloseMintQueue() {
    setIsMintQueueOpen(false);
  }

  function handleRefreshMintQueue() {
    void mintQueueQuery.refetch();
  }

  function handleUpgradeResult(result: CollectionUpgradeItemResponse) {
    setSelectedItemId(result.itemInstanceId);
    setUpgradeResult(result);
  }

  function handleEvolveResult(result: CollectionEvolveItemResponse) {
    setSelectedItemId(
      result.createdItemInstanceId ??
        result.returnedItemInstanceId ??
        result.mainItemInstanceId ??
        selectedItem?.itemInstanceId ??
        result.sourceItemInstanceIds[0] ??
        null,
    );
    setEvolveResult(result);
  }

  function handleDecomposeResult(result: CollectionDecomposeItemResponse) {
    const decomposedIds = new Set(result.decomposedItemInstanceIds);
    const nextAvailableItem =
      items.find((candidate) => !decomposedIds.has(candidate.itemInstanceId)) ??
      null;

    setSelectedItemId(nextAvailableItem?.itemInstanceId ?? null);
    setDecomposeResult(result);
  }

  if (inventoryQuery.isLoading && items.length === 0) {
    return (
      <section
        className="collection-page collection-page--state"
        aria-busy="true"
      >
        <div className="collection-state">
          <span className="collection-state__spinner" />
          <strong>藏品加载中</strong>
        </div>
      </section>
    );
  }

  if (inventoryQuery.isError && items.length === 0) {
    return (
      <section className="collection-page collection-page--state">
        <div className="collection-state" role="alert">
          <strong>库存读取失败</strong>
          <span>{getApiErrorMessage(inventoryQuery.error)}</span>
          <button onClick={() => void inventoryQuery.refetch()} type="button">
            <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
            重试
          </button>
        </div>
      </section>
    );
  }

  if (!selectedItem) {
    return (
      <section className="collection-page collection-page--state">
        <div className="collection-empty">
          <PackageOpen aria-hidden="true" size={34} strokeWidth={2.1} />
          <strong>还没有藏品</strong>
          <span>开盒后获得的藏品会显示在这里。</span>
          <Link to={APP_ROUTES.box}>去开盒</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="collection-page" data-testid="collection-page">
      <div className="collection-page__backdrop" aria-hidden="true" />
      <header className="collection-page__nav" aria-label="藏品导航">
        <div className="collection-page__title">
          <span>选择角色</span>
          <strong>藏品</strong>
        </div>
        <Link
          aria-label="图鉴成就"
          className="collection-page__nav-button collection-page__nav-button--wide"
          to={APP_ROUTES.album}
        >
          <Images aria-hidden="true" size={18} strokeWidth={2.5} />
          <span>图鉴</span>
        </Link>
      </header>
      <CharacterDetailPanel
        item={selectedItem}
        isMinting={createMintMutation.isPending}
        onCancelSell={handleOpenCancelSell}
        onDecompose={handleOpenDecompose}
        onEvolve={handleOpenEvolve}
        onMint={handleCreateMint}
        onSell={handleOpenSell}
        onUpgrade={handleOpenUpgrade}
      />
      <CharacterGrid
        items={items}
        selectedItemId={selectedItem.itemInstanceId}
        onSelect={setSelectedItemId}
      />
      {inventoryQuery.hasNextPage ? (
        <div className="collection-load-more">
          <button
            disabled={inventoryQuery.isFetchingNextPage}
            onClick={() => void inventoryQuery.fetchNextPage()}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={
                inventoryQuery.isFetchingNextPage
                  ? "collection-load-more__spin"
                  : undefined
              }
              size={15}
              strokeWidth={2.4}
            />
            {inventoryQuery.isFetchingNextPage ? "加载中" : "加载更多"}
          </button>
        </div>
      ) : null}
      <CollectionSellEntry
        feeBps={sellRulesQuery.rules?.feeBps ?? null}
        isPending={sellInventoryMutation.isPending}
        item={selectedItem}
        onClose={() => setIsSellOpen(false)}
        onConfirm={handleConfirmSell}
        open={isSellOpen}
      />
      <CollectionCancelEntry
        isPending={cancelSellMutation.isPending}
        item={selectedItem}
        onClose={() => setCancelSellTarget(null)}
        onConfirm={handleConfirmCancelSell}
        open={cancelSellTarget !== null}
        unitPriceKcoin={cancelSellTarget?.unitPriceKcoin ?? null}
      />
      <UpgradePanel
        open={isUpgradeOpen}
        item={selectedItem}
        onClose={() => setIsUpgradeOpen(false)}
        onUpgraded={handleUpgradeResult}
      />
      <EvolvePanel
        open={isEvolveOpen}
        item={selectedItem}
        items={items}
        onClose={() => setIsEvolveOpen(false)}
        onEvolved={handleEvolveResult}
      />
      <DecomposePanel
        open={isDecomposeOpen}
        item={selectedItem}
        items={items}
        onClose={() => setIsDecomposeOpen(false)}
        onDecomposed={handleDecomposeResult}
      />
      <MintQueueSheet
        open={isMintQueueOpen}
        items={mintQueueQuery.items}
        summary={mintQueueQuery.mintQueue}
        loading={mintQueueQuery.isLoading || mintQueueQuery.isFetching}
        errorMessage={
          mintQueueQuery.isError
            ? getApiErrorMessage(mintQueueQuery.error)
            : null
        }
        onClose={handleCloseMintQueue}
        onRefresh={handleRefreshMintQueue}
      />
      <GrowthResultModal
        open={upgradeResult !== null}
        title="升级成功"
        description={formatUpgradeResultDescription(upgradeResult)}
        metrics={getUpgradeResultMetrics(upgradeResult)}
        onClose={() => setUpgradeResult(null)}
      />
      <GrowthResultModal
        open={evolveResult !== null}
        title={evolveResult?.success ? "合成成功" : "合成失败"}
        description={formatEvolveResultDescription(evolveResult)}
        headerLabel={evolveResult?.success ? "成长完成" : "合成结果"}
        metrics={getEvolveResultMetrics(evolveResult)}
        tone={evolveResult?.success ? "success" : "warning"}
        onClose={() => setEvolveResult(null)}
      />
      <GrowthResultModal
        open={decomposeResult !== null}
        title="分解成功"
        description={formatDecomposeResultDescription(decomposeResult)}
        metrics={getDecomposeResultMetrics(decomposeResult)}
        onClose={() => setDecomposeResult(null)}
      />
    </section>
  );
}

function getUpgradeResultMetrics(result: CollectionUpgradeItemResponse | null) {
  if (!result) {
    return [];
  }

  return [
    {
      label: "等级变化",
      value: `${formatLevel(result.fromLevel)} -> ${formatLevel(
        result.toLevel,
      )}`,
    },
    {
      label: "战力变化",
      value: `${formatOptionalNumber(result.fromPower)} -> ${formatCurrencyAmount(
        result.toPower,
      )}`,
    },
    {
      label: "消耗 Fgems",
      value: formatCurrencyAmount(result.consumedFgems),
    },
    {
      label: "Fgems 余额",
      value: formatBalanceChange(result),
    },
  ];
}

function formatUpgradeResultDescription(
  result: CollectionUpgradeItemResponse | null,
): string | undefined {
  if (!result) {
    return undefined;
  }

  return `Lv.${formatOptionalNumber(result.fromLevel)} 升至 Lv.${formatCurrencyAmount(
    result.toLevel,
  )}`;
}

function formatBalanceChange(result: CollectionUpgradeItemResponse): string {
  if (result.fgemsBalanceBefore === null || result.fgemsBalanceAfter === null) {
    return "待同步";
  }

  return `${formatCurrencyAmount(
    result.fgemsBalanceBefore,
  )} -> ${formatCurrencyAmount(result.fgemsBalanceAfter)}`;
}

function formatLevel(value: number | null): string {
  return value === null ? "待同步" : `Lv.${formatCurrencyAmount(value)}`;
}

function formatOptionalNumber(value: number | null): string {
  return value === null ? "待同步" : formatCurrencyAmount(value);
}

function getEvolveResultMetrics(result: CollectionEvolveItemResponse | null) {
  if (!result) {
    return [];
  }

  return [
    {
      label: result.success ? "新增藏品" : "已返还主藏品",
      value: formatResultItemId(
        result.success
          ? result.createdItemInstanceId
          : result.returnedItemInstanceId,
      ),
    },
    {
      label: "消耗材料",
      value: `${formatCurrencyAmount(
        result.consumedItemInstanceIds.length,
      )} 件`,
    },
    {
      label: "消耗 KCOIN",
      value: formatCurrencyAmount(result.consumedKcoin),
    },
    {
      label: "KCOIN 余额",
      value: formatEvolveBalanceChange(result),
    },
    {
      label: "成功率",
      value: formatSuccessRate(result.successRateBps),
    },
  ];
}

function formatEvolveResultDescription(
  result: CollectionEvolveItemResponse | null,
): string | undefined {
  if (!result) {
    return undefined;
  }

  return result.success
    ? "新形态已由服务端生成，库存和资产正在刷新。"
    : "合成失败，已返还主藏品。";
}

function formatEvolveBalanceChange(
  result: CollectionEvolveItemResponse,
): string {
  if (result.kcoinBalanceBefore === null || result.kcoinBalanceAfter === null) {
    return "待同步";
  }

  return `${formatCurrencyAmount(
    result.kcoinBalanceBefore,
  )} -> ${formatCurrencyAmount(result.kcoinBalanceAfter)}`;
}

function formatSuccessRate(value: number): string {
  return `${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
  }).format(value / 100)}%`;
}

function formatResultItemId(value: string | null): string {
  return value ? value.slice(0, 8) : "待同步";
}

function getDecomposeResultMetrics(
  result: CollectionDecomposeItemResponse | null,
) {
  if (!result) {
    return [];
  }

  return [
    {
      label: "分解藏品",
      value: `${formatCurrencyAmount(
        result.decomposedItemInstanceIds.length,
      )} 件`,
    },
    {
      label: "获得 Fgems",
      value: formatCurrencyAmount(result.gainedFgems),
    },
    {
      label: "Fgems 余额",
      value: formatDecomposeBalanceChange(result),
    },
  ];
}

function formatDecomposeResultDescription(
  result: CollectionDecomposeItemResponse | null,
): string | undefined {
  if (!result) {
    return undefined;
  }

  return `已获得 ${formatCurrencyAmount(result.gainedFgems)} Fgems，库存和资产正在刷新。`;
}

function formatDecomposeBalanceChange(
  result: CollectionDecomposeItemResponse,
): string {
  if (result.fgemsBalanceBefore === null || result.fgemsBalanceAfter === null) {
    return "待同步";
  }

  return `${formatCurrencyAmount(
    result.fgemsBalanceBefore,
  )} -> ${formatCurrencyAmount(result.fgemsBalanceAfter)}`;
}
