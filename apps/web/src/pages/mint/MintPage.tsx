import type { ReactNode } from "react";

import { MintView } from "../../domains/mint/index.ts";
import TonProvider from "../../platform/ton/TonProvider.tsx";

export function MintPage(): ReactNode {
  return (
    <TonProvider>
      <MintView />
    </TonProvider>
  );
}
