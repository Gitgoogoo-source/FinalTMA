import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { GachaView } from "../../domains/gacha/index.ts";
import { VipDailyBenefits } from "../../domains/vip/index.ts";

export function GachaPage(): ReactNode {
  const location = useLocation();
  return (
    <GachaView
      key={location.search}
      dailyBenefits={(onFreeRareClaimed) => (
        <VipDailyBenefits onFreeRareClaimed={onFreeRareClaimed} />
      )}
    />
  );
}
