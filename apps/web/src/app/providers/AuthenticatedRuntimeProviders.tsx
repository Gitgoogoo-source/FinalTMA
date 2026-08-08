import type { ReactNode } from "react";

import { NewMarkerProvider } from "../../workflows/new-markers/NewMarkerProvider.tsx";
import { OperationRegistryProvider } from "../../workflows/operation-recovery/OperationRegistryProvider.tsx";
import { NavigationIntentProvider } from "../../workflows/payment-recovery/NavigationIntentProvider.tsx";

export function AuthenticatedRuntimeProviders({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <NewMarkerProvider>
      <NavigationIntentProvider>
        <OperationRegistryProvider>{children}</OperationRegistryProvider>
      </NavigationIntentProvider>
    </NewMarkerProvider>
  );
}
