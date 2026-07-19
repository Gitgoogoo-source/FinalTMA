import { TonConnectUIProvider } from "@tonconnect/ui-react";
import type { ReactNode } from "react";

import { getWebPublicConfig } from "../env/index.ts";

export default function TonProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <TonConnectUIProvider
      manifestUrl={getWebPublicConfig().tonConnectManifestUrl}
    >
      {children}
    </TonConnectUIProvider>
  );
}
