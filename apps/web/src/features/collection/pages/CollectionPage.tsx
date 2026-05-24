import { PackageOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getApiErrorMessage } from "@/api/errors";
import { APP_ROUTES } from "@/shared/constants/routes";
import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import { CharacterDetailSheet } from "../components/CharacterDetailSheet";
import { CharacterGrid } from "../components/CharacterGrid";
import { CharacterHero } from "../components/CharacterHero";
import { GrowthResultModal } from "../components/GrowthResultModal";
import { GrowthActionBar } from "../components/GrowthActionBar";
import { UpgradePanel } from "../components/UpgradePanel";
import type { CollectionUpgradeItemResponse } from "../collection.types";
import { useInventory } from "../hooks/useInventory";

export function CollectionPage() {
  const inventoryQuery = useInventory();
  const items = inventoryQuery.items;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [upgradeResult, setUpgradeResult] =
    useState<CollectionUpgradeItemResponse | null>(null);
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
      setIsDetailOpen(false);
      setIsUpgradeOpen(false);
      setUpgradeResult(null);
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
    setIsDetailOpen(false);
    setIsUpgradeOpen(true);
  }

  function handleUpgradeResult(result: CollectionUpgradeItemResponse) {
    setSelectedItemId(result.itemInstanceId);
    setUpgradeResult(result);
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
      <CharacterHero item={selectedItem} />
      <GrowthActionBar
        item={selectedItem}
        onOpenDetail={() => setIsDetailOpen(true)}
      />
      <CharacterGrid
        items={items}
        selectedItemId={selectedItem.itemInstanceId}
        onSelect={setSelectedItemId}
      />
      <CharacterDetailSheet
        open={isDetailOpen}
        item={selectedItem}
        onClose={() => setIsDetailOpen(false)}
        onUpgrade={handleOpenUpgrade}
      />
      <UpgradePanel
        open={isUpgradeOpen}
        item={selectedItem}
        onClose={() => setIsUpgradeOpen(false)}
        onUpgraded={handleUpgradeResult}
      />
      <GrowthResultModal
        open={upgradeResult !== null}
        title="升级成功"
        description={formatUpgradeResultDescription(upgradeResult)}
        metrics={getUpgradeResultMetrics(upgradeResult)}
        onClose={() => setUpgradeResult(null)}
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
