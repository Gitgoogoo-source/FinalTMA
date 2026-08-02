import { lazy, Suspense, type ReactNode } from "react";

import { AppModal } from "../../../shared/ui/index.tsx";

const TonProvider = lazy(() => import("../../../platform/ton/TonProvider.tsx"));

const WalletDialog = lazy(() =>
  import("./WalletDialog.tsx").then((module) => ({
    default: module.WalletDialog,
  })),
);

export function WalletCapabilityDialog({
  close,
}: {
  close(): void;
}): ReactNode {
  return (
    <Suspense
      fallback={
        <AppModal label="正在加载钱包能力">
          <div className="modal">正在加载钱包能力</div>
        </AppModal>
      }
    >
      <TonProvider>
        <WalletDialog close={close} />
      </TonProvider>
    </Suspense>
  );
}
