import { useState, type ReactNode } from "react";

import { MarketView } from "../../domains/market/index.ts";
import { usePageSearchParams } from "../../shared/navigation/pageActivity.tsx";
import { VipBanner } from "../../domains/vip/ui/VipBanner.tsx";
import { GlobalDialogs } from "../../app/shell/GlobalDialogs.tsx";
import "../../shared/styles/market-page.css";

export function MarketPage(): ReactNode {
  const [params, setParams] = usePageSearchParams();
  const requested = params.get("vip") === "details";
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const vipOpen = requested || manuallyOpen;
  const closeVip = () => {
    setManuallyOpen(false);
    if (!requested) return;
    const next = new URLSearchParams(params);
    next.delete("vip");
    setParams(next, { replace: true });
  };
  return (
    <>
      <MarketView
        vipBanner={<VipBanner open={() => setManuallyOpen(true)} />}
      />
      <GlobalDialogs
        active={vipOpen ? "vip" : null}
        topupRequest={null}
        close={closeVip}
      />
    </>
  );
}
