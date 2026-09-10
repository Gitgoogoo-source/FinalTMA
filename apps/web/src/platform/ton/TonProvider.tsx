import { TonConnectUIProvider, THEME } from "@tonconnect/ui-react";
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
      actionsConfiguration={{
        twaReturnUrl: "https://t.me/EvoMyPet_bot/evomypet",
      }}
      uiPreferences={{ theme: THEME.DARK }}
      language="en"
      analytics={{ mode: "off" }}
    >
      {children}
    </TonConnectUIProvider>
  );
}
