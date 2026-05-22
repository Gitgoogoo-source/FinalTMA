import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import { TradeTabs } from "../components/TradeTabs";
import type { TradeTabId } from "../trade.types";
import { normalizeTradeTab } from "../trade.utils";

import { BuyPage } from "./BuyPage";
import { ManageListingsPage } from "./ManageListingsPage";
import { SellPage } from "./SellPage";

export function TradePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeTradeTab(searchParams.get("tab"));

  const handleTabChange = useCallback(
    (nextTab: TradeTabId) => {
      setSearchParams(
        (currentParams) => {
          const nextParams = new URLSearchParams(currentParams);
          nextParams.set("tab", nextTab);

          return nextParams;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  return (
    <section className="trade-page" data-testid="trade-page">
      <header className="trade-page__header">
        <h1>交易市场</h1>
      </header>

      <TradeTabs activeTab={activeTab} onTabChange={handleTabChange} />

      <div className="trade-page__panel">
        {activeTab === "buy" ? <BuyPage /> : null}
        {activeTab === "sell" ? <SellPage /> : null}
        {activeTab === "manage" ? <ManageListingsPage /> : null}
      </div>
    </section>
  );
}
