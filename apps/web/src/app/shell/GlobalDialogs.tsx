import { lazy, Suspense, type ReactNode } from "react";

import { TopupDialog } from "../../domains/topup/index.ts";
import { VipDialog } from "../../domains/vip/index.ts";
import type { TopupRequest } from "../../workflows/payment-recovery/index.ts";
import { AppModal } from "../../shared/ui/index.tsx";
import type { GlobalDialog } from "./TopAssetBar.tsx";

const WalletDialog = lazy(() =>
  import("../../domains/wallet/index.ts").then((module) => ({
    default: module.WalletCapabilityDialog,
  })),
);

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
  if (active === "wallet")
    return (
      <Suspense
        fallback={
          <AppModal label="正在加载钱包">
            <div className="modal">正在加载钱包</div>
          </AppModal>
        }
      >
        <WalletDialog close={close} />
      </Suspense>
    );
  return null;
}
