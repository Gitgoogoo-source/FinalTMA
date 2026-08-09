import type { ReactNode } from "react";

import { PageModulePreparationProvider } from "../../shared/navigation/PageModulePreparationProvider.tsx";
import { OperationRegistryProvider } from "../../workflows/operation-recovery/OperationRegistryProvider.tsx";
import { NavigationIntentProvider } from "../../workflows/payment-recovery/NavigationIntentProvider.tsx";
import { preparePageModule } from "../router/pageRoutes.ts";

export function AuthenticatedRuntimeProviders({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <PageModulePreparationProvider prepare={preparePageModule}>
      <NavigationIntentProvider>
        <OperationRegistryProvider>{children}</OperationRegistryProvider>
      </NavigationIntentProvider>
    </PageModulePreparationProvider>
  );
}
