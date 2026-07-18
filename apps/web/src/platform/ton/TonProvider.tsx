import { TonConnectUIProvider } from "@tonconnect/ui-react";
import type { ReactNode } from "react";

export default function TonProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <TonConnectUIProvider
      manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}
    >
      {children}
    </TonConnectUIProvider>
  );
}
