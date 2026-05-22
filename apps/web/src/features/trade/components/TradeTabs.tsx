import { TRADE_TABS } from "../trade.constants";
import type { TradeTabId } from "../trade.types";

type TradeTabsProps = {
  activeTab: TradeTabId;
  onTabChange: (tab: TradeTabId) => void;
};

export function TradeTabs({ activeTab, onTabChange }: TradeTabsProps) {
  return (
    <div className="trade-tabs" role="tablist" aria-label="交易市场">
      {TRADE_TABS.map((tab) => {
        const isActive = activeTab === tab.id;

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
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
