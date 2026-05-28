import { TonConnectUIProvider } from "@tonconnect/ui-react";
import type { ReactNode } from "react";

import { env } from "@/env";

type TonConnectProviderProps = {
  children: ReactNode;
  enabled?: boolean;
  manifestUrl?: string;
};

export function TonConnectProvider({
  children,
  enabled = env.FEATURES.TON_CONNECT,
  manifestUrl = env.TONCONNECT_MANIFEST_URL,
}: TonConnectProviderProps) {
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <TonConnectUIProvider
      actionsConfiguration={{
        returnStrategy: "back",
      }}
      analytics={{
        mode: "off",
      }}
      manifestUrl={manifestUrl}
      restoreConnection
    >
      {children}
    </TonConnectUIProvider>
  );
}
