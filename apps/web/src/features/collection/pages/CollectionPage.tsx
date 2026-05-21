import { PackageOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getApiErrorMessage } from "@/api/errors";
import { APP_ROUTES } from "@/shared/constants/routes";

import { CharacterGrid } from "../components/CharacterGrid";
import { CharacterHero } from "../components/CharacterHero";
import { useInventory } from "../hooks/useInventory";

export function CollectionPage() {
  const inventoryQuery = useInventory();
  const items = inventoryQuery.items;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
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
      return;
    }

    if (!selectedItem) {
      return;
    }

    if (selectedItem.itemInstanceId !== selectedItemId) {
      setSelectedItemId(selectedItem.itemInstanceId);
    }
  }, [items, selectedItem, selectedItemId]);

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
      <CharacterGrid
        items={items}
        selectedItemId={selectedItem.itemInstanceId}
        onSelect={setSelectedItemId}
      />
    </section>
  );
}
