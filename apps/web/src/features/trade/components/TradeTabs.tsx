import { ClipboardList, ShoppingBag, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { TRADE_TABS } from "../trade.constants";
import type { TradeTabId } from "../trade.types";

type TradeTabsProps = {
  activeTab: TradeTabId;
  onTabChange: (tab: TradeTabId) => void;
};

const TAB_ICON_BY_ID: Record<TradeTabId, LucideIcon> = {
  buy: ShoppingBag,
  sell: Tag,
  manage: ClipboardList,
};

export function TradeTabs({ activeTab, onTabChange }: TradeTabsProps) {
  return (
    <div className="trade-tabs" role="tablist" aria-label="交易功能切换">
      {TRADE_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = TAB_ICON_BY_ID[tab.id];

        return (
          <button
            aria-controls={`trade-tab-panel-${tab.id}`}
            aria-selected={isActive}
            className={`trade-tabs__button${
              isActive ? " trade-tabs__button--active" : ""
            }`}
            id={`trade-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            type="button"
          >
            <Icon aria-hidden="true" size={18} strokeWidth={2.35} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
