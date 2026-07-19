import { lazy, Suspense, type ReactNode } from "react";

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
    <Suspense fallback={<div className="modal-backdrop">正在加载钱包能力</div>}>
      <TonProvider>
        <WalletDialog close={close} />
      </TonProvider>
    </Suspense>
  );
}
