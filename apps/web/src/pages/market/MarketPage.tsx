import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { MarketView } from "../../domains/market/index.ts";
import { VipBanner, VipDialog } from "../../domains/vip/index.ts";

export function MarketPage(): ReactNode {
  const [params, setParams] = useSearchParams();
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
      {vipOpen && <VipDialog close={closeVip} />}
    </>
  );
}
