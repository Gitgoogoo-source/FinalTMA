import type { ReactNode } from "react";

import TonProvider from "../../../platform/ton/TonProvider.tsx";
import { WalletDialog } from "./WalletDialog.tsx";
import "./wallet.css";

// The global dialog loader owns this entire capability's retryable import boundary.
export function WalletCapabilityDialog({
  close,
}: {
  close(): void;
}): ReactNode {
  return (
    <TonProvider>
      <WalletDialog close={close} />
    </TonProvider>
  );
}
