import { PackageSearch, ShoppingBag, Tags } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { focusTaskTarget } from "../../../shared/navigation/focusTaskTarget.ts";

export type MarketTab = "buy" | "sell" | "manage";

const tabs: ReadonlyArray<{
  id: MarketTab;
  label: string;
  icon: typeof ShoppingBag;
}> = [
  { id: "buy", label: "购买", icon: ShoppingBag },
  { id: "sell", label: "出售", icon: Tags },
  { id: "manage", label: "管理", icon: PackageSearch },
];

export function MarketTabs({
  activeTab,
  focusActive,
  focusReady,
  onSelect,
}: {
  activeTab: MarketTab;
  focusActive: boolean;
  focusReady: boolean;
  onSelect: (tab: MarketTab) => void;
}): ReactNode {
  const buttons = useRef<Record<MarketTab, HTMLButtonElement | null>>({
    buy: null,
    sell: null,
    manage: null,
  });

  useEffect(() => {
    if (!focusActive) return;
    return focusTaskTarget(buttons.current[activeTab]);
  }, [activeTab, focusActive, focusReady]);

  return (
    <nav className="segmented market-tabs" aria-label="交易市场页签">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          ref={(element) => {
            buttons.current[id] = element;
          }}
          type="button"
          className={activeTab === id ? "active" : ""}
          aria-current={activeTab === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <Icon aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
