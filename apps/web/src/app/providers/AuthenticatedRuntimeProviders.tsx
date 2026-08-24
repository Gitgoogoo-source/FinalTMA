import type { ReactNode } from "react";

import { PageModulePreparationProvider } from "../../shared/navigation/PageModulePreparationProvider.tsx";
import { OperationRegistryProvider } from "../../workflows/operation-recovery/OperationRegistryProvider.tsx";
import { NavigationIntentProvider } from "../../workflows/payment-recovery/NavigationIntentProvider.tsx";
import { preparePageModule } from "../router/pageRoutes.ts";
import { TelegramBackNavigation } from "../router/TelegramBackNavigation.tsx";

export function AuthenticatedRuntimeProviders({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <PageModulePreparationProvider prepare={preparePageModule}>
      <NavigationIntentProvider>
        <OperationRegistryProvider>
          <TelegramBackNavigation />
          {children}
        </OperationRegistryProvider>
      </NavigationIntentProvider>
    </PageModulePreparationProvider>
  );
}
