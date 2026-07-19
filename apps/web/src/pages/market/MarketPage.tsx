import { useState, type ReactNode } from "react";

import { MarketView } from "../../domains/market/index.ts";
import { VipBanner, VipDialog } from "../../domains/vip/index.ts";

export function MarketPage(): ReactNode {
  const [vipOpen, setVipOpen] = useState(false);
  return (
    <>
      <MarketView vipBanner={<VipBanner open={() => setVipOpen(true)} />} />
      {vipOpen && <VipDialog close={() => setVipOpen(false)} />}
    </>
  );
}
