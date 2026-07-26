import type { ReactNode } from "react";

import { GachaView } from "../../domains/gacha/index.ts";
import { VipDailyBenefits } from "../../domains/vip/index.ts";

export function GachaPage(): ReactNode {
  return (
    <GachaView
      dailyBenefits={(onFreeRareClaimed) => (
        <VipDailyBenefits onFreeRareClaimed={onFreeRareClaimed} />
      )}
    />
  );
}
