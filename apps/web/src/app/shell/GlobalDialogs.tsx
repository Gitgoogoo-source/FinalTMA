import type { ReactNode } from "react";

import { TopupDialog } from "../../domains/topup/index.ts";
import { VipDialog } from "../../domains/vip/index.ts";
import type { TopupRequest } from "../../workflows/payment-recovery/index.ts";
import type { GlobalDialog } from "./TopAssetBar.tsx";

export function GlobalDialogs({
  active,
  topupRequest,
  close,
}: {
  active: GlobalDialog | null;
  topupRequest: TopupRequest | null;
  close(): void;
}): ReactNode {
  if (active === "topup")
    return <TopupDialog request={topupRequest} close={close} />;
  if (active === "vip") return <VipDialog close={close} />;
  return null;
}
